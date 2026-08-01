import { useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
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

type CloudHostGroup = Doc<"cloudHostGroups">;
type CloudHealthTab =
  | "overview"
  | "alarms"
  | "capacity"
  | "network"
  | "host-groups";

const CLOUD_HEALTH_TABS: CloudHealthTab[] = [
  "overview",
  "alarms",
  "capacity",
  "network",
  "host-groups",
];

function canViewCloudHealth(role: string | undefined) {
  return role === "ceo" || role === "head_of_business" || role === "country_gm";
}

function isCloudHealthTab(value: string | null): value is CloudHealthTab {
  return CLOUD_HEALTH_TABS.includes(value as CloudHealthTab);
}

function getCloudHealthReturnPath(
  searchParams: URLSearchParams,
  fallbackTab: CloudHealthTab,
) {
  const returnTab = searchParams.get("returnTab");
  return `/cloud-health?tab=${isCloudHealthTab(returnTab) ? returnTab : fallbackTab}`;
}

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

function hostGroupRiskLabel(riskLevel: CloudHostGroup["riskLevel"]) {
  if (riskLevel === "critical") return "Critical";
  if (riskLevel === "watch") return "Watch";
  return "Healthy";
}

function hostGroupRiskBadgeVariant(riskLevel: CloudHostGroup["riskLevel"]) {
  if (riskLevel === "critical") return "destructive";
  if (riskLevel === "watch") return "secondary";
  return "outline";
}

function hostUtilizationStatus(cpuPercent: number, memoryPercent: number) {
  const peak = Math.max(cpuPercent, memoryPercent);
  if (peak >= 85) return "critical";
  if (peak >= 70) return "watch";
  return "healthy";
}

function SummaryCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm">{value}</div>
    </div>
  );
}

