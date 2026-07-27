import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { useCrm, getRoleLabel } from "@/lib/crm-context.tsx";
import { Building2, Users, TrendingUp, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const CURRENT_YEAR = new Date().getFullYear();

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function tooltipFormatter(value: unknown): string {
  return formatCurrency(Number(value));
}

function amLabelFormatter(label: unknown, amChartData: { name: string; fullName: string }[]): string {
  const item = amChartData.find((d) => d.name === String(label));
  return item?.fullName || String(label);
}

export default function DashboardPage() {
  const { currentUser } = useCrm();
  const companies = useQuery(api.companies.list, {});
  const users = useQuery(api.users.listAll, {});
  const leads = useQuery(api.leads.list, {});
  const countries = useQuery(api.countries.list, {});
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const targets = useQuery(api.salesTargets.getByYear, { year: selectedYear });

  const activeCompanies = companies?.filter(
    (c) => c.contractStatus === "active",
  ).length;

  const activeLeads = leads?.filter(
    (l) => l.stage !== "won" && l.stage !== "lost",
  ).length;

  const wonLeads = leads?.filter((l) => l.stage === "won") || [];
  const totalWonValue = wonLeads.reduce((s: number, l) => s + l.potentialValue, 0);

  const isLoading = !companies || !users || !leads || !targets || !countries;

  // Compute per-AM target vs achieved data
  const accountManagers = users?.filter(
    (u) =>
      u.role === "account_manager" ||
      u.role === "country_gm" ||
      u.role === "head_of_business" ||
      u.role === "ceo",
  ) || [];

  const amChartData = accountManagers.map((am) => {
    const amTargets = targets?.filter((t: Doc<"salesTargets">) => t.accountManagerId === am._id) || [];
    const totalTarget = amTargets.reduce((s: number, t: Doc<"salesTargets">) => s + t.target, 0);
    const amWonLeads = wonLeads.filter((l) => l.accountManagerId === am._id);
    const achieved = amWonLeads.reduce((s: number, l) => s + l.potentialValue, 0);
    return {
      name: am.name?.split(" ")[0] || "Unknown",
      fullName: am.name || "Unknown",
      target: totalTarget,
      achieved,
      percentage: totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0,
    };
  });

  // Compute per-country data
  const countryChartData = (countries || []).map((country) => {
    const countryAms = accountManagers.filter((am) => am.countryId === country._id);
    const amIds = new Set(countryAms.map((am) => am._id));

    const countryTargets = targets?.filter(
      (t: Doc<"salesTargets">) =>
        t.accountManagerId !== undefined && amIds.has(t.accountManagerId),
    ) || [];
    const totalTarget = countryTargets.reduce((s: number, t: Doc<"salesTargets">) => s + t.target, 0);
    const countryWon = wonLeads.filter(
      (l) => l.accountManagerId !== undefined && amIds.has(l.accountManagerId),
    );
    const achieved = countryWon.reduce((s: number, l) => s + l.potentialValue, 0);

    return {
      name: country.name,
      target: totalTarget,
      achieved,
      percentage: totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0,
    };
  }).filter((d) => d.target > 0 || d.achieved > 0);

  // Company-wide totals
  const companyWideTarget = targets?.reduce((s: number, t: Doc<"salesTargets">) => s + t.target, 0) || 0;
  const companyWideAchieved = totalWonValue;
  const companyWidePercentage =
    companyWideTarget > 0
      ? Math.round((companyWideAchieved / companyWideTarget) * 100)
      : 0;

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back, {currentUser?.name || "User"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {getRoleLabel(currentUser?.role)} — HTGCLOUDS CRM Overview
          </p>
        </div>
        <Select
          value={selectedYear.toString()}
          onValueChange={(v) => setSelectedYear(Number(v))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
              <SelectItem key={y} value={y.toString()}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Companies
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {companies?.length ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {activeCompanies ?? 0} active contracts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Leads
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeLeads ?? "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">In pipeline</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Won Deals
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{wonLeads.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(totalWonValue)} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Target Achievement
            </CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {companyWideTarget > 0 ? `${companyWidePercentage}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(companyWideAchieved)} / {formatCurrency(companyWideTarget)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Company-wide progress */}
      {companyWideTarget > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Company-Wide Target Progress — {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {formatCurrency(companyWideAchieved)} achieved
                </span>
                <span className="font-medium">
                  {formatCurrency(companyWideTarget)} target
                </span>
              </div>
              <div className="h-4 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(companyWidePercentage, 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">
                {companyWidePercentage}% achieved
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per Account Manager Chart */}
      {!isLoading && amChartData.length > 0 && amChartData.some((d) => d.target > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Target vs Achieved — Per Account Manager
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={amChartData.filter((d) => d.target > 0 || d.achieved > 0)}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis tickFormatter={formatCompact} className="text-xs" />
                  <Tooltip
                    formatter={tooltipFormatter}
                    labelFormatter={(label) => amLabelFormatter(label, amChartData)}
                  />
                  <Legend />
                  <Bar
                    dataKey="target"
                    name="Target"
                    fill="oklch(0.7 0.1 260)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="achieved"
                    name="Achieved"
                    fill="oklch(0.6 0.2 260)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per Country Chart */}
      {!isLoading && countryChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Target vs Achieved — Per Country
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={countryChartData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis tickFormatter={formatCompact} className="text-xs" />
                  <Tooltip formatter={tooltipFormatter} />
                  <Legend />
                  <Bar
                    dataKey="target"
                    name="Target"
                    fill="oklch(0.7 0.1 260)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="achieved"
                    name="Achieved"
                    fill="oklch(0.6 0.15 170)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per AM progress bars */}
      {!isLoading && amChartData.some((d) => d.target > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Individual Progress — {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {amChartData
              .filter((d) => d.target > 0)
              .sort((a, b) => b.percentage - a.percentage)
              .map((am) => (
                <div key={am.fullName} className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{am.fullName}</span>
                    <span className="text-muted-foreground">
                      {am.percentage}% — {formatCurrency(am.achieved)} /{" "}
                      {formatCurrency(am.target)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(am.percentage, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
