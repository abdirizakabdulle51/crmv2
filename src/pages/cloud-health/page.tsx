import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Pause,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  Wifi,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { toast } from "sonner";

function canViewCloudHealth(role: string | undefined) {
  return role === "ceo" || role === "head_of_business" || role === "country_gm";
}

function canManagePingTargets(role: string | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function statusColor(percent: number) {
  if (percent >= 90) return "#dc2626";
  if (percent >= 70) return "#d97706";
  return "#16a34a";
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

function RingGauge({
  label,
  percent,
  detail,
  oversubscriptionRatio,
}: {
  label: string;
  percent: number;
  detail: string;
  oversubscriptionRatio?: number;
}) {
  const color = statusColor(percent);

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div
        className="grid h-20 w-20 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(${color} ${Math.min(percent, 100) * 3.6}deg, color-mix(in oklch, var(--muted) 80%, transparent) 0deg)`,
        }}
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-card text-sm font-semibold">
          {percent}%
        </div>
      </div>
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
        {oversubscriptionRatio != null ? (
          <div className="text-xs text-muted-foreground">
            {formatNumber(oversubscriptionRatio, "%")} oversubscribed
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CloudHealthPage() {
  const { currentUser } = useCrm();
  const canView = canViewCloudHealth(currentUser?.role);
  const canManage = canManagePingTargets(currentUser?.role);
  const capacity = useQuery(api.cloudCapacity.list, canView ? {} : "skip");
  const targets = useQuery(api.pingTargets.list, canView ? {} : "skip");
  const statuses = useQuery(
    api.pingResults.latestStatusByTarget,
    canView ? {} : "skip",
  );
  const createTarget = useMutation(api.pingTargets.create);
  const setActive = useMutation(api.pingTargets.setActive);
  const removeTarget = useMutation(api.pingTargets.remove);

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedTargetId, setSelectedTargetId] =
    useState<Id<"pingTargets"> | null>(null);

  useEffect(() => {
    if (!selectedTargetId && targets && targets.length > 0) {
      setSelectedTargetId(targets[0]._id);
    }
  }, [selectedTargetId, targets]);

  const history = useQuery(
    api.pingResults.recentHistory,
    selectedTargetId ? { targetId: selectedTargetId, limit: 100 } : "skip",
  );

  const selectedTarget = targets?.find(
    (target) => target._id === selectedTargetId,
  );
  const chartData = useMemo(
    () =>
      [...(history ?? [])].reverse().map((result) => ({
        checkedAt: result.checkedAt,
        time: new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(result.checkedAt)),
        latencyMs: result.success ? (result.latencyMs ?? 0) : null,
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

  if (!capacity || !targets || !statuses) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const handleCreateTarget = async () => {
    if (!name.trim() || !ip.trim()) {
      toast.error("Name and IP are required");
      return;
    }

    setSubmitting(true);
    try {
      await createTarget({
        name: name.trim(),
        ip: ip.trim(),
        notes: notes.trim() || undefined,
      });
      setName("");
      setIp("");
      setNotes("");
      toast.success("Ping target added");
    } catch (error) {
      toast.error("Failed to add ping target", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetActive = async (
    targetId: Id<"pingTargets">,
    active: boolean,
  ) => {
    try {
      await setActive({ targetId, active });
      toast.success(active ? "Ping target resumed" : "Ping target paused");
    } catch (error) {
      toast.error("Failed to update ping target", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const handleDeleteTarget = async (targetId: Id<"pingTargets">) => {
    const confirmed = window.confirm(
      "Delete this ping target and all of its ping history? This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await removeTarget({ targetId });
      if (selectedTargetId === targetId) {
        setSelectedTargetId(null);
      }
      toast.success("Ping target deleted", {
        description: `${result.deletedResults} history row${
          result.deletedResults === 1 ? "" : "s"
        } removed`,
      });
    } catch (error) {
      toast.error("Failed to delete ping target", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cloud Health</h1>
        <p className="mt-1 text-muted-foreground">
          Infrastructure capacity and upstream network monitoring.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Infrastructure Capacity</h2>
        </div>
        {capacity.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No capacity regions synced yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {capacity.map((region) => (
              <Card key={region._id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    {region.regionName}
                    <span className="text-xs font-normal text-muted-foreground">
                      Synced {formatDateTime(region.lastSyncedAt)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <RingGauge
                    label="CPU"
                    percent={region.cpuUsedPercent}
                    detail={`${formatNumber(region.cpuUsed)} / ${formatNumber(region.cpuTotal)} cores`}
                    oversubscriptionRatio={region.cpuOversubscriptionRatio}
                  />
                  <RingGauge
                    label="Memory"
                    percent={region.memoryUsedPercent}
                    detail={`${formatNumber(region.memoryUsedGb, " GB")} / ${formatNumber(region.memoryTotalGb, " GB")}`}
                    oversubscriptionRatio={region.memoryOversubscriptionRatio}
                  />
                  <RingGauge
                    label="Storage"
                    percent={region.storageUsedPercent}
                    detail={`${formatNumber(region.storageUsedGb, " GB")} / ${formatNumber(region.storageTotalGb, " GB")}`}
                    oversubscriptionRatio={region.storageOversubscriptionRatio}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wifi className="h-4 w-4 text-primary" />
              Network Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {statuses.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No ping targets configured yet.
              </div>
            ) : (
              statuses.map((status) => (
                <div
                  key={status.target._id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1 h-3 w-3 rounded-full ${
                        status.latest?.success ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {status.target.name}
                        </span>
                        <Badge
                          variant={
                            status.target.active ? "default" : "secondary"
                          }
                        >
                          {status.target.active ? "Active" : "Paused"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {status.target.ip} · Last checked{" "}
                        {formatDateTime(status.latest?.checkedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <div className="font-semibold">
                        {status.latest?.success
                          ? formatNumber(status.latest.latencyMs, " ms")
                          : "Down"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Latest latency
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold">
                        {status.uptime24hPercent == null
                          ? "-"
                          : `${status.uptime24hPercent}%`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        24h uptime
                      </div>
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleSetActive(
                              status.target._id,
                              !status.target.active,
                            )
                          }
                        >
                          {status.target.active ? (
                            <Pause className="mr-2 h-4 w-4" />
                          ) : (
                            <Play className="mr-2 h-4 w-4" />
                          )}
                          {status.target.active ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteTarget(status.target._id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add Ping Target</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="target-name">Name</Label>
                  <Input
                    id="target-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Upstream ISP"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="target-ip">IP Address</Label>
                  <Input
                    id="target-ip"
                    value={ip}
                    onChange={(event) => setIp(event.target.value)}
                    placeholder="196.201.0.1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="target-notes">Notes</Label>
                  <Input
                    id="target-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleCreateTarget}
                  disabled={submitting}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Target
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latency Trend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {targets.length > 0 ? (
                <Select
                  value={selectedTargetId ?? ""}
                  onValueChange={(value) =>
                    setSelectedTargetId(value as Id<"pingTargets">)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((target) => (
                      <SelectItem key={target._id} value={target._id}>
                        {target.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <div className="h-64">
                {selectedTarget && chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="opacity-30"
                      />
                      <XAxis dataKey="time" className="text-xs" />
                      <YAxis className="text-xs" unit=" ms" />
                      <Tooltip
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.checkedAt
                            ? formatDateTime(payload[0].payload.checkedAt)
                            : ""
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="latencyMs"
                        name="Latency"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center rounded-lg border text-sm text-muted-foreground">
                    {selectedTarget
                      ? "No recent ping history yet."
                      : "Select a target to view latency."}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
