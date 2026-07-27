import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { TrendingUp, TrendingDown, Calendar, Gauge } from "lucide-react";
import {
  calculatePace,
  getQuarterRange,
  getStatusLabel,
  getStatusColor,
  formatCurrency,
} from "./_lib/pace-utils.ts";
import type { PaceMetrics, QuarterlyTargets } from "./_lib/pace-utils.ts";

export default function PerformancePage() {
  const { currentUser } = useCrm();
  const users = useQuery(api.users.listAll, {});
  const leads = useQuery(api.leads.list, {});
  const companies = useQuery(api.companies.list, {});
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});

  const today = new Date();
  const { quarter } = getQuarterRange(today);
  const year = today.getFullYear();
  const targets = useQuery(api.salesTargets.getByYear, { year });

  if (!users || !leads || !targets || !companies || !countries || !sectors) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const wonLeads = leads.filter((l) => l.stage === "won");

  // Helper: get achieved value for an AM (all won deals this year)
  const getAchieved = (amId: Id<"users">) =>
    wonLeads
      .filter((l) => l.accountManagerId === amId)
      .reduce((s, l) => s + l.potentialValue, 0);

  // Helper: get all 4 quarterly targets for an AM
  const getQuarterlyTargets = (amId: Id<"users">): QuarterlyTargets => {
    const findTarget = (q: number) => {
      const t = targets.find(
        (t: Doc<"salesTargets">) => t.accountManagerId === amId && t.quarter === q,
      );
      return t?.target || 0;
    };
    return { q1: findTarget(1), q2: findTarget(2), q3: findTarget(3), q4: findTarget(4) };
  };

  // Build pace data per AM
  const allAMs = users.filter(
    (u) => u.role === "account_manager" || u.role === "country_gm" || u.role === "head_of_business" || u.role === "ceo",
  );

  const amPaceData = allAMs.map((am) => ({
    user: am,
    pace: calculatePace(getQuarterlyTargets(am._id), getAchieved(am._id), today),
  }));

  // Filter based on role
  let visibleAMs = amPaceData;
  if (currentUser?.role === "country_gm" && currentUser.countryId) {
    visibleAMs = amPaceData.filter((d) => d.user.countryId === currentUser.countryId);
  } else if (currentUser?.role === "account_manager") {
    visibleAMs = amPaceData.filter((d) => d.user._id === currentUser._id);
  }

  // Company-wide rollup — aggregate per-quarter targets, then recalculate pace
  const aggregateQuarterly = (ams: typeof amPaceData): QuarterlyTargets => {
    return ams.reduce(
      (acc, d) => {
        const qt = getQuarterlyTargets(d.user._id);
        return { q1: acc.q1 + qt.q1, q2: acc.q2 + qt.q2, q3: acc.q3 + qt.q3, q4: acc.q4 + qt.q4 };
      },
      { q1: 0, q2: 0, q3: 0, q4: 0 },
    );
  };

  const companyWideAchieved = visibleAMs.reduce((s, d) => s + d.pace.achieved, 0);
  const companyWidePace = calculatePace(aggregateQuarterly(visibleAMs), companyWideAchieved, today);

  // Country rollup (for CEO)
  const countryRollup = countries.map((country) => {
    const countryAMs = amPaceData.filter((d) => d.user.countryId === country._id);
    const achieved = countryAMs.reduce((s, d) => s + d.pace.achieved, 0);
    return {
      country,
      pace: calculatePace(aggregateQuarterly(countryAMs), achieved, today),
      amCount: countryAMs.length,
    };
  }).filter((d) => d.pace.yearlyTarget > 0 || d.pace.achieved > 0);

  // Sector rollup (for CEO)
  const sectorRollup = sectors.map((sector) => {
    const sectorCompanies = companies.filter((c) => c.sectorId === sector._id);
    const sectorCompanyIds = new Set(sectorCompanies.map((c) => c._id));
    const sectorWon = wonLeads.filter((l) => sectorCompanyIds.has(l.companyId));
    const achieved = sectorWon.reduce((s, l) => s + l.potentialValue, 0);
    return { sector, achieved, dealCount: sectorWon.length };
  }).filter((d) => d.achieved > 0);

  const isCeoOrHob = currentUser?.role === "ceo" || currentUser?.role === "head_of_business";
  const isGm = currentUser?.role === "country_gm";

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Performance Pace</h1>
        <p className="text-muted-foreground mt-1">
          {year} Year-to-date — Currently in Q{quarter} (Day {companyWidePace.elapsedWorkingDaysInQuarter} of {companyWidePace.totalWorkingDaysInQuarter})
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Yearly Target
            </CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(companyWidePace.yearlyTarget)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Q{quarter} target: {formatCurrency(companyWidePace.currentQuarterTarget)} ({formatCurrency(companyWidePace.dailyPace)}/day)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Expected To-Date
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(companyWidePace.expectedToDate)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Completed Qs + prorated Q{quarter}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Achieved
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(companyWidePace.achieved)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {companyWidePace.percentOfExpected}% of expected
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Gap
            </CardTitle>
            {companyWidePace.gap >= 0 ? (
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${companyWidePace.gap >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {companyWidePace.gap >= 0 ? "+" : ""}{formatCurrency(companyWidePace.gap)}
            </div>
            <Badge className={`mt-1 text-xs ${getStatusColor(companyWidePace.status)}`} variant="secondary">
              {getStatusLabel(companyWidePace.status)}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Per-AM breakdown table */}
      {visibleAMs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isCeoOrHob ? "Account Manager Pace" : isGm ? "Your Country Team" : "Your Performance"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Name</th>
                    <th className="text-right py-2 px-3 font-medium">Year Target</th>
                    <th className="text-right py-2 px-3 font-medium">Expected</th>
                    <th className="text-right py-2 px-3 font-medium">Achieved</th>
                    <th className="text-right py-2 px-3 font-medium">Gap</th>
                    <th className="text-right py-2 px-3 font-medium">Q{quarter} Pace/Day</th>
                    <th className="text-center py-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAMs
                    .filter((d) => d.pace.yearlyTarget > 0 || d.pace.achieved > 0)
                    .sort((a, b) => b.pace.percentOfExpected - a.pace.percentOfExpected)
                    .map((d) => (
                      <PaceRow key={d.user._id} name={d.user.name || "Unknown"} pace={d.pace} />
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Country rollup (CEO only) */}
      {isCeoOrHob && countryRollup.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Country</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Country</th>
                    <th className="text-right py-2 px-3 font-medium">Year Target</th>
                    <th className="text-right py-2 px-3 font-medium">Expected</th>
                    <th className="text-right py-2 px-3 font-medium">Achieved</th>
                    <th className="text-right py-2 px-3 font-medium">Gap</th>
                    <th className="text-center py-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {countryRollup
                    .sort((a, b) => b.pace.percentOfExpected - a.pace.percentOfExpected)
                    .map((d) => (
                      <PaceRow key={d.country._id} name={`${d.country.name} (${d.amCount} AMs)`} pace={d.pace} />
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sector rollup (CEO only) */}
      {isCeoOrHob && sectorRollup.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Won Revenue by Sector</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Sector</th>
                    <th className="text-right py-2 px-3 font-medium">Won Revenue</th>
                    <th className="text-right py-2 px-3 font-medium">Deals Won</th>
                  </tr>
                </thead>
                <tbody>
                  {sectorRollup
                    .sort((a, b) => b.achieved - a.achieved)
                    .map((d) => (
                      <tr key={d.sector._id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-medium">{d.sector.name}</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(d.achieved)}</td>
                        <td className="py-2 px-3 text-right">{d.dealCount}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaceRow({ name, pace }: { name: string; pace: PaceMetrics }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 font-medium">{name}</td>
      <td className="py-2 px-3 text-right">{formatCurrency(pace.yearlyTarget)}</td>
      <td className="py-2 px-3 text-right text-muted-foreground">{formatCurrency(pace.expectedToDate)}</td>
      <td className="py-2 px-3 text-right">{formatCurrency(pace.achieved)}</td>
      <td className={`py-2 px-3 text-right ${pace.gap >= 0 ? "text-emerald-600" : "text-destructive"}`}>
        {pace.gap >= 0 ? "+" : ""}{formatCurrency(pace.gap)}
      </td>
      <td className="py-2 px-3 text-right text-muted-foreground">{formatCurrency(pace.dailyPace)}</td>
      <td className="py-2 pl-3 text-center">
        <Badge className={`text-xs ${getStatusColor(pace.status)}`} variant="secondary">
          {getStatusLabel(pace.status)}
        </Badge>
      </td>
    </tr>
  );
}