function NotFoundState() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnPath = getCloudHealthReturnPath(searchParams, "host-groups");

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button variant="outline" onClick={() => navigate(returnPath)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Cloud Health
      </Button>
      <Card>
        <CardContent className="py-12 text-center">
          <h1 className="text-xl font-semibold">Host group not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This host group is no longer active or is not available to your
            role.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CloudHealthHostGroupPage() {
  const { currentUser } = useCrm();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const returnPath = getCloudHealthReturnPath(searchParams, "host-groups");
  const canView = canViewCloudHealth(currentUser?.role);
  const hostGroups = useQuery(
    api.cloudHostGroups.listActive,
    canView ? {} : "skip",
  );
  const hostGroupId = params.hostGroupId
    ? decodeURIComponent(params.hostGroupId)
    : "";
  const hostGroup = useMemo(
    () => (hostGroups ?? []).find((item) => item.hostGroupId === hostGroupId),
    [hostGroupId, hostGroups],
  );

  if (!canView) {
    return (
      <div className="p-6 md:p-8">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Cloud Health is available to Country GM, Head of Business, and CEO
            roles.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (hostGroups === undefined) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!hostGroup) {
    return <NotFoundState />;
  }

  const sortedHosts = hostGroup.hosts
    .slice()
    .sort(
      (a, b) =>
        b.memoryPercent - a.memoryPercent || b.cpuPercent - a.cpuPercent,
    );

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button variant="outline" onClick={() => navigate(returnPath)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Cloud Health
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">{hostGroup.hostGroupName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ManageOne host group utilization and per-host hot spots.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Risk Level">
          <Badge variant={hostGroupRiskBadgeVariant(hostGroup.riskLevel)}>
            {hostGroupRiskLabel(hostGroup.riskLevel)}
          </Badge>
        </SummaryCard>
        <SummaryCard title="Region">
          <div className="font-medium">{hostGroup.regionName}</div>
          <div className="text-xs text-muted-foreground">
            {hostGroup.regionId}
          </div>
        </SummaryCard>
        <SummaryCard title="AZ">
          <div className="font-medium">{hostGroup.azName}</div>
          <div className="text-xs text-muted-foreground">{hostGroup.azId}</div>
        </SummaryCard>
        <SummaryCard title="Resource Pool">
          <div className="font-medium">{hostGroup.resourcePoolName}</div>
          <div className="text-xs text-muted-foreground">
            {hostGroup.resourcePoolId}
          </div>
        </SummaryCard>
        <SummaryCard title="Host Count">
          <div className="text-2xl font-semibold">{hostGroup.hostCount}</div>
          <div className="text-xs text-muted-foreground">
            {hostGroup.hypervisorType}
          </div>
        </SummaryCard>
        <SummaryCard title="CPU Avg / Max">
          <div className="text-2xl font-semibold">
            {formatNumber(hostGroup.cpuAvgPercent, "%")}
          </div>
          <p className="text-sm text-muted-foreground">
            Max {formatNumber(hostGroup.cpuMaxPercent, "%")}
          </p>
        </SummaryCard>
        <SummaryCard title="Memory Avg / Max">
          <div className="text-2xl font-semibold">
            {formatNumber(hostGroup.memoryAvgPercent, "%")}
          </div>
          <p className="text-sm text-muted-foreground">
            Max {formatNumber(hostGroup.memoryMaxPercent, "%")}
          </p>
        </SummaryCard>
        <SummaryCard title="Last Synced">
          <div className="font-medium">
            {formatDateTime(hostGroup.lastSyncedAt)}
          </div>
        </SummaryCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {hostGroup.riskReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No risk reasons reported.
              </p>
            ) : (
              <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {hostGroup.riskReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="Host Group ID" value={hostGroup.hostGroupId} />
            <DetailField label="Hypervisor" value={hostGroup.hypervisorType} />
            <DetailField label="AZ ID" value={hostGroup.azId} />
            <DetailField
              label="Resource Pool ID"
              value={hostGroup.resourcePoolId}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worst CPU Host</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {hostGroup.worstCpuHost ? (
              <>
                <div className="font-medium">
                  {hostGroup.worstCpuHost.hostName}
                </div>
                <div className="text-muted-foreground">
                  {hostGroup.worstCpuHost.hostId}
                </div>
                <div>
                  {formatNumber(hostGroup.worstCpuHost.cpuPercent, "%")}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">Not reported</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Worst Memory Host</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {hostGroup.worstMemoryHost ? (
              <>
                <div className="font-medium">
                  {hostGroup.worstMemoryHost.hostName}
                </div>
                <div className="text-muted-foreground">
                  {hostGroup.worstMemoryHost.hostId}
                </div>
                <div>
                  {formatNumber(hostGroup.worstMemoryHost.memoryPercent, "%")}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">Not reported</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hosts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Host Name</th>
                  <th className="px-3 py-2 font-medium">Manage IP</th>
                  <th className="px-3 py-2 text-right font-medium">CPU %</th>
                  <th className="px-3 py-2 text-right font-medium">Memory %</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedHosts.map((host) => {
                  const status = hostUtilizationStatus(
                    host.cpuPercent,
                    host.memoryPercent,
                  );

                  return (
                    <tr
                      key={host.hostId}
                      className={`border-t ${
                        status === "critical"
                          ? "bg-destructive/5"
                          : status === "watch"
                            ? "bg-amber-500/5"
                            : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{host.hostName}</div>
                        <div className="text-xs text-muted-foreground">
                          {host.hostId}
                        </div>
                      </td>
                      <td className="px-3 py-2">{host.manageIp ?? "-"}</td>
                      <td className="px-3 py-2 text-right">
                        {formatNumber(host.cpuPercent, "%")}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatNumber(host.memoryPercent, "%")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={hostGroupRiskBadgeVariant(status)}>
                          {hostGroupRiskLabel(status)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Raw ManageOne cluster payload
        </summary>
        <pre className="max-h-[520px] overflow-auto border-t bg-muted/30 p-4 text-xs">
          {JSON.stringify(hostGroup.rawCluster, null, 2)}
        </pre>
      </details>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Raw ManageOne host sample
        </summary>
        <pre className="max-h-[520px] overflow-auto border-t bg-muted/30 p-4 text-xs">
          {JSON.stringify(hostGroup.rawHostSample, null, 2)}
        </pre>
      </details>
    </div>
  );
}
