import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty.tsx";
import { AlertTriangle, TrendingDown, TrendingUp, Minus, ShieldAlert } from "lucide-react";
import {
  buildTenantRiskData,
  getTrendLabel,
  getTrendColor,
  getPaymentStatusLabel,
  getPaymentStatusColor,
} from "./_lib/risk-utils.ts";
import type { TenantRiskData } from "./_lib/risk-utils.ts";

export default function AtRiskPage() {
  const companies = useQuery(api.companies.list, {});
  const consumption = useQuery(api.consumption.list, {});
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});

  const [countryFilter, setCountryFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [showOnlyAtRisk, setShowOnlyAtRisk] = useState(true);

  if (!companies || !consumption || !countries || !sectors) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const riskData = buildTenantRiskData(companies, consumption);

  // Apply filters
  let filtered = riskData;
  if (countryFilter !== "all") {
    filtered = filtered.filter((d) => d.company.countryId === countryFilter);
  }
  if (sectorFilter !== "all") {
    filtered = filtered.filter((d) => d.company.sectorId === sectorFilter);
  }
  if (showOnlyAtRisk) {
    filtered = filtered.filter((d) => d.isAtRisk);
  }

  // Summary stats
  const totalAtRisk = riskData.filter((d) => d.isAtRisk).length;
  const totalDeclining = riskData.filter((d) => d.trend === "declining").length;
  const totalTracked = riskData.length;

  const countryMap = new Map(countries.map((c) => [c._id, c]));
  const sectorMap = new Map(sectors.map((s) => [s._id, s]));

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">At-Risk Tenants</h1>
        <p className="text-muted-foreground mt-1">
          Tenants with declining usage for 2+ consecutive months
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">At Risk</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{totalAtRisk}</div>
            <p className="text-xs text-muted-foreground mt-1">2+ months declining</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Declining</CardTitle>
            <TrendingDown className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{totalDeclining}</div>
            <p className="text-xs text-muted-foreground mt-1">Latest month vs previous</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm text-muted-foreground">Tracked</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTracked}</div>
            <p className="text-xs text-muted-foreground mt-1">Tenants with usage data</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Countries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Sectors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s._id} value={s._id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          className={`cursor-pointer text-sm px-3 py-1.5 rounded-md border transition-colors ${
            showOnlyAtRisk
              ? "bg-destructive/10 border-destructive/30 text-destructive"
              : "bg-muted border-border text-muted-foreground"
          }`}
          onClick={() => setShowOnlyAtRisk(!showOnlyAtRisk)}
        >
          {showOnlyAtRisk ? "Showing At-Risk Only" : "Showing All"}
        </button>
      </div>

      {/* Tenant list */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertTriangle />
            </EmptyMedia>
            <EmptyTitle>
              {totalTracked === 0
                ? "No usage data"
                : showOnlyAtRisk
                ? "No at-risk tenants"
                : "No matching tenants"}
            </EmptyTitle>
            <EmptyDescription>
              {totalTracked === 0
                ? "Add usage data on the Usage page first"
                : showOnlyAtRisk
                ? "Great news! No tenants are flagged at risk currently"
                : "Adjust your filters to see results"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Tenant</th>
                    <th className="text-left p-3 font-medium">Country</th>
                    <th className="text-left p-3 font-medium">Sector</th>
                    <th className="text-center p-3 font-medium">Trend</th>
                    <th className="text-right p-3 font-medium">Latest</th>
                    <th className="text-right p-3 font-medium">Change</th>
                    <th className="text-center p-3 font-medium">Payment</th>
                    <th className="text-center p-3 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .sort((a, b) => {
                      // At-risk first, then by change percent
                      if (a.isAtRisk !== b.isAtRisk) return a.isAtRisk ? -1 : 1;
                      return a.changePercent - b.changePercent;
                    })
                    .map((d) => (
                      <RiskRow
                        key={d.company._id}
                        data={d}
                        countryName={countryMap.get(d.company.countryId)?.name || "—"}
                        sectorName={sectorMap.get(d.company.sectorId)?.name || "—"}
                      />
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

function RiskRow({
  data,
  countryName,
  sectorName,
}: {
  data: TenantRiskData;
  countryName: string;
  sectorName: string;
}) {
  const TrendIcon = data.trend === "growing" ? TrendingUp : data.trend === "declining" ? TrendingDown : Minus;

  return (
    <tr className="border-b last:border-0">
      <td className="p-3 font-medium">{data.company.name}</td>
      <td className="p-3 text-muted-foreground">{countryName}</td>
      <td className="p-3 text-muted-foreground">{sectorName}</td>
      <td className="p-3 text-center">
        <Badge className={`text-xs ${getTrendColor(data.trend)}`} variant="secondary">
          <TrendIcon className="h-3 w-3 mr-1" />
          {getTrendLabel(data.trend)}
        </Badge>
      </td>
      <td className="p-3 text-right">
        ${data.latestTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </td>
      <td className={`p-3 text-right ${data.changePercent < 0 ? "text-destructive" : data.changePercent > 0 ? "text-emerald-600" : ""}`}>
        {data.changePercent > 0 ? "+" : ""}{data.changePercent}%
      </td>
      <td className="p-3 text-center">
        <Badge className={`text-xs ${getPaymentStatusColor(data.company.paymentStatus)}`} variant="secondary">
          {getPaymentStatusLabel(data.company.paymentStatus)}
        </Badge>
      </td>
      <td className="p-3 text-center">
        {data.isAtRisk ? (
          <Badge className="text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" variant="secondary">
            <AlertTriangle className="h-3 w-3 mr-1" />
            At Risk
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
    </tr>
  );
}
