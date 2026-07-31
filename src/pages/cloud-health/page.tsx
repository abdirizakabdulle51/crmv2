import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
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
  Activity,
  BellRing,
  Globe2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { toast } from "sonner";

function canViewCloudHealth(role: string | undefined) {
  return role === "ceo" || role === "head_of_business" || role === "country_gm";
}

function canManagePingTargets(role: string | undefined) {
  return role === "ceo" || role === "head_of_business";
}

type ServiceCheckType = "http" | "tcp" | "dns";

function formatCheckType(checkType: ServiceCheckType) {
  if (checkType === "http") return "HTTP";
  if (checkType === "tcp") return "TCP";
  return "DNS";
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

function categoryLabel(category: number) {
  return `Category ${category}`;
}

const LATENCY_LINE_COLORS = [
  "#0d9488",
  "#2563eb",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#16a34a",
  "#0891b2",
  "#be123c",
];

// Flip this back on when the service/DNS target-entry UX is finalized.
const SHOW_SERVICE_DNS_HEALTH = false;

type LatencyRangeId =
  | "last_5_minutes"
  | "last_15_minutes"
  | "last_30_minutes"
  | "last_1_hour"
  | "last_3_hours"
  | "last_6_hours"
  | "last_12_hours"
  | "last_24_hours"
  | "last_2_days"
  | "last_7_days"
  | "last_30_days"
  | "yesterday"
  | "day_before_yesterday"
  | "this_day_last_week"
  | "previous_week"
  | "previous_month"
  | "today"
  | "today_so_far"
  | "this_week"
  | "this_week_so_far"
  | "this_month"
  | "this_month_so_far";

const LATENCY_RANGE_OPTIONS: Array<{ id: LatencyRangeId; label: string }> = [
  { id: "last_5_minutes", label: "Last 5 minutes" },
  { id: "last_15_minutes", label: "Last 15 minutes" },
  { id: "last_30_minutes", label: "Last 30 minutes" },
  { id: "last_1_hour", label: "Last 1 hour" },
  { id: "last_3_hours", label: "Last 3 hours" },
  { id: "last_6_hours", label: "Last 6 hours" },
  { id: "last_12_hours", label: "Last 12 hours" },
  { id: "last_24_hours", label: "Last 24 hours" },
  { id: "last_2_days", label: "Last 2 days" },
  { id: "last_7_days", label: "Last 7 days" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "yesterday", label: "Yesterday" },
  { id: "day_before_yesterday", label: "Day before yesterday" },
  { id: "this_day_last_week", label: "This day last week" },
  { id: "previous_week", label: "Previous week" },
  { id: "previous_month", label: "Previous month" },
  { id: "today", label: "Today" },
  { id: "today_so_far", label: "Today so far" },
  { id: "this_week", label: "This week" },
  { id: "this_week_so_far", label: "This week so far" },
  { id: "this_month", label: "This month" },
  { id: "this_month_so_far", label: "This month so far" },
];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function startOfWeek(date: Date) {
  const start = startOfDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function endOfWeek(date: Date) {
  const end = startOfWeek(date);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function getLatencyRange(rangeId: LatencyRangeId, nowMs: number) {
  const now = new Date(nowMs);
  const previousDay = new Date(now);
  previousDay.setDate(previousDay.getDate() - 1);
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const lastWeekDay = new Date(now);
  lastWeekDay.setDate(lastWeekDay.getDate() - 7);

  switch (rangeId) {
    case "last_5_minutes":
      return { from: nowMs - 5 * 60 * 1000, to: nowMs };
    case "last_15_minutes":
      return { from: nowMs - 15 * 60 * 1000, to: nowMs };
    case "last_30_minutes":
      return { from: nowMs - 30 * 60 * 1000, to: nowMs };
    case "last_1_hour":
      return { from: nowMs - 60 * 60 * 1000, to: nowMs };
    case "last_3_hours":
      return { from: nowMs - 3 * 60 * 60 * 1000, to: nowMs };
    case "last_6_hours":
      return { from: nowMs - 6 * 60 * 60 * 1000, to: nowMs };
    case "last_12_hours":
      return { from: nowMs - 12 * 60 * 60 * 1000, to: nowMs };
    case "last_24_hours":
      return { from: nowMs - 24 * 60 * 60 * 1000, to: nowMs };
    case "last_2_days":
      return { from: nowMs - 2 * 24 * 60 * 60 * 1000, to: nowMs };
    case "last_7_days":
      return { from: nowMs - 7 * 24 * 60 * 60 * 1000, to: nowMs };
    case "last_30_days":
      return { from: nowMs - 30 * 24 * 60 * 60 * 1000, to: nowMs };
    case "yesterday":
      return {
        from: startOfDay(previousDay).getTime(),
        to: endOfDay(previousDay).getTime(),
      };
    case "day_before_yesterday":
      return {
        from: startOfDay(twoDaysAgo).getTime(),
        to: endOfDay(twoDaysAgo).getTime(),
      };
    case "this_day_last_week":
      return {
        from: startOfDay(lastWeekDay).getTime(),
        to: endOfDay(lastWeekDay).getTime(),
      };
    case "previous_week": {
      const previousWeek = startOfWeek(now);
      previousWeek.setDate(previousWeek.getDate() - 7);
      return {
        from: previousWeek.getTime(),
        to: endOfWeek(previousWeek).getTime(),
      };
    }
    case "previous_month":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        to: new Date(
          now.getFullYear(),
          now.getMonth(),
          0,
          23,
          59,
          59,
          999,
        ).getTime(),
      };
    case "today":
      return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() };
    case "today_so_far":
      return { from: startOfDay(now).getTime(), to: nowMs };
    case "this_week":
      return { from: startOfWeek(now).getTime(), to: endOfWeek(now).getTime() };
    case "this_week_so_far":
      return { from: startOfWeek(now).getTime(), to: nowMs };
    case "this_month":
      return {
        from: startOfMonth(now).getTime(),
        to: endOfMonth(now).getTime(),
      };
    case "this_month_so_far":
      return { from: startOfMonth(now).getTime(), to: nowMs };
  }
}

function getLatencyAxisDomain(values: number[]): [number, number] | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 5);
  const padding = span * 0.2;
  return [Math.max(0, Math.floor(min - padding)), Math.ceil(max + padding)];
}

