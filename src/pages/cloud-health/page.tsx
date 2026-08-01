import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  LayoutDashboard,
  Pause,
  Play,
  Plus,
  Server,
  ShieldAlert,
  Trash2,
  Wifi,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
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
import { Tabs, TabsContent } from "@/components/ui/tabs.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { toast } from "sonner";

function canViewCloudHealth(role: string | undefined) {
  return role === "ceo" || role === "head_of_business" || role === "country_gm";
}

function canManagePingTargets(role: string | undefined) {
  return role === "ceo" || role === "head_of_business";
}

type ServiceCheckType = "http" | "tcp" | "dns";
type CloudAlarmWithCompany = Doc<"cloudAlarms"> & {
  linkedCompanyName?: string | null;
};
type AlarmView = "all" | "repeated";

type RepeatedAlarmPattern = {
  key: string;
  alarmId: string;
  alarmName: string;
  resource: string;
  region: string;
  company: string;
  count: number;
  worstSeverity: number;
  firstSeen: number;
  latestSeen: number;
  ackedCount: number;
  clearedCount: number;
  severityCounts: Record<number, number>;
  latestAlarm: CloudAlarmWithCompany;
  alarms: CloudAlarmWithCompany[];
};
type CloudHostGroup = Doc<"cloudHostGroups">;

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

function hostGroupRiskSortValue(riskLevel: CloudHostGroup["riskLevel"]) {
  if (riskLevel === "critical") return 0;
  if (riskLevel === "watch") return 1;
  return 2;
}

function hostUtilizationStatus(cpuPercent: number, memoryPercent: number) {
  const peak = Math.max(cpuPercent, memoryPercent);
  if (peak >= 85) return "critical";
  if (peak >= 70) return "watch";
  return "healthy";
}

