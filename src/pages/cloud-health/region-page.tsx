import { useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  BellRing,
  Cpu,
  Database,
  HardDrive,
  Server,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { canViewCloudHealth } from "@/lib/role-access.ts";

function formatNumber(value: number | undefined | null, suffix = "") {
  if (value == null) return "-";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
}

function formatDateTime(value: number | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function percentage(used: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((used / total) * 1000) / 10;
}

function severityLabel(severity: number) {
  if (severity === 1) return "Critical";
  if (severity === 2) return "Major";
  if (severity === 3) return "Minor";
  if (severity === 4) return "Warning";
  return `Severity ${severity}`;
}

function severityBadgeVariant(severity: number) {
  return severity <= 2
    ? "destructive"
    : severity === 3
      ? "secondary"
      : "outline";
}

function hostGroupRiskLabel(riskLevel: "healthy" | "watch" | "critical") {
  if (riskLevel === "critical") return "Critical";
  if (riskLevel === "watch") return "Watch";
  return "Healthy";
}

function hostGroupRiskBadgeVariant(
  riskLevel: "healthy" | "watch" | "critical",
) {
  if (riskLevel === "critical") return "destructive";
  if (riskLevel === "watch") return "secondary";
  return "outline";
}

function ConsumerTable({
  title,
  icon,
  unit,
  rows,
}: {
  title: string;
  icon: ReactNode;
  unit: string;
  rows:
    | Array<{
        tenantId?: string;
        tenantName: string;
        companyName: string | null;
        value: number;
      }>
    | undefined;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!rows ? (
          <Skeleton className="h-32" />
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No tenant usage found for this metric.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Tenant</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Usage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.tenantId ?? `${row.tenantName}-${index}`}
                    className="border-t"
                  >
                    <td className="px-3 py-2 font-medium">{row.tenantName}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.companyName ?? "Unlinked"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatNumber(row.value, unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CloudHealthRegionPage() {
  const { regionId } = useParams();
  const decodedRegionId = regionId ? decodeURIComponent(regionId) : "";
  const navigate = useNavigate();
  const { currentUser } = useCrm();
  const canView = canViewCloudHealth(currentUser?.role);
  const capacity = useQuery(api.cloudCapacity.list, canView ? {} : "skip");
  const history = useQuery(
    api.cloudCapacitySnapshots.historyForRegion,
    canView && decodedRegionId
      ? { regionId: decodedRegionId, limit: 90 }
      : "skip",
  );
  const region = capacity?.find(
    (capacityRegion) => capacityRegion.regionId === decodedRegionId,
  );
  const consumerQueryArgs =
    canView && region?.regionName
      ? { regionName: region.regionName }
      : canView && decodedRegionId
        ? { regionId: decodedRegionId }
        : null;
  const cpuConsumers = useQuery(
    api.regionConsumers.topConsumersByRegion,
    consumerQueryArgs ? { ...consumerQueryArgs, metric: "cpu" } : "skip",
  );
  const memoryConsumers = useQuery(
    api.regionConsumers.topConsumersByRegion,
    consumerQueryArgs ? { ...consumerQueryArgs, metric: "memory" } : "skip",
  );
  const storageConsumers = useQuery(
    api.regionConsumers.topConsumersByRegion,
    consumerQueryArgs ? { ...consumerQueryArgs, metric: "storage" } : "skip",
  );
  const regionAlarms = useQuery(
    api.cloudAlarms.listActiveByRegion,
    canView && decodedRegionId ? { logicalRegionId: decodedRegionId } : "skip",
  );
  const regionHostGroups = useQuery(
    api.cloudHostGroups.listActiveByRegion,
    canView && decodedRegionId ? { regionId: decodedRegionId } : "skip",
  );
  const chartData = useMemo(
    () =>
      (history ?? []).map((snapshot) => ({
        time: new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
        }).format(new Date(snapshot.snapshotAt)),
        snapshotAt: snapshot.snapshotAt,
        cpu: percentage(snapshot.cpuUsed, snapshot.cpuTotal),
        memory: percentage(snapshot.memoryUsedGb, snapshot.memoryTotalGb),
        storage: percentage(snapshot.storageUsedGb, snapshot.storageTotalGb),
      })),
    [history],
  );

  if (!canView) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="max-w-md text-center text-muted-foreground">
            Only Country GM, Head of Business, and CEO roles can view Cloud
            Health.
          </p>
        </div>
      </div>
    );
  }

  if (!capacity || !history || !regionAlarms || !regionHostGroups) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            variant="ghost"
            className="-ml-3 mb-2"
            onClick={() => navigate("/cloud-health?tab=capacity")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Cloud Health
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {region?.regionName ?? decodedRegionId}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Region capacity, top tenant consumers, and historical trends.
          </p>
        </div>
        {region ? (
          <div className="text-sm text-muted-foreground">
            Synced {formatDateTime(region.lastSyncedAt)}
          </div>
        ) : null}
      </div>

      {region ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="h-4 w-4 text-primary" />
                CPU
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {region.cpuUsedPercent}%
              </div>
              <p className="text-sm text-muted-foreground">
                {formatNumber(region.cpuUsed)} / {formatNumber(region.cpuTotal)}{" "}
                cores
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4 text-primary" />
                Memory
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {region.memoryUsedPercent}%
              </div>
              <p className="text-sm text-muted-foreground">
                {formatNumber(region.memoryUsedGb, " GB")} /{" "}
                {formatNumber(region.memoryTotalGb, " GB")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="h-4 w-4 text-primary" />
                Storage
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {region.storageUsedPercent}%
              </div>
              <p className="text-sm text-muted-foreground">
                {formatNumber(region.storageUsedGb, " GB")} /{" "}
                {formatNumber(region.storageTotalGb, " GB")}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Region not found in the latest Cloud Health sync.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <ConsumerTable
          title="Top 5 CPU Tenants"
          icon={<Cpu className="h-4 w-4 text-primary" />}
          unit=" cores"
          rows={cpuConsumers}
        />
        <ConsumerTable
          title="Top 5 Memory Tenants"
          icon={<Database className="h-4 w-4 text-primary" />}
          unit=" GB"
          rows={memoryConsumers}
        />
        <ConsumerTable
          title="Top 5 Storage Tenants"
          icon={<HardDrive className="h-4 w-4 text-primary" />}
          unit=" GB"
          rows={storageConsumers}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            Host Groups in Region
          </CardTitle>
        </CardHeader>
        <CardContent>
          {regionHostGroups.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No active host groups for this region.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Risk</th>
                    <th className="px-3 py-2 font-medium">Host Group</th>
                    <th className="px-3 py-2 font-medium">AZ</th>
                    <th className="px-3 py-2 text-right font-medium">Hosts</th>
                    <th className="px-3 py-2 text-right font-medium">
                      CPU Avg / Max
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Memory Avg / Max
                    </th>
                    <th className="px-3 py-2 font-medium">Last Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {regionHostGroups.map((hostGroup) => (
                    <tr key={hostGroup._id} className="border-t">
                      <td className="px-3 py-2">
                        <Badge
                          variant={hostGroupRiskBadgeVariant(
                            hostGroup.riskLevel,
                          )}
                        >
                          {hostGroupRiskLabel(hostGroup.riskLevel)}
                        </Badge>
                      </td>
                      <td className="max-w-[280px] px-3 py-2">
                        <div className="font-medium">
                          {hostGroup.hostGroupName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {hostGroup.resourcePoolName}
                        </div>
                      </td>
                      <td className="px-3 py-2">{hostGroup.azName}</td>
                      <td className="px-3 py-2 text-right">
                        {hostGroup.hostCount}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatNumber(hostGroup.cpuAvgPercent, "%")} /{" "}
                        {formatNumber(hostGroup.cpuMaxPercent, "%")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatNumber(hostGroup.memoryAvgPercent, "%")} /{" "}
                        {formatNumber(hostGroup.memoryMaxPercent, "%")}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateTime(hostGroup.lastSyncedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4 text-primary" />
            Active Alarms in Region
          </CardTitle>
        </CardHeader>
        <CardContent>
          {regionAlarms.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No active alarms for this region.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">Alarm</th>
                    <th className="px-3 py-2 font-medium">Resource</th>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Occurred</th>
                    <th className="px-3 py-2 font-medium">Ack</th>
                  </tr>
                </thead>
                <tbody>
                  {regionAlarms.map((alarm) => (
                    <tr key={alarm._id} className="border-t">
                      <td className="px-3 py-2">
                        <Badge variant={severityBadgeVariant(alarm.severity)}>
                          {severityLabel(alarm.severity)}
                        </Badge>
                      </td>
                      <td className="max-w-[320px] px-3 py-2">
                        <div className="font-medium">{alarm.alarmName}</div>
                        <div className="text-xs text-muted-foreground">
                          CSN {alarm.csn} · ID {alarm.alarmId}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{alarm.meName || alarm.address || "-"}</div>
                        <div className="text-xs text-muted-foreground">
                          {alarm.meCategory ?? alarm.meType ?? alarm.moc ?? "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {alarm.linkedCompanyName ??
                          alarm.tenant ??
                          alarm.vdcName ??
                          "Platform"}
                      </td>
                      <td className="px-3 py-2">
                        {formatDateTime(alarm.latestOccurUtc)}
                      </td>
                      <td className="px-3 py-2">
                        {alarm.acked ? "Acked" : "Unacked"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Capacity Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length < 3 ? (
            <div className="grid h-72 place-items-center rounded-lg border text-center text-sm text-muted-foreground">
              Not enough historical data yet. Check back after a few nightly
              syncs.
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="time" className="text-xs" />
                  <YAxis className="text-xs" unit="%" />
                  <Tooltip
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.snapshotAt
                        ? formatDateTime(payload[0].payload.snapshotAt)
                        : ""
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="cpu"
                    name="CPU"
                    stroke="#35C7C9"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="memory"
                    name="Memory"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="storage"
                    name="Storage"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
