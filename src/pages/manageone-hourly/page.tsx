import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { canViewCloudHealth } from "@/lib/role-access.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { Activity, ShieldAlert } from "lucide-react";

type TimeWindow = "24h" | "7d" | "30d";
const monitoredRegions = ["Hoa-Mogadishu-2", "Mogadishu-region-hq3"] as const;
const monitoredRegionSet = new Set<string>(monitoredRegions);
const monitoredRegionValue = "__monitored__";

function formatNumber(value: number | undefined | null, maximumFractionDigits = 1) {
  if (value == null) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function formatDateTime(value: number | undefined | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function windowStart(window: TimeWindow) {
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return Date.now() - hours * 60 * 60 * 1000;
}

export default function ManageOneHourlyPage() {
  const { currentUser } = useCrm();
  const canView = canViewCloudHealth(currentUser?.role);
  const snapshots = useQuery(
    api.manageOneHourlyMonitoring.latest,
    canView ? { limit: 500 } : "skip",
  );
  const latestRun = useQuery(
    api.manageOneHourlyMonitoring.latestRun,
    canView ? {} : "skip",
  );
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState(monitoredRegionValue);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");

  const filteredSnapshots = useMemo(() => {
    if (!snapshots) return [];

    const query = search.trim().toLowerCase();
    const cutoff = windowStart(timeWindow);

    return snapshots.filter((row) => {
      if (row.capturedHour < cutoff) return false;
      const rowRegion = row.regionName || row.regionId || "Unknown";
      if (region === monitoredRegionValue && !monitoredRegionSet.has(rowRegion)) {
        return false;
      }
      if (region !== monitoredRegionValue && rowRegion !== region) {
        return false;
      }
      if (!query) return true;

      const haystack = [
        row.tenantName,
        row.regionName,
        row.regionId,
        row.vdcId,
        row.domainId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [region, search, snapshots, timeWindow]);

  const regions = useMemo(() => {
    return monitoredRegions;
  }, []);

  const summary = useMemo(() => {
    const latestHour = filteredSnapshots[0]?.capturedHour;
    const latestRows = latestHour
      ? filteredSnapshots.filter((row) => row.capturedHour === latestHour)
      : [];

    return latestRows.reduce(
      (totals, row) => ({
        tenants: totals.tenants + 1,
        ecs: totals.ecs + row.ecsInstances,
        vcpu: totals.vcpu + row.ecsCores,
        ram: totals.ram + row.ecsRamGb,
        evs: totals.evs + row.evsGb,
        nat: totals.nat + row.natGateways,
      }),
      { tenants: 0, ecs: 0, vcpu: 0, ram: 0, evs: 0, nat: 0 },
    );
  }, [filteredSnapshots]);

  if (!canView) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="max-w-md text-center text-muted-foreground">
            Only Monitoring, Country GM, Head of Business, or CEO can view
            hourly monitoring.
          </p>
        </div>
      </div>
    );
  }

  if (!snapshots || latestRun === undefined) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Hourly Monitoring
        </h1>
        <p className="mt-1 text-muted-foreground">
          Read-only ManageOne resource snapshots collected by HTGweb.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Latest tenants" value={summary.tenants} />
        <MetricCard label="ECS" value={summary.ecs} />
        <MetricCard label="vCPU" value={summary.vcpu} />
        <MetricCard label="RAM GB" value={summary.ram} />
        <MetricCard label="EVS GB" value={summary.evs} />
        <MetricCard label="NAT" value={summary.nat} />
      </div>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Latest Snapshots
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Last run: {formatDateTime(latestRun?.finishedAt ?? latestRun?.startedAt)}
              {latestRun ? (
                <Badge className="ml-2 align-middle" variant="secondary">
                  {latestRun.status}
                </Badge>
              ) : null}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              className="sm:w-[260px]"
              placeholder="Search tenant, VDC, region..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={monitoredRegionValue}>HOA + HQ3</SelectItem>
                {regions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={timeWindow}
              onValueChange={(value) => setTimeWindow(value as TimeWindow)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSnapshots.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <Activity className="h-8 w-8 text-muted-foreground" />
              <div className="font-medium">No hourly snapshots found</div>
              <p className="text-sm text-muted-foreground">
                Run the HTGweb hourly monitoring job for a tenant like dss.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium">Tenant</th>
                    <th className="p-3 text-left font-medium">Region</th>
                    <th className="p-3 text-left font-medium">Captured</th>
                    <th className="p-3 text-right font-medium">ECS</th>
                    <th className="p-3 text-right font-medium">vCPU</th>
                    <th className="p-3 text-right font-medium">RAM GB</th>
                    <th className="p-3 text-right font-medium">EVS GB</th>
                    <th className="p-3 text-right font-medium">OBS GB</th>
                    <th className="p-3 text-right font-medium">EIP</th>
                    <th className="p-3 text-right font-medium">ELB</th>
                    <th className="p-3 text-right font-medium">VPN</th>
                    <th className="p-3 text-right font-medium">NAT</th>
                    <th className="p-3 text-right font-medium">WAF</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSnapshots.map((row) => (
                    <tr key={row._id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{row.tenantName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.vdcId}
                        </div>
                      </td>
                      <td className="p-3">
                        <div>{row.regionName || row.regionId || "-"}</div>
                        {row.regionName && row.regionId ? (
                          <div className="text-xs text-muted-foreground">
                            {row.regionId}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3">{formatDateTime(row.capturedHour)}</td>
                      <td className="p-3 text-right">{formatNumber(row.ecsInstances)}</td>
                      <td className="p-3 text-right">{formatNumber(row.ecsCores)}</td>
                      <td className="p-3 text-right">{formatNumber(row.ecsRamGb)}</td>
                      <td className="p-3 text-right">{formatNumber(row.evsGb)}</td>
                      <td className="p-3 text-right">{formatNumber(row.obsGb)}</td>
                      <td className="p-3 text-right">{formatNumber(row.publicIps)}</td>
                      <td className="p-3 text-right">{formatNumber(row.loadBalancers)}</td>
                      <td className="p-3 text-right">{formatNumber(row.vpnGateways)}</td>
                      <td className="p-3 text-right">{formatNumber(row.natGateways)}</td>
                      <td className="p-3 text-right">{formatNumber(row.wafInstances)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">
          {label}
        </div>
        <div className="mt-3 text-2xl font-bold">{formatNumber(value)}</div>
      </CardContent>
    </Card>
  );
}