function RingGauge({
  label,
  percent,
  detail,
  oversubscriptionRatio,
  onClick,
}: {
  label: string;
  percent: number;
  detail: string;
  oversubscriptionRatio?: number;
  onClick?: () => void;
}) {
  const color = statusColor(percent);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
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
    </button>
  );
}

export default function CloudHealthPage() {
  const { currentUser } = useCrm();
  const navigate = useNavigate();
  const canView = canViewCloudHealth(currentUser?.role);
  const canManage = canManagePingTargets(currentUser?.role);
  const capacity = useQuery(api.cloudCapacity.list, canView ? {} : "skip");
  const alarmsSummary = useQuery(
    api.cloudAlarms.summary,
    canView ? {} : "skip",
  );
  const targets = useQuery(api.pingTargets.list, canView ? {} : "skip");
  const statuses = useQuery(
    api.pingResults.latestStatusByTarget,
    canView ? {} : "skip",
  );
  const createTarget = useMutation(api.pingTargets.create);
  const setActive = useMutation(api.pingTargets.setActive);
  const removeTarget = useMutation(api.pingTargets.remove);
  const serviceTargets = useQuery(
    api.serviceHealthTargets.list,
    canView && SHOW_SERVICE_DNS_HEALTH ? {} : "skip",
  );
  const serviceStatuses = useQuery(
    api.serviceHealthResults.latestStatusByTarget,
    canView && SHOW_SERVICE_DNS_HEALTH ? {} : "skip",
  );
  const createServiceTarget = useMutation(api.serviceHealthTargets.create);
  const setServiceTargetActive = useMutation(
    api.serviceHealthTargets.setActive,
  );

  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [alarmSeverityFilter, setAlarmSeverityFilter] = useState("all");
  const [alarmRegionFilter, setAlarmRegionFilter] = useState("all");
  const [alarmCategoryFilter, setAlarmCategoryFilter] = useState("all");
  const [serviceName, setServiceName] = useState("");
  const [serviceCheckType, setServiceCheckType] =
    useState<ServiceCheckType>("http");
  const [serviceTargetValue, setServiceTargetValue] = useState("");
  const [expectedStatusCode, setExpectedStatusCode] = useState("");
  const [expectedResponseContains, setExpectedResponseContains] = useState("");
  const [expectedIp, setExpectedIp] = useState("");
  const [serviceNotes, setServiceNotes] = useState("");
  const [serviceSubmitting, setServiceSubmitting] = useState(false);
  const [selectedServiceTargetId, setSelectedServiceTargetId] = useState("");
  const [hiddenLatencyTargetIds, setHiddenLatencyTargetIds] = useState<
    Set<string>
  >(new Set());
  const [latencyRangeId, setLatencyRangeId] =
    useState<LatencyRangeId>("last_3_hours");
  const [latencyRangeCalculatedAt, setLatencyRangeCalculatedAt] = useState(() =>
    Date.now(),
  );
  const latencyRange = useMemo(
    () => getLatencyRange(latencyRangeId, latencyRangeCalculatedAt),
    [latencyRangeCalculatedAt, latencyRangeId],
  );
  const alarmFilters = useMemo(
    () => ({
      ...(alarmSeverityFilter !== "all"
        ? { severity: Number(alarmSeverityFilter) }
        : {}),
      ...(alarmRegionFilter !== "all"
        ? { logicalRegionId: alarmRegionFilter }
        : {}),
      ...(alarmCategoryFilter !== "all"
        ? { category: Number(alarmCategoryFilter) }
        : {}),
    }),
    [alarmCategoryFilter, alarmRegionFilter, alarmSeverityFilter],
  );
  const activeAlarms = useQuery(
    api.cloudAlarms.listActive,
    canView ? alarmFilters : "skip",
  );
  const latencyHistory = useQuery(
    api.pingResults.historyForActiveTargetsInRange,
    canView ? latencyRange : "skip",
  );
  const chartData = useMemo(
    () =>
      (latencyHistory?.buckets ?? []).map((bucket) => ({
        ...bucket,
        time: new Intl.DateTimeFormat("en-US", {
          ...(latencyHistory?.bucketSizeMs &&
          latencyHistory.bucketSizeMs > 60 * 1000
            ? { month: "short", day: "numeric" }
            : {}),
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(bucket.checkedAt as number)),
      })),
    [latencyHistory],
  );
  const latencyTargets = useMemo(
    () => latencyHistory?.targets ?? [],
    [latencyHistory?.targets],
  );
  const latencyAxisDomain = useMemo(() => {
    const visibleTargetIds = latencyTargets
      .map((target) => target._id)
      .filter((targetId) => !hiddenLatencyTargetIds.has(targetId));
    const values: number[] = [];

    for (const row of chartData) {
      const latencyRow = row as Record<string, unknown>;
      for (const targetId of visibleTargetIds) {
        const value = latencyRow[targetId];
        if (typeof value === "number") {
          values.push(value);
        }
      }
    }

    return getLatencyAxisDomain(values);
  }, [chartData, hiddenLatencyTargetIds, latencyTargets]);
  const visibleServiceTargets = serviceTargets ?? [];
  const visibleServiceStatuses = serviceStatuses ?? [];
  const serviceHistory = useQuery(
    api.serviceHealthResults.recentHistory,
    canView && SHOW_SERVICE_DNS_HEALTH && selectedServiceTargetId
      ? {
          targetId: selectedServiceTargetId as Id<"serviceHealthTargets">,
          limit: 100,
        }
      : "skip",
  );
  const serviceChartData = useMemo(
    () =>
      (serviceHistory ?? [])
        .slice()
        .reverse()
        .map((result) => ({
          ...result,
          latency: result.success ? (result.latencyMs ?? null) : null,
          time: new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(result.checkedAt)),
        })),
    [serviceHistory],
  );
  const alarmRegions = useMemo(() => {
    const regions = new Map<string, string>();
    for (const alarm of activeAlarms ?? []) {
      if (alarm.logicalRegionId) {
        regions.set(
          alarm.logicalRegionId,
          alarm.logicalRegionName ?? alarm.logicalRegionId,
        );
      }
    }
    return [...regions.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [activeAlarms]);
  const alarmCategories = useMemo(() => {
    return [
      ...new Set((activeAlarms ?? []).map((alarm) => alarm.category)),
    ].sort((a, b) => a - b);
  }, [activeAlarms]);

  useEffect(() => {
    if (!serviceTargets) {
      return;
    }

    if (
      selectedServiceTargetId &&
      serviceTargets.some((target) => target._id === selectedServiceTargetId)
    ) {
      return;
    }

    setSelectedServiceTargetId(serviceTargets[0]?._id ?? "");
  }, [selectedServiceTargetId, serviceTargets]);

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

  if (
    !capacity ||
    !alarmsSummary ||
    !activeAlarms ||
    !targets ||
    !statuses ||
    (SHOW_SERVICE_DNS_HEALTH && (!serviceTargets || !serviceStatuses))
  ) {
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

  const handleCreateServiceTarget = async () => {
    if (!serviceName.trim() || !serviceTargetValue.trim()) {
      toast.error("Name and target are required");
      return;
    }

    const parsedStatusCode = expectedStatusCode.trim()
      ? Number(expectedStatusCode)
      : undefined;
    if (
      serviceCheckType === "http" &&
      parsedStatusCode !== undefined &&
      (!Number.isFinite(parsedStatusCode) || parsedStatusCode <= 0)
    ) {
      toast.error("Expected status code must be a positive number");
      return;
    }

    setServiceSubmitting(true);
    try {
      await createServiceTarget({
        name: serviceName.trim(),
        checkType: serviceCheckType,
        target: serviceTargetValue.trim(),
        ...(serviceCheckType === "http" && parsedStatusCode !== undefined
          ? { expectedStatusCode: parsedStatusCode }
          : {}),
        ...(serviceCheckType === "http" && expectedResponseContains.trim()
          ? { expectedResponseContains: expectedResponseContains.trim() }
          : {}),
        ...(serviceCheckType === "dns" && expectedIp.trim()
          ? { expectedIp: expectedIp.trim() }
          : {}),
        notes: serviceNotes.trim() || undefined,
      });
      setServiceName("");
      setServiceTargetValue("");
      setExpectedStatusCode("");
      setExpectedResponseContains("");
      setExpectedIp("");
      setServiceNotes("");
      toast.success("Service health target added");
    } catch (error) {
      toast.error("Failed to add service health target", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setServiceSubmitting(false);
    }
  };

  const handleSetServiceTargetActive = async (
    targetId: Id<"serviceHealthTargets">,
    active: boolean,
  ) => {
    try {
      await setServiceTargetActive({ targetId, active });
      toast.success(
        active
          ? "Service health target resumed"
          : "Service health target paused",
      );
    } catch (error) {
      toast.error("Failed to update service health target", {
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
          <BellRing className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Active Alarms</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {alarmsSummary.active}
              </div>
              <p className="text-xs text-muted-foreground">
                Synced {formatDateTime(alarmsSummary.lastSyncedAt)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Critical
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-destructive">
                {alarmsSummary.critical}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Major
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {alarmsSummary.major}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Linked Tenants
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {alarmsSummary.tenantLinked}
              </div>
              <p className="text-xs text-muted-foreground">
                {alarmsSummary.platform} platform-level
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Regions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {alarmsSummary.regions}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-base">
                Current ManageOne Alarms
              </CardTitle>
              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  value={alarmSeverityFilter}
                  onValueChange={setAlarmSeverityFilter}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="1">Critical</SelectItem>
                    <SelectItem value="2">Major</SelectItem>
                    <SelectItem value="3">Minor</SelectItem>
                    <SelectItem value="4">Warning</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={alarmRegionFilter}
                  onValueChange={setAlarmRegionFilter}
                >
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Region" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Regions</SelectItem>
                    {alarmRegions.map(([regionId, regionName]) => (
                      <SelectItem key={regionId} value={regionId}>
                        {regionName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={alarmCategoryFilter}
                  onValueChange={setAlarmCategoryFilter}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {alarmCategories.map((category) => (
                      <SelectItem key={category} value={String(category)}>
                        {categoryLabel(category)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {activeAlarms.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No active alarms match the selected filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Alarm</th>
                      <th className="px-3 py-2 font-medium">Resource</th>
                      <th className="px-3 py-2 font-medium">Region</th>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Occurred</th>
                      <th className="px-3 py-2 font-medium">Ack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAlarms.map((alarm) => (
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
                            {alarm.meCategory ??
                              alarm.meType ??
                              alarm.moc ??
                              "-"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {alarm.logicalRegionName ??
                            alarm.logicalRegionId ??
                            "-"}
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
      </section>

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
                    onClick={() =>
                      navigate(
                        `/cloud-health/regions/${encodeURIComponent(region.regionId)}`,
                      )
                    }
                  />
                  <RingGauge
                    label="Memory"
                    percent={region.memoryUsedPercent}
                    detail={`${formatNumber(region.memoryUsedGb, " GB")} / ${formatNumber(region.memoryTotalGb, " GB")}`}
                    oversubscriptionRatio={region.memoryOversubscriptionRatio}
                    onClick={() =>
                      navigate(
                        `/cloud-health/regions/${encodeURIComponent(region.regionId)}`,
                      )
                    }
                  />
                  <RingGauge
                    label="Storage"
                    percent={region.storageUsedPercent}
                    detail={`${formatNumber(region.storageUsedGb, " GB")} / ${formatNumber(region.storageTotalGb, " GB")}`}
                    oversubscriptionRatio={region.storageOversubscriptionRatio}
                    onClick={() =>
                      navigate(
                        `/cloud-health/regions/${encodeURIComponent(region.regionId)}`,
                      )
                    }
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
              <Select
                value={latencyRangeId}
                onValueChange={(value) => {
                  setLatencyRangeId(value as LatencyRangeId);
                  setLatencyRangeCalculatedAt(Date.now());
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LATENCY_RANGE_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="h-64">
                {latencyTargets.length > 0 && chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="opacity-30"
                      />
                      <XAxis dataKey="time" className="text-xs" />
                      <YAxis
                        className="text-xs"
                        unit=" ms"
                        domain={latencyAxisDomain}
                      />
                      <Tooltip
                        labelFormatter={(_, payload) =>
                          payload?.[0]?.payload?.checkedAt
                            ? formatDateTime(payload[0].payload.checkedAt)
                            : ""
                        }
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={32}
                        onClick={(entry) => {
                          const targetId = String(entry.dataKey ?? "");
                          if (!targetId) {
                            return;
                          }
                          setHiddenLatencyTargetIds((current) => {
                            const next = new Set(current);
                            if (next.has(targetId)) {
                              next.delete(targetId);
                            } else {
                              next.add(targetId);
                            }
                            return next;
                          });
                        }}
                      />
                      {latencyTargets.map((target, index) => (
                        <Line
                          key={target._id}
                          type="monotone"
                          dataKey={target._id}
                          name={target.name}
                          stroke={
                            LATENCY_LINE_COLORS[
                              index % LATENCY_LINE_COLORS.length
                            ]
                          }
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                          hide={hiddenLatencyTargetIds.has(target._id)}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center rounded-lg border text-sm text-muted-foreground">
                    {latencyTargets.length > 0
                      ? "No recent ping history yet."
                      : "No active ping targets to chart."}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {SHOW_SERVICE_DNS_HEALTH && (
        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe2 className="h-4 w-4 text-primary" />
                Service &amp; DNS Health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {visibleServiceStatuses.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No service health targets configured yet.
                </div>
              ) : (
                visibleServiceStatuses.map((status) => (
                  <div
                    key={status.target._id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-1 h-3 w-3 rounded-full ${
                          status.latest?.success
                            ? "bg-emerald-500"
                            : "bg-red-500"
                        }`}
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {status.target.name}
                          </span>
                          <Badge variant="secondary">
                            {formatCheckType(status.target.checkType)}
                          </Badge>
                          <Badge
                            variant={
                              status.target.active ? "default" : "secondary"
                            }
                          >
                            {status.target.active ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {status.target.target} Â· Last checked{" "}
                          {formatDateTime(status.latest?.checkedAt)}
                        </div>
                        {status.latest?.resolvedValue ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {status.latest.resolvedValue}
                          </div>
                        ) : null}
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleSetServiceTargetActive(
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
                  <CardTitle className="text-base">
                    Add Service Health Target
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="service-target-name">Name</Label>
                    <Input
                      id="service-target-name"
                      value={serviceName}
                      onChange={(event) => setServiceName(event.target.value)}
                      placeholder="CRM API"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Check Type</Label>
                    <Select
                      value={serviceCheckType}
                      onValueChange={(value) =>
                        setServiceCheckType(value as ServiceCheckType)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="http">HTTP</SelectItem>
                        <SelectItem value="tcp">TCP</SelectItem>
                        <SelectItem value="dns">DNS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="service-target-value">Target</Label>
                    <Input
                      id="service-target-value"
                      value={serviceTargetValue}
                      onChange={(event) =>
                        setServiceTargetValue(event.target.value)
                      }
                      placeholder={
                        serviceCheckType === "http"
                          ? "https://crm-api.example.com"
                          : serviceCheckType === "tcp"
                            ? "crm-api.example.com:443"
                            : "crm.example.com"
                      }
                    />
                  </div>
                  {serviceCheckType === "http" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="expected-status-code">
                          Expected Status Code
                        </Label>
                        <Input
                          id="expected-status-code"
                          type="number"
                          value={expectedStatusCode}
                          onChange={(event) =>
                            setExpectedStatusCode(event.target.value)
                          }
                          placeholder="200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="expected-response">
                          Expected Response Contains
                        </Label>
                        <Input
                          id="expected-response"
                          value={expectedResponseContains}
                          onChange={(event) =>
                            setExpectedResponseContains(event.target.value)
                          }
                          placeholder="Optional"
                        />
                      </div>
                    </>
                  ) : null}
                  {serviceCheckType === "dns" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="expected-ip">Expected IP</Label>
                      <Input
                        id="expected-ip"
                        value={expectedIp}
                        onChange={(event) => setExpectedIp(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="service-notes">Notes</Label>
                    <Input
                      id="service-notes"
                      value={serviceNotes}
                      onChange={(event) => setServiceNotes(event.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleCreateServiceTarget}
                    disabled={serviceSubmitting}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Service Target
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Service Latency Trend
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select
                  value={selectedServiceTargetId}
                  onValueChange={setSelectedServiceTargetId}
                  disabled={visibleServiceTargets.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select service target" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleServiceTargets.map((target) => (
                      <SelectItem key={target._id} value={target._id}>
                        {target.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="h-64">
                  {selectedServiceTargetId && serviceChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={serviceChartData}>
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
                          dataKey="latency"
                          name="Latency"
                          stroke="#0d9488"
                          strokeWidth={2}
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center rounded-lg border text-sm text-muted-foreground">
                      {selectedServiceTargetId
                        ? "No recent service health history yet."
                        : "No service health target selected."}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </div>
  );
}