function getHostGroupSearchText(hostGroup: CloudHostGroup) {
  return [
    hostGroup.hostGroupName,
    hostGroup.hostGroupId,
    hostGroup.regionName,
    hostGroup.regionId,
    hostGroup.azName,
    hostGroup.resourcePoolName,
    hostGroup.hypervisorType,
    ...hostGroup.hosts.flatMap((host) => [
      host.hostName,
      host.hostId,
      host.manageIp,
    ]),
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .toLowerCase();
}

function categoryLabel(category: number) {
  return `Category ${category}`;
}

const LATENCY_LINE_COLORS = [
  "#35C7C9",
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
const ALARM_PAGE_SIZE = 50;

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

type AlarmShortcut =
  | "all"
  | "critical"
  | "major"
  | "linked"
  | "regions"
  | "custom";

type AlarmTimeRange =
  | "all"
  | "today"
  | "yesterday"
  | "last_7_days"
  | "this_month"
  | "last_month"
  | "custom";

function parseDateInput(value: string, endOfSelectedDay = false) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(
    year,
    month - 1,
    day,
    endOfSelectedDay ? 23 : 0,
    endOfSelectedDay ? 59 : 0,
    endOfSelectedDay ? 59 : 0,
    endOfSelectedDay ? 999 : 0,
  ).getTime();
}

function getAlarmTimestamp(alarm: CloudAlarmWithCompany) {
  return alarm.latestOccurUtc ?? alarm.occurUtc ?? 0;
}

function getAlarmResourceKey(alarm: CloudAlarmWithCompany) {
  return [alarm.meName, alarm.address].filter(Boolean).join(" / ") || "unknown";
}

function getAlarmRegionKey(alarm: CloudAlarmWithCompany) {
  return (
    [alarm.logicalRegionId, alarm.logicalRegionName].filter(Boolean).join(" / ") ||
    "unknown"
  );
}

function getAlarmOwnerKey(alarm: CloudAlarmWithCompany) {
  if (alarm.linkedCompanyId) {
    return `company:${alarm.linkedCompanyId}`;
  }

  if (alarm.vdcId || alarm.tenantId || alarm.tenant) {
    return `tenant:${[alarm.vdcId, alarm.tenantId, alarm.tenant]
      .filter(Boolean)
      .join(" / ")}`;
  }

  return "platform";
}

function getAlarmCompanyLabel(alarm: CloudAlarmWithCompany) {
  return alarm.linkedCompanyName ?? alarm.tenant ?? alarm.vdcName ?? "Platform";
}

function getAlarmSearchText(alarm: CloudAlarmWithCompany) {
  return [
    alarm.alarmName,
    alarm.csn,
    alarm.alarmId,
    alarm.meName,
    alarm.meCategory,
    alarm.meType,
    alarm.moc,
    alarm.logicalRegionName,
    alarm.linkedCompanyName,
    alarm.tenant,
    alarm.vdcName,
    alarm.address,
    alarm.probableCause,
    alarm.additionalInformation,
    JSON.stringify(alarm.rawPayload),
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ")
    .toLowerCase();
}

function getRepeatedAlarmPatternKey(alarm: CloudAlarmWithCompany) {
  return JSON.stringify([
    alarm.alarmId,
    alarm.alarmName,
    getAlarmResourceKey(alarm),
    getAlarmRegionKey(alarm),
    getAlarmOwnerKey(alarm),
  ]);
}

function buildRepeatedAlarmPatterns(
  alarms: CloudAlarmWithCompany[],
  minimumRepeats: number,
) {
  const groups = new Map<string, CloudAlarmWithCompany[]>();

  for (const alarm of alarms) {
    const key = getRepeatedAlarmPatternKey(alarm);
    groups.set(key, [...(groups.get(key) ?? []), alarm]);
  }

  return [...groups.entries()]
    .map(([key, groupAlarms]): RepeatedAlarmPattern => {
      const sortedAlarms = [...groupAlarms].sort(
        (a, b) => getAlarmTimestamp(b) - getAlarmTimestamp(a),
      );
      const latestAlarm = sortedAlarms[0];
      const firstSeen = Math.min(...groupAlarms.map(getAlarmTimestamp));
      const latestSeen = Math.max(...groupAlarms.map(getAlarmTimestamp));
      const severityCounts = groupAlarms.reduce<Record<number, number>>(
        (counts, alarm) => {
          counts[alarm.severity] = (counts[alarm.severity] ?? 0) + 1;
          return counts;
        },
        {},
      );

      return {
        key,
        alarmId: latestAlarm.alarmId,
        alarmName: latestAlarm.alarmName,
        resource: latestAlarm.meName || latestAlarm.address || "-",
        region:
          latestAlarm.logicalRegionName ?? latestAlarm.logicalRegionId ?? "-",
        company: getAlarmCompanyLabel(latestAlarm),
        count: groupAlarms.length,
        worstSeverity: Math.min(...groupAlarms.map((alarm) => alarm.severity)),
        firstSeen,
        latestSeen,
        ackedCount: groupAlarms.filter((alarm) => alarm.acked).length,
        clearedCount: groupAlarms.filter((alarm) => alarm.cleared).length,
        severityCounts,
        latestAlarm,
        alarms: sortedAlarms,
      };
    })
    .filter((pattern) => pattern.count >= minimumRepeats)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.worstSeverity - b.worstSeverity ||
        b.latestSeen - a.latestSeen,
    );
}

function getAlarmTimeRangeBounds(
  range: AlarmTimeRange,
  customStartDate: string,
  customEndDate: string,
) {
  const now = new Date();

  switch (range) {
    case "all":
      return null;
    case "today":
      return {
        from: startOfDay(now).getTime(),
        to: endOfDay(now).getTime(),
      };
    case "yesterday": {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        from: startOfDay(yesterday).getTime(),
        to: endOfDay(yesterday).getTime(),
      };
    }
    case "last_7_days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return {
        from: startOfDay(start).getTime(),
        to: endOfDay(now).getTime(),
      };
    }
    case "this_month":
      return {
        from: startOfMonth(now).getTime(),
        to: endOfMonth(now).getTime(),
      };
    case "last_month":
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
    case "custom": {
      if (!customStartDate || !customEndDate) {
        return null;
      }

      const from = parseDateInput(customStartDate);
      const to = parseDateInput(customEndDate, true);
      if (from == null || to == null) {
        return null;
      }

      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

function inferAlarmShortcutFromFilters(
  severity: string,
  region: string,
  category: string,
): AlarmShortcut {
  if (severity === "all" && region === "all" && category === "all") {
    return "all";
  }

  if (severity === "1" && region === "all" && category === "all") {
    return "critical";
  }

  if (severity === "2" && region === "all" && category === "all") {
    return "major";
  }

  return "custom";
}

function AlarmShortcutCard({
  title,
  value,
  detail,
  active,
  onClick,
  valueClassName,
}: {
  title: string;
  value: number;
  detail?: ReactNode;
  active: boolean;
  onClick: () => void;
  valueClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "border-primary bg-primary/10 ring-2 ring-primary/25" : ""
      }`}
    >
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className={`mt-4 text-2xl font-semibold ${valueClassName ?? ""}`}>
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </button>
  );
}

function displayValue(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

function getEngineeringNextSteps(alarm: CloudAlarmWithCompany) {
  const alarmText = [
    alarm.alarmName,
    alarm.meName,
    alarm.meCategory,
    alarm.meType,
    alarm.moc,
    alarm.additionalInformation,
    alarm.probableCause,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (alarmText.includes("eip") || alarmText.includes("bandwidth")) {
    return [
      "Check the EIP bandwidth limit and current traffic trend.",
      "Confirm which resource the EIP is attached to and whether the customer needs a higher bandwidth tier.",
    ];
  }

  if (alarmText.includes("kafka")) {
    return [
      "Check Kafka node, partition, and replica health.",
      "Confirm whether platform services depending on Kafka are degraded or delayed.",
    ];
  }

  if (alarmText.includes("storage") || alarmText.includes("capacity")) {
    return [
      "Check storage pool capacity, allocation pressure, and recent growth.",
      "Confirm whether cleanup, expansion, or customer capacity planning is needed.",
    ];
  }

  if (alarmText.includes("vpn")) {
    return [
      "Check VPN tunnel, session, and connectivity status.",
      "Confirm peer reachability and any recent configuration or upstream changes.",
    ];
  }

  if (alarmText.includes("db") || alarmText.includes("database")) {
    return [
      "Check DB service status and active failover or replication state.",
      "Confirm whether the affected database service has customer impact.",
    ];
  }

  return [
    "Review the affected resource, probable cause, and ManageOne recommended action.",
  ];
}

function AlarmDetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm">{value}</div>
    </div>
  );
}

function AlarmDetailSheet({
  alarm,
  open,
  onOpenChange,
}: {
  alarm: CloudAlarmWithCompany | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nextSteps = alarm ? getEngineeringNextSteps(alarm) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl">
        <SheetHeader className="border-b pr-10">
          <SheetTitle>{alarm?.alarmName ?? "Alarm details"}</SheetTitle>
          <SheetDescription>
            Full ManageOne alarm context for engineering investigation.
          </SheetDescription>
        </SheetHeader>
        {alarm ? (
          <div className="space-y-6 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityBadgeVariant(alarm.severity)}>
                {severityLabel(alarm.severity)}
              </Badge>
              <Badge variant={alarm.acked ? "secondary" : "outline"}>
                {alarm.acked ? "Acked" : "Unacked"}
              </Badge>
              <Badge variant={alarm.cleared ? "secondary" : "outline"}>
                {alarm.cleared ? "Cleared" : "Active"}
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AlarmDetailField
                label="Alarm Name"
                value={alarm.alarmName}
                className="sm:col-span-2"
              />
              <AlarmDetailField label="CSN" value={alarm.csn} />
              <AlarmDetailField label="Alarm ID" value={alarm.alarmId} />
              <AlarmDetailField
                label="Resource / meName"
                value={displayValue(alarm.meName)}
              />
              <AlarmDetailField
                label="Resource Category / meCategory"
                value={displayValue(alarm.meCategory)}
              />
              <AlarmDetailField
                label="Resource Type / meType"
                value={displayValue(alarm.meType)}
              />
              <AlarmDetailField label="MOC" value={displayValue(alarm.moc)} />
              <AlarmDetailField
                label="Region"
                value={displayValue(alarm.logicalRegionName)}
              />
              <AlarmDetailField
                label="logicalRegionId"
                value={displayValue(alarm.logicalRegionId)}
              />
              <AlarmDetailField
                label="Company"
                value={
                  alarm.linkedCompanyName ??
                  "Platform-level / not linked to tenant"
                }
              />
              <AlarmDetailField
                label="Address / IP"
                value={displayValue(alarm.address)}
              />
              <AlarmDetailField
                label="vdcId"
                value={displayValue(alarm.vdcId)}
              />
              <AlarmDetailField
                label="vdcName"
                value={displayValue(alarm.vdcName)}
              />
              <AlarmDetailField
                label="tenantId"
                value={displayValue(alarm.tenantId)}
              />
              <AlarmDetailField
                label="Tenant"
                value={displayValue(alarm.tenant)}
              />
              <AlarmDetailField
                label="Occurred"
                value={formatDateTime(alarm.occurUtc)}
              />
              <AlarmDetailField
                label="Arrived"
                value={formatDateTime(alarm.arriveUtc)}
              />
              <AlarmDetailField
                label="Latest Occurred"
                value={formatDateTime(alarm.latestOccurUtc)}
              />
              <AlarmDetailField
                label="Category"
                value={categoryLabel(alarm.category)}
              />
              <AlarmDetailField
                label="Ack Status"
                value={alarm.acked ? "Acked" : "Unacked"}
              />
              <AlarmDetailField
                label="Cleared Status"
                value={alarm.cleared ? "Cleared" : "Active / not cleared"}
              />
            </div>

            <div className="space-y-4">
              <AlarmDetailField
                label="Probable Cause"
                value={
                  <span className="whitespace-pre-wrap">
                    {displayValue(alarm.probableCause)}
                  </span>
                }
              />
              <AlarmDetailField
                label="Additional Information"
                value={
                  <span className="whitespace-pre-wrap">
                    {displayValue(alarm.additionalInformation)}
                  </span>
                }
              />
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">Engineering next steps</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>

            <details className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Raw ManageOne payload
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-4 text-xs">
                {JSON.stringify(alarm.rawPayload, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function RepeatedAlarmPatternSheet({
  pattern,
  open,
  onOpenChange,
}: {
  pattern: RepeatedAlarmPattern | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const latestAlarm = pattern?.latestAlarm;
  const nextSteps = latestAlarm ? getEngineeringNextSteps(latestAlarm) : [];
  const severityBreakdown = pattern
    ? Object.entries(pattern.severityCounts)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(
          ([severity, count]) => `${severityLabel(Number(severity))}: ${count}`,
        )
        .join(" · ")
    : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl">
        <SheetHeader className="border-b pr-10">
          <SheetTitle>
            {pattern?.alarmName ?? "Repeated alarm pattern"}
          </SheetTitle>
          <SheetDescription>
            Grouped repeat pattern based on alarm, resource, region, and
            customer context.
          </SheetDescription>
        </SheetHeader>
        {pattern && latestAlarm ? (
          <div className="space-y-6 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityBadgeVariant(pattern.worstSeverity)}>
                Worst: {severityLabel(pattern.worstSeverity)}
              </Badge>
              <Badge variant="secondary">{pattern.count} repeats</Badge>
              <Badge
                variant={
                  pattern.ackedCount === pattern.count ? "secondary" : "outline"
                }
              >
                {pattern.ackedCount}/{pattern.count} acked
              </Badge>
              <Badge
                variant={
                  pattern.clearedCount === pattern.count
                    ? "secondary"
                    : "outline"
                }
              >
                {pattern.clearedCount}/{pattern.count} cleared
              </Badge>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AlarmDetailField
                label="Alarm Name"
                value={pattern.alarmName}
                className="sm:col-span-2"
              />
              <AlarmDetailField label="Alarm ID" value={pattern.alarmId} />
              <AlarmDetailField label="Repeat Count" value={pattern.count} />
              <AlarmDetailField
                label="Resource"
                value={displayValue(pattern.resource)}
              />
              <AlarmDetailField
                label="Region"
                value={displayValue(pattern.region)}
              />
              <AlarmDetailField
                label="Company / Tenant"
                value={displayValue(pattern.company)}
              />
              <AlarmDetailField
                label="First Seen"
                value={formatDateTime(pattern.firstSeen)}
              />
              <AlarmDetailField
                label="Latest Seen"
                value={formatDateTime(pattern.latestSeen)}
              />
              <AlarmDetailField
                label="Severity Breakdown"
                value={severityBreakdown}
                className="sm:col-span-2"
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Member alarms</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">CSN</th>
                      <th className="px-3 py-2 font-medium">Occurred</th>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Ack</th>
                      <th className="px-3 py-2 font-medium">Cleared</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pattern.alarms.map((alarm) => (
                      <tr key={alarm._id} className="border-t">
                        <td className="px-3 py-2 font-medium">{alarm.csn}</td>
                        <td className="px-3 py-2">
                          {formatDateTime(getAlarmTimestamp(alarm))}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={severityBadgeVariant(alarm.severity)}>
                            {severityLabel(alarm.severity)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {alarm.acked ? "Acked" : "Unacked"}
                        </td>
                        <td className="px-3 py-2">
                          {alarm.cleared ? "Cleared" : "Active"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">Engineering next steps</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                {nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold">
                Latest ManageOne context
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <AlarmDetailField label="CSN" value={latestAlarm.csn} />
                <AlarmDetailField
                  label="Resource Category / meCategory"
                  value={displayValue(latestAlarm.meCategory)}
                />
                <AlarmDetailField
                  label="Resource Type / meType"
                  value={displayValue(latestAlarm.meType)}
                />
                <AlarmDetailField
                  label="MOC"
                  value={displayValue(latestAlarm.moc)}
                />
                <AlarmDetailField
                  label="logicalRegionId"
                  value={displayValue(latestAlarm.logicalRegionId)}
                />
                <AlarmDetailField
                  label="Address / IP"
                  value={displayValue(latestAlarm.address)}
                />
                <AlarmDetailField
                  label="Probable Cause"
                  value={
                    <span className="whitespace-pre-wrap">
                      {displayValue(latestAlarm.probableCause)}
                    </span>
                  }
                  className="sm:col-span-2"
                />
                <AlarmDetailField
                  label="Additional Information"
                  value={
                    <span className="whitespace-pre-wrap">
                      {displayValue(latestAlarm.additionalInformation)}
                    </span>
                  }
                  className="sm:col-span-2"
                />
              </div>
            </div>

            <details className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Latest raw ManageOne payload
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-4 text-xs">
                {JSON.stringify(latestAlarm.rawPayload, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HostGroupDetailSheet({
  hostGroup,
  open,
  onOpenChange,
}: {
  hostGroup: CloudHostGroup | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl">
        <SheetHeader className="border-b pr-10">
          <SheetTitle>{hostGroup?.hostGroupName ?? "Host group"}</SheetTitle>
          <SheetDescription>
            ManageOne host group utilization and per-host hot spots.
          </SheetDescription>
        </SheetHeader>
        {hostGroup ? (
          <div className="space-y-6 px-4 pb-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Risk Level
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge variant={hostGroupRiskBadgeVariant(hostGroup.riskLevel)}>
                    {hostGroupRiskLabel(hostGroup.riskLevel)}
                  </Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Region
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-medium">{hostGroup.regionName}</div>
                  <div className="text-xs text-muted-foreground">
                    {hostGroup.regionId}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    AZ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-medium">{hostGroup.azName}</div>
                  <div className="text-xs text-muted-foreground">
                    {hostGroup.azId}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Resource Pool
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="font-medium">
                    {hostGroup.resourcePoolName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {hostGroup.resourcePoolId}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Host Count
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {hostGroup.hostCount}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {hostGroup.hypervisorType}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    CPU Avg / Max
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {formatNumber(hostGroup.cpuAvgPercent, "%")}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Max {formatNumber(hostGroup.cpuMaxPercent, "%")}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Memory Avg / Max
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {formatNumber(hostGroup.memoryAvgPercent, "%")}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Max {formatNumber(hostGroup.memoryMaxPercent, "%")}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <AlarmDetailField
                label="Host Group ID"
                value={hostGroup.hostGroupId}
              />
              <AlarmDetailField
                label="Last Synced"
                value={formatDateTime(hostGroup.lastSyncedAt)}
              />
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">Risk reasons</h3>
              {hostGroup.riskReasons.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No risk reasons reported.
                </p>
              ) : (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  {hostGroup.riskReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Worst CPU Host</CardTitle>
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
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Worst Memory Host</CardTitle>
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
                        {formatNumber(
                          hostGroup.worstMemoryHost.memoryPercent,
                          "%",
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted-foreground">Not reported</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Hosts</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Host</th>
                      <th className="px-3 py-2 font-medium">Manage IP</th>
                      <th className="px-3 py-2 text-right font-medium">CPU</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Memory
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {hostGroup.hosts
                      .slice()
                      .sort(
                        (a, b) =>
                          b.memoryPercent - a.memoryPercent ||
                          b.cpuPercent - a.cpuPercent,
                      )
                      .map((host) => {
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
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {host.hostName}
                                </span>
                                <Badge
                                  variant={hostGroupRiskBadgeVariant(status)}
                                >
                                  {hostGroupRiskLabel(status)}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {host.hostId}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {host.manageIp ?? "-"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatNumber(host.cpuPercent, "%")}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatNumber(host.memoryPercent, "%")}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            <details className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Raw cluster payload
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-4 text-xs">
                {JSON.stringify(hostGroup.rawCluster, null, 2)}
              </pre>
            </details>

            <details className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Raw host sample
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-4 text-xs">
                {JSON.stringify(hostGroup.rawHostSample, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
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
  const hostGroups = useQuery(
    api.cloudHostGroups.listActive,
    canView ? {} : "skip",
  );
  const hostGroupsSummary = useQuery(
    api.cloudHostGroups.summary,
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
  const [alarmTimeRange, setAlarmTimeRange] = useState<AlarmTimeRange>("all");
  const [alarmCustomStartDate, setAlarmCustomStartDate] = useState("");
  const [alarmCustomEndDate, setAlarmCustomEndDate] = useState("");
  const [alarmSearch, setAlarmSearch] = useState("");
  const [alarmShortcut, setAlarmShortcut] = useState<AlarmShortcut>("all");
  const [alarmView, setAlarmView] = useState<AlarmView>("all");
  const [minimumRepeats, setMinimumRepeats] = useState("2");
  const [selectedAlarmCsn, setSelectedAlarmCsn] = useState<number | null>(null);
  const [selectedRepeatedPatternKey, setSelectedRepeatedPatternKey] = useState<
    string | null
  >(null);
  const [hostGroupRegionFilter, setHostGroupRegionFilter] = useState("all");
  const [hostGroupRiskFilter, setHostGroupRiskFilter] = useState("all");
  const [hostGroupSearch, setHostGroupSearch] = useState("");
  const [selectedHostGroup, setSelectedHostGroup] =
    useState<CloudHostGroup | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [alarmPage, setAlarmPage] = useState(1);
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
  const allActiveAlarms = useQuery(
    api.cloudAlarms.listActive,
    canView ? {} : "skip",
  );
  const alarmTimeRangeBounds = useMemo(
    () =>
      getAlarmTimeRangeBounds(
        alarmTimeRange,
        alarmCustomStartDate,
        alarmCustomEndDate,
      ),
    [alarmCustomEndDate, alarmCustomStartDate, alarmTimeRange],
  );
  const activeAlarms = useMemo(() => {
    const normalizedSearch = alarmSearch.trim().toLowerCase();

    return (allActiveAlarms ?? []).filter((alarm) => {
      if (
        alarmSeverityFilter !== "all" &&
        alarm.severity !== Number(alarmSeverityFilter)
      ) {
        return false;
      }

      if (
        alarmRegionFilter !== "all" &&
        alarm.logicalRegionId !== alarmRegionFilter
      ) {
        return false;
      }

      if (
        alarmCategoryFilter !== "all" &&
        alarm.category !== Number(alarmCategoryFilter)
      ) {
        return false;
      }

      if (alarmShortcut === "linked" && !alarm.linkedCompanyId) {
        return false;
      }

      if (alarmTimeRangeBounds) {
        const timestamp = getAlarmTimestamp(alarm);
        if (
          timestamp == null ||
          timestamp < alarmTimeRangeBounds.from ||
          timestamp > alarmTimeRangeBounds.to
        ) {
          return false;
        }
      }

      if (
        normalizedSearch &&
        !getAlarmSearchText(alarm).includes(normalizedSearch)
      ) {
        return false;
      }

      return true;
    });
  }, [
    alarmCategoryFilter,
    alarmRegionFilter,
    alarmSearch,
    alarmSeverityFilter,
    alarmShortcut,
    alarmTimeRangeBounds,
    allActiveAlarms,
  ]);
  const selectedAlarm = useMemo(
    () =>
      (allActiveAlarms ?? []).find((alarm) => alarm.csn === selectedAlarmCsn),
    [allActiveAlarms, selectedAlarmCsn],
  );
  const repeatedPatterns = useMemo(
    () => buildRepeatedAlarmPatterns(activeAlarms, Number(minimumRepeats)),
    [activeAlarms, minimumRepeats],
  );
  const allRepeatedPatterns = useMemo(
    () => buildRepeatedAlarmPatterns(allActiveAlarms ?? [], 2),
    [allActiveAlarms],
  );
  const topRepeatedPatterns = useMemo(
    () => allRepeatedPatterns.slice(0, 5),
    [allRepeatedPatterns],
  );
  const selectedRepeatedPattern = useMemo(
    () =>
      [...repeatedPatterns, ...allRepeatedPatterns].find(
        (pattern) => pattern.key === selectedRepeatedPatternKey,
      ),
    [allRepeatedPatterns, repeatedPatterns, selectedRepeatedPatternKey],
  );
  const topActiveAlarms = useMemo(() => {
    return [...(allActiveAlarms ?? [])]
      .sort(
        (a, b) =>
          a.severity - b.severity || b.latestOccurUtc - a.latestOccurUtc,
      )
      .slice(0, 10);
  }, [allActiveAlarms]);
  const visibleAlarmRowCount =
    alarmView === "repeated" ? repeatedPatterns.length : activeAlarms.length;
  const alarmPageCount = Math.max(
    1,
    Math.ceil(visibleAlarmRowCount / ALARM_PAGE_SIZE),
  );
  const pagedActiveAlarms = useMemo(() => {
    const start = (alarmPage - 1) * ALARM_PAGE_SIZE;
    return activeAlarms.slice(start, start + ALARM_PAGE_SIZE);
  }, [activeAlarms, alarmPage]);
  const pagedRepeatedPatterns = useMemo(() => {
    const start = (alarmPage - 1) * ALARM_PAGE_SIZE;
    return repeatedPatterns.slice(start, start + ALARM_PAGE_SIZE);
  }, [alarmPage, repeatedPatterns]);
  const alarmShowingStart =
    visibleAlarmRowCount === 0 ? 0 : (alarmPage - 1) * ALARM_PAGE_SIZE + 1;
  const alarmShowingEnd = Math.min(
    visibleAlarmRowCount,
    alarmPage * ALARM_PAGE_SIZE,
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
  const networkSummary = useMemo(() => {
    const rows = statuses ?? [];
    return {
      total: rows.length,
      up: rows.filter((status) => status.latest?.success).length,
      down: rows.filter((status) => status.latest && !status.latest.success)
        .length,
      paused: rows.filter((status) => !status.target.active).length,
    };
  }, [statuses]);
  const capacitySummary = useMemo(() => {
    const rows = capacity ?? [];
    const regionCount = rows.length;
    const warningRegions = rows.filter(
      (region) =>
        region.cpuUsedPercent >= 70 ||
        region.memoryUsedPercent >= 70 ||
        region.storageUsedPercent >= 70,
    ).length;
    const criticalRegions = rows.filter(
      (region) =>
        region.cpuUsedPercent >= 90 ||
        region.memoryUsedPercent >= 90 ||
        region.storageUsedPercent >= 90,
    ).length;

    return { regionCount, warningRegions, criticalRegions };
  }, [capacity]);
  const hostGroupRegions = useMemo(() => {
    const regions = new Map<string, string>();
    for (const hostGroup of hostGroups ?? []) {
      regions.set(hostGroup.regionId, hostGroup.regionName);
    }
    return [...regions.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [hostGroups]);
  const filteredHostGroups = useMemo(() => {
    const normalizedSearch = hostGroupSearch.trim().toLowerCase();

    return (hostGroups ?? [])
      .filter((hostGroup) =>
        hostGroupRegionFilter === "all"
          ? true
          : hostGroup.regionId === hostGroupRegionFilter,
      )
      .filter((hostGroup) =>
        hostGroupRiskFilter === "all"
          ? true
          : hostGroup.riskLevel === hostGroupRiskFilter,
      )
      .filter((hostGroup) =>
        normalizedSearch
          ? getHostGroupSearchText(hostGroup).includes(normalizedSearch)
          : true,
      )
      .sort(
        (a, b) =>
          hostGroupRiskSortValue(a.riskLevel) -
            hostGroupRiskSortValue(b.riskLevel) ||
          Math.max(b.cpuMaxPercent, b.memoryMaxPercent) -
            Math.max(a.cpuMaxPercent, a.memoryMaxPercent),
      );
  }, [hostGroupRegionFilter, hostGroupRiskFilter, hostGroupSearch, hostGroups]);
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
    for (const alarm of allActiveAlarms ?? []) {
      if (alarm.logicalRegionId) {
        regions.set(
          alarm.logicalRegionId,
          alarm.logicalRegionName ?? alarm.logicalRegionId,
        );
      }
    }
    return [...regions.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allActiveAlarms]);
  const alarmCategories = useMemo(() => {
    return [
      ...new Set((allActiveAlarms ?? []).map((alarm) => alarm.category)),
    ].sort((a, b) => a - b);
  }, [allActiveAlarms]);

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

  useEffect(() => {
    setAlarmPage(1);
  }, [
    alarmCategoryFilter,
    alarmCustomEndDate,
    alarmCustomStartDate,
    alarmRegionFilter,
    alarmSearch,
    alarmSeverityFilter,
    alarmShortcut,
    alarmTimeRange,
    alarmView,
    minimumRepeats,
  ]);

  const applyAlarmShortcut = (shortcut: AlarmShortcut) => {
    setActiveTab("alarms");
    setAlarmShortcut(shortcut);

    if (shortcut === "critical") {
      setAlarmSeverityFilter("1");
      setAlarmRegionFilter("all");
      setAlarmCategoryFilter("all");
      return;
    }

    if (shortcut === "major") {
      setAlarmSeverityFilter("2");
      setAlarmRegionFilter("all");
      setAlarmCategoryFilter("all");
      return;
    }

    setAlarmSeverityFilter("all");
    setAlarmRegionFilter("all");
    setAlarmCategoryFilter("all");

    if (shortcut === "regions") {
      window.setTimeout(() => {
        document
          .getElementById("cloud-health-alarms-table")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  };

  const updateAlarmSeverityFilter = (value: string) => {
    setAlarmSeverityFilter(value);
    setAlarmShortcut(
      inferAlarmShortcutFromFilters(
        value,
        alarmRegionFilter,
        alarmCategoryFilter,
      ),
    );
  };

  const updateAlarmRegionFilter = (value: string) => {
    setAlarmRegionFilter(value);
    setAlarmShortcut(
      inferAlarmShortcutFromFilters(
        alarmSeverityFilter,
        value,
        alarmCategoryFilter,
      ),
    );
  };

  const updateAlarmCategoryFilter = (value: string) => {
    setAlarmCategoryFilter(value);
    setAlarmShortcut(
      inferAlarmShortcutFromFilters(
        alarmSeverityFilter,
        alarmRegionFilter,
        value,
      ),
    );
  };

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
    !allActiveAlarms ||
    !hostGroups ||
    !hostGroupsSummary ||
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

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <div
          role="tablist"
          aria-label="Cloud Health sections"
          className="grid w-full max-w-[620px] grid-cols-2 rounded-lg border bg-muted/40 p-1 sm:grid-cols-5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-transparent px-3 text-sm text-muted-foreground ${
              activeTab === "overview"
                ? "bg-primary/10 font-medium text-primary"
                : ""
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5 opacity-80" />
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "alarms"}
            onClick={() => setActiveTab("alarms")}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-transparent px-3 text-sm text-muted-foreground ${
              activeTab === "alarms"
                ? "bg-primary/10 font-medium text-primary"
                : ""
            }`}
          >
            <BellRing className="h-3.5 w-3.5 opacity-80" />
            Alarms
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "capacity"}
            onClick={() => setActiveTab("capacity")}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-transparent px-3 text-sm text-muted-foreground ${
              activeTab === "capacity"
                ? "bg-primary/10 font-medium text-primary"
                : ""
            }`}
          >
            <Activity className="h-3.5 w-3.5 opacity-80" />
            Capacity
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "network"}
            onClick={() => setActiveTab("network")}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-transparent px-3 text-sm text-muted-foreground ${
              activeTab === "network"
                ? "bg-primary/10 font-medium text-primary"
                : ""
            }`}
          >
            <Wifi className="h-3.5 w-3.5 opacity-80" />
            Network
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "host-groups"}
            onClick={() => setActiveTab("host-groups")}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-transparent px-3 text-sm text-muted-foreground ${
              activeTab === "host-groups"
                ? "bg-primary/10 font-medium text-primary"
                : ""
            }`}
          >
            <Server className="h-3.5 w-3.5 opacity-80" />
            Host Groups
          </button>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Active Alarms</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <AlarmShortcutCard
                title="Active"
                value={alarmsSummary.active}
                detail={`Synced ${formatDateTime(alarmsSummary.lastSyncedAt)}`}
                active={alarmShortcut === "all"}
                onClick={() => applyAlarmShortcut("all")}
              />
              <AlarmShortcutCard
                title="Critical"
                value={alarmsSummary.critical}
                active={alarmShortcut === "critical"}
                onClick={() => applyAlarmShortcut("critical")}
                valueClassName="text-destructive"
              />
              <AlarmShortcutCard
                title="Major"
                value={alarmsSummary.major}
                active={alarmShortcut === "major"}
                onClick={() => applyAlarmShortcut("major")}
              />
              <AlarmShortcutCard
                title="Linked Tenants"
                value={alarmsSummary.tenantLinked}
                detail={`${alarmsSummary.platform} platform-level`}
                active={alarmShortcut === "linked"}
                onClick={() => applyAlarmShortcut("linked")}
              />
              <AlarmShortcutCard
                title="Regions"
                value={alarmsSummary.regions}
                active={alarmShortcut === "regions"}
                onClick={() => applyAlarmShortcut("regions")}
              />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Active Alarms</CardTitle>
                </CardHeader>
                <CardContent>
                  {topActiveAlarms.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No active alarms.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Severity</th>
                            <th className="px-3 py-2 font-medium">Alarm</th>
                            <th className="px-3 py-2 font-medium">Region</th>
                            <th className="px-3 py-2 font-medium">Company</th>
                            <th className="px-3 py-2 font-medium">Latest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topActiveAlarms.map((alarm) => (
                            <tr
                              key={alarm._id}
                              tabIndex={0}
                              role="button"
                              aria-label={`View details for ${alarm.alarmName}`}
                              className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              onClick={() => setSelectedAlarmCsn(alarm.csn)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  setSelectedAlarmCsn(alarm.csn);
                                }
                              }}
                            >
                              <td className="px-3 py-2">
                                <Badge
                                  variant={severityBadgeVariant(alarm.severity)}
                                >
                                  {severityLabel(alarm.severity)}
                                </Badge>
                              </td>
                              <td className="max-w-[320px] px-3 py-2">
                                <div className="font-medium">
                                  {alarm.alarmName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  CSN {alarm.csn}
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
                  <CardTitle className="text-base">
                    Top Repeated Patterns
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {topRepeatedPatterns.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No repeated alarm patterns found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Severity</th>
                            <th className="px-3 py-2 font-medium">Pattern</th>
                            <th className="px-3 py-2 font-medium">Region</th>
                            <th className="px-3 py-2 font-medium">Company</th>
                            <th className="px-3 py-2 font-medium">Count</th>
                            <th className="px-3 py-2 font-medium">Latest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topRepeatedPatterns.map((pattern) => (
                            <tr
                              key={pattern.key}
                              tabIndex={0}
                              role="button"
                              aria-label={`View repeated pattern for ${pattern.alarmName}`}
                              className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              onClick={() =>
                                setSelectedRepeatedPatternKey(pattern.key)
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  setSelectedRepeatedPatternKey(pattern.key);
                                }
                              }}
                            >
                              <td className="px-3 py-2">
                                <Badge
                                  variant={severityBadgeVariant(
                                    pattern.worstSeverity,
                                  )}
                                >
                                  {severityLabel(pattern.worstSeverity)}
                                </Badge>
                              </td>
                              <td className="max-w-[320px] px-3 py-2">
                                <div className="font-medium">
                                  {pattern.alarmName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  ID {pattern.alarmId}
                                </div>
                              </td>
                              <td className="px-3 py-2">{pattern.region}</td>
                              <td className="px-3 py-2">{pattern.company}</td>
                              <td className="px-3 py-2 font-medium">
                                {pattern.count}
                              </td>
                              <td className="px-3 py-2">
                                {formatDateTime(pattern.latestSeen)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Infrastructure Capacity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-semibold">
                    {capacitySummary.regionCount}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Regions monitored
                  </p>
                  <div className="flex gap-2 text-xs">
                    <Badge variant="secondary">
                      {capacitySummary.warningRegions} warning
                    </Badge>
                    <Badge
                      variant={
                        capacitySummary.criticalRegions > 0
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {capacitySummary.criticalRegions} critical
                    </Badge>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Network Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-2xl font-semibold">
                    {networkSummary.up}/{networkSummary.total}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Targets up right now
                  </p>
                  <div className="flex gap-2 text-xs">
                    <Badge
                      variant={
                        networkSummary.down > 0 ? "destructive" : "outline"
                      }
                    >
                      {networkSummary.down} down
                    </Badge>
                    <Badge variant="secondary">
                      {networkSummary.paused} paused
                    </Badge>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Host Group Risk
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-2xl font-semibold">
                    {hostGroupsSummary.critical}/{hostGroupsSummary.watch}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Critical / watch host groups
                  </p>
                  {hostGroupsSummary.topRisk.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No host group data synced yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {hostGroupsSummary.topRisk.map((hostGroup) => (
                        <button
                          key={hostGroup._id}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:border-primary/60 hover:bg-muted/30"
                          onClick={() => {
                            setActiveTab("host-groups");
                            setSelectedHostGroup(hostGroup);
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {hostGroup.hostGroupName}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {hostGroup.regionName}
                            </span>
                          </span>
                          <Badge
                            variant={hostGroupRiskBadgeVariant(
                              hostGroup.riskLevel,
                            )}
                          >
                            {hostGroupRiskLabel(hostGroup.riskLevel)}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="alarms" className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Active Alarms</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <AlarmShortcutCard
                title="Active"
                value={alarmsSummary.active}
                detail={`Synced ${formatDateTime(alarmsSummary.lastSyncedAt)}`}
                active={alarmShortcut === "all"}
                onClick={() => applyAlarmShortcut("all")}
              />
              <AlarmShortcutCard
                title="Critical"
                value={alarmsSummary.critical}
                active={alarmShortcut === "critical"}
                onClick={() => applyAlarmShortcut("critical")}
                valueClassName="text-destructive"
              />
              <AlarmShortcutCard
                title="Major"
                value={alarmsSummary.major}
                active={alarmShortcut === "major"}
                onClick={() => applyAlarmShortcut("major")}
              />
              <AlarmShortcutCard
                title="Linked Tenants"
                value={alarmsSummary.tenantLinked}
                detail={`${alarmsSummary.platform} platform-level`}
                active={alarmShortcut === "linked"}
                onClick={() => applyAlarmShortcut("linked")}
              />
              <AlarmShortcutCard
                title="Regions"
                value={alarmsSummary.regions}
                active={alarmShortcut === "regions"}
                onClick={() => applyAlarmShortcut("regions")}
              />
            </div>

            <Card id="cloud-health-alarms-table">
              <CardHeader>
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle className="text-base">
                        Current ManageOne Alarms
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {alarmView === "all"
                          ? "All individual alarm rows matching the current filters."
                          : "Grouped repeat patterns after applying the current filters."}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="grid grid-cols-2 rounded-lg border bg-muted/40 p-1">
                        <button
                          type="button"
                          className={`h-9 rounded-md px-3 text-sm transition-colors ${
                            alarmView === "all"
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() => setAlarmView("all")}
                        >
                          All Alarms
                        </button>
                        <button
                          type="button"
                          className={`h-9 rounded-md px-3 text-sm transition-colors ${
                            alarmView === "repeated"
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() => setAlarmView("repeated")}
                        >
                          Repeated Patterns
                        </button>
                      </div>
                      {alarmView === "repeated" ? (
                        <Select
                          value={minimumRepeats}
                          onValueChange={setMinimumRepeats}
                        >
                          <SelectTrigger className="w-full sm:w-36">
                            <SelectValue placeholder="Minimum repeats" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2+ repeats</SelectItem>
                            <SelectItem value="3">3+ repeats</SelectItem>
                            <SelectItem value="5">5+ repeats</SelectItem>
                            <SelectItem value="10">10+ repeats</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="cloud-health-alarm-search" className="sr-only">
                      Search alarms
                    </Label>
                    <Input
                      id="cloud-health-alarm-search"
                      type="search"
                      placeholder="Search alarms..."
                      value={alarmSearch}
                      onChange={(event) => setAlarmSearch(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                    <Select
                      value={alarmSeverityFilter}
                      onValueChange={updateAlarmSeverityFilter}
                    >
                      <SelectTrigger className="w-full">
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
                      onValueChange={updateAlarmRegionFilter}
                    >
                      <SelectTrigger className="w-full">
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
                      onValueChange={updateAlarmCategoryFilter}
                    >
                      <SelectTrigger className="w-full">
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
                    <Select
                      value={alarmTimeRange}
                      onValueChange={(value) =>
                        setAlarmTimeRange(value as AlarmTimeRange)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="All Time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="yesterday">Yesterday</SelectItem>
                        <SelectItem value="last_7_days">
                          Last 7 Days
                        </SelectItem>
                        <SelectItem value="this_month">This Month</SelectItem>
                        <SelectItem value="last_month">Last Month</SelectItem>
                        <SelectItem value="custom">Custom Range</SelectItem>
                      </SelectContent>
                    </Select>
                    {alarmTimeRange === "custom" ? (
                      <>
                        <div className="space-y-1">
                          <Label
                            htmlFor="alarm-custom-start-date"
                            className="sr-only"
                          >
                            Start Date
                          </Label>
                          <Input
                            id="alarm-custom-start-date"
                            type="date"
                            aria-label="Start Date"
                            value={alarmCustomStartDate}
                            onChange={(event) =>
                              setAlarmCustomStartDate(event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor="alarm-custom-end-date"
                            className="sr-only"
                          >
                            End Date
                          </Label>
                          <Input
                            id="alarm-custom-end-date"
                            type="date"
                            aria-label="End Date"
                            value={alarmCustomEndDate}
                            onChange={(event) =>
                              setAlarmCustomEndDate(event.target.value)
                            }
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {visibleAlarmRowCount === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {alarmView === "all"
                      ? "No active alarms match the selected filters."
                      : "No repeated alarm patterns match the selected filters."}
                  </div>
                ) : alarmView === "all" ? (
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
                        {pagedActiveAlarms.map((alarm) => (
                          <tr
                            key={alarm._id}
                            tabIndex={0}
                            role="button"
                            aria-label={`View details for ${alarm.alarmName}`}
                            className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() => setSelectedAlarmCsn(alarm.csn)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedAlarmCsn(alarm.csn);
                              }
                            }}
                          >
                            <td className="px-3 py-2">
                              <Badge
                                variant={severityBadgeVariant(alarm.severity)}
                              >
                                {severityLabel(alarm.severity)}
                              </Badge>
                            </td>
                            <td className="max-w-[320px] px-3 py-2">
                              <div className="font-medium">
                                {alarm.alarmName}
                              </div>
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
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[1120px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            Worst Severity
                          </th>
                          <th className="px-3 py-2 font-medium">
                            Alarm Pattern
                          </th>
                          <th className="px-3 py-2 font-medium">Resource</th>
                          <th className="px-3 py-2 font-medium">Region</th>
                          <th className="px-3 py-2 font-medium">Company</th>
                          <th className="px-3 py-2 font-medium">Count</th>
                          <th className="px-3 py-2 font-medium">
                            First Seen
                          </th>
                          <th className="px-3 py-2 font-medium">
                            Latest Seen
                          </th>
                          <th className="px-3 py-2 font-medium">Ack</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRepeatedPatterns.map((pattern) => (
                          <tr
                            key={pattern.key}
                            tabIndex={0}
                            role="button"
                            aria-label={`View repeated pattern for ${pattern.alarmName}`}
                            className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            onClick={() =>
                              setSelectedRepeatedPatternKey(pattern.key)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedRepeatedPatternKey(pattern.key);
                              }
                            }}
                          >
                            <td className="px-3 py-2">
                              <Badge
                                variant={severityBadgeVariant(
                                  pattern.worstSeverity,
                                )}
                              >
                                {severityLabel(pattern.worstSeverity)}
                              </Badge>
                            </td>
                            <td className="max-w-[320px] px-3 py-2">
                              <div className="font-medium">
                                {pattern.alarmName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                ID {pattern.alarmId}
                              </div>
                            </td>
                            <td className="px-3 py-2">{pattern.resource}</td>
                            <td className="px-3 py-2">{pattern.region}</td>
                            <td className="px-3 py-2">{pattern.company}</td>
                            <td className="px-3 py-2 font-medium">
                              {pattern.count}
                            </td>
                            <td className="px-3 py-2">
                              {formatDateTime(pattern.firstSeen)}
                            </td>
                            <td className="px-3 py-2">
                              {formatDateTime(pattern.latestSeen)}
                            </td>
                            <td className="px-3 py-2">
                              {pattern.ackedCount}/{pattern.count} acked
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {visibleAlarmRowCount > 0 ? (
                  <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      Showing {alarmShowingStart}-{alarmShowingEnd} of{" "}
                      {visibleAlarmRowCount}{" "}
                      {alarmView === "all" ? "alarms" : "patterns"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAlarmPage((page) => Math.max(1, page - 1))
                        }
                        disabled={alarmPage <= 1}
                      >
                        Previous
                      </Button>
                      <span>
                        Page {alarmPage} of {alarmPageCount}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAlarmPage((page) =>
                            Math.min(alarmPageCount, page + 1),
                          )
                        }
                        disabled={alarmPage >= alarmPageCount}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        <TabsContent value="capacity" className="space-y-6">
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
                        oversubscriptionRatio={
                          region.memoryOversubscriptionRatio
                        }
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
                        oversubscriptionRatio={
                          region.storageOversubscriptionRatio
                        }
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
        </TabsContent>

        <TabsContent value="host-groups" className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Host Groups</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Total Host Groups
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {hostGroupsSummary.totalHostGroups}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Synced {formatDateTime(hostGroupsSummary.lastSyncedAt)}
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
                    {hostGroupsSummary.critical}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Watch
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {hostGroupsSummary.watch}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Healthy
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {hostGroupsSummary.healthy}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Total Hosts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold">
                    {hostGroupsSummary.totalHosts}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="text-base">
                    ManageOne Host Group Utilization
                  </CardTitle>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Select
                      value={hostGroupRegionFilter}
                      onValueChange={setHostGroupRegionFilter}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Region" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Regions</SelectItem>
                        {hostGroupRegions.map(([regionId, regionName]) => (
                          <SelectItem key={regionId} value={regionId}>
                            {regionName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={hostGroupRiskFilter}
                      onValueChange={setHostGroupRiskFilter}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Risk Level" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Risk Levels</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="watch">Watch</SelectItem>
                        <SelectItem value="healthy">Healthy</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="search"
                      placeholder="Search host groups or hosts..."
                      value={hostGroupSearch}
                      onChange={(event) =>
                        setHostGroupSearch(event.target.value)
                      }
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {filteredHostGroups.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    No host groups match the selected filters.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[1120px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Risk</th>
                          <th className="px-3 py-2 font-medium">
                            Host Group
                          </th>
                          <th className="px-3 py-2 font-medium">Region</th>
                          <th className="px-3 py-2 font-medium">AZ</th>
                          <th className="px-3 py-2 text-right font-medium">
                            Host Count
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            CPU Avg / Max
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Memory Avg / Max
                          </th>
                          <th className="px-3 py-2 font-medium">
                            Worst Host
                          </th>
                          <th className="px-3 py-2 font-medium">
                            Last Synced
                          </th>
                          <th className="px-3 py-2 font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHostGroups.map((hostGroup) => (
                          <tr
                            key={hostGroup._id}
                            tabIndex={0}
                            role="button"
                            aria-label={`View details for ${hostGroup.hostGroupName}`}
                            className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setSelectedHostGroup(hostGroup)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedHostGroup(hostGroup);
                              }
                            }}
                          >
                            <td className="px-3 py-2">
                              <Badge
                                variant={hostGroupRiskBadgeVariant(
                                  hostGroup.riskLevel,
                                )}
                              >
                                {hostGroupRiskLabel(hostGroup.riskLevel)}
                              </Badge>
                            </td>
                            <td className="max-w-[260px] px-3 py-2">
                              <div className="font-medium">
                                {hostGroup.hostGroupName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {hostGroup.hypervisorType} ·{" "}
                                {hostGroup.resourcePoolName}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {hostGroup.regionName}
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
                            <td className="max-w-[260px] px-3 py-2">
                              <div className="truncate">
                                {hostGroup.worstMemoryHost?.hostName ??
                                  hostGroup.worstCpuHost?.hostName ??
                                  "-"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                CPU {formatNumber(hostGroup.cpuMaxPercent, "%")}{" "}
                                · Mem{" "}
                                {formatNumber(
                                  hostGroup.memoryMaxPercent,
                                  "%",
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              {formatDateTime(hostGroup.lastSyncedAt)}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-sm font-medium text-primary hover:underline"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedHostGroup(hostGroup);
                                }}
                              >
                                View details
                              </button>
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
        </TabsContent>

        <TabsContent value="network" className="space-y-6">
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
                              onClick={() =>
                                handleDeleteTarget(status.target._id)
                              }
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
                          onChange={(event) =>
                            setServiceName(event.target.value)
                          }
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
                            onChange={(event) =>
                              setExpectedIp(event.target.value)
                            }
                            placeholder="Optional"
                          />
                        </div>
                      ) : null}
                      <div className="space-y-1.5">
                        <Label htmlFor="service-notes">Notes</Label>
                        <Input
                          id="service-notes"
                          value={serviceNotes}
                          onChange={(event) =>
                            setServiceNotes(event.target.value)
                          }
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
                      {selectedServiceTargetId &&
                      serviceChartData.length > 0 ? (
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
                              stroke="#35C7C9"
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
        </TabsContent>
      </Tabs>
      <AlarmDetailSheet
        alarm={selectedAlarm}
        open={selectedAlarmCsn !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAlarmCsn(null);
          }
        }}
      />
      <RepeatedAlarmPatternSheet
        pattern={selectedRepeatedPattern}
        open={selectedRepeatedPatternKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRepeatedPatternKey(null);
          }
        }}
      />
      <HostGroupDetailSheet
        hostGroup={selectedHostGroup ?? undefined}
        open={selectedHostGroup !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedHostGroup(null);
          }
        }}
      />
    </div>
  );
}
