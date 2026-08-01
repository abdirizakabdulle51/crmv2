import { useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
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

type CloudAlarmWithCompany = Doc<"cloudAlarms"> & {
  linkedCompanyName?: string | null;
};

function canViewCloudHealth(role: string | undefined) {
  return role === "ceo" || role === "head_of_business" || role === "country_gm";
}

function displayValue(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return value;
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

function getEngineeringNextSteps(alarm: CloudAlarmWithCompany) {
  const haystack = [
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

  if (haystack.includes("eip") || haystack.includes("bandwidth")) {
    return [
      "Check the EIP bandwidth limit and whether current traffic is saturating it.",
      "Review recent traffic trends and the resource attached to this EIP.",
      "Confirm whether the customer needs a bandwidth tier change or traffic shaping.",
    ];
  }

  if (haystack.includes("kafka")) {
    return [
      "Check Kafka node, partition, and replica health.",
      "Review platform service impact and broker resource pressure.",
      "Confirm whether this is a transient threshold alarm or an active platform incident.",
    ];
  }

  if (haystack.includes("storage") || haystack.includes("capacity")) {
    return [
      "Check storage pool capacity and recent growth trend.",
      "Review affected storage backend and tenant consumption.",
      "Plan expansion or cleanup if the pool is approaching threshold.",
    ];
  }

  if (haystack.includes("vpn")) {
    return [
      "Check VPN tunnel, session, and connectivity status.",
      "Review peer reachability, tunnel errors, and recent configuration changes.",
      "Confirm whether customer traffic is impacted.",
    ];
  }

  if (haystack.includes("db") || haystack.includes("database")) {
    return [
      "Check DB service status and active failover or replication alarms.",
      "Review resource health, storage, and connection pressure.",
      "Confirm whether application-facing database service is impacted.",
    ];
  }

  return [
    "Review the affected resource, probable cause, and ManageOne recommended action.",
  ];
}

function DetailField({
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

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {children}
      </CardContent>
    </Card>
  );
}

function NotFoundState() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <Button variant="outline" onClick={() => navigate("/cloud-health")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Cloud Health
      </Button>
      <Card>
        <CardContent className="py-12 text-center">
          <h1 className="text-xl font-semibold">Alarm not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This alarm is no longer active or is not available to your role.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CloudHealthAlarmPage() {
  const { currentUser } = useCrm();
  const navigate = useNavigate();
  const params = useParams();
  const canView = canViewCloudHealth(currentUser?.role);
  const alarms = useQuery(api.cloudAlarms.listActive, canView ? {} : "skip");
  const csn = Number(params.csn);
  const alarm = useMemo(
    () => (alarms ?? []).find((item) => item.csn === csn),
    [alarms, csn],
  );

  if (!canView) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Cloud Health is available to Country GM, Head of Business, and CEO
          roles.
        </CardContent>
      </Card>
    );
  }

  if (alarms === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!alarm) {
    return <NotFoundState />;
  }

  const nextSteps = getEngineeringNextSteps(alarm);

  return (
    <div className="space-y-6">
      <Button variant="outline" onClick={() => navigate("/cloud-health")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Cloud Health
      </Button>

      <div>
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
        <h1 className="mt-3 text-2xl font-semibold">{alarm.alarmName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full ManageOne alarm context for engineering investigation.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailCard title="Alarm Identity">
          <DetailField label="CSN" value={alarm.csn} />
          <DetailField label="Alarm ID" value={alarm.alarmId} />
          <DetailField
            label="Alarm Name"
            value={alarm.alarmName}
            className="sm:col-span-2"
          />
        </DetailCard>

        <DetailCard title="Resource">
          <DetailField
            label="meName / Resource"
            value={displayValue(alarm.meName)}
          />
          <DetailField
            label="meCategory"
            value={displayValue(alarm.meCategory)}
          />
          <DetailField label="meType" value={displayValue(alarm.meType)} />
          <DetailField label="MOC" value={displayValue(alarm.moc)} />
          <DetailField
            label="Address / IP"
            value={displayValue(alarm.address)}
          />
        </DetailCard>

        <DetailCard title="Region">
          <DetailField
            label="Region"
            value={displayValue(alarm.logicalRegionName)}
          />
          <DetailField
            label="logicalRegionId"
            value={displayValue(alarm.logicalRegionId)}
          />
        </DetailCard>

        <DetailCard title="Company / Tenant Mapping">
          <DetailField
            label="Company"
            value={
              alarm.linkedCompanyName ?? "Platform-level / not linked to tenant"
            }
          />
          <DetailField label="vdcId" value={displayValue(alarm.vdcId)} />
          <DetailField label="vdcName" value={displayValue(alarm.vdcName)} />
          <DetailField label="tenantId" value={displayValue(alarm.tenantId)} />
          <DetailField label="Tenant" value={displayValue(alarm.tenant)} />
        </DetailCard>

        <DetailCard title="Timeline">
          <DetailField
            label="Occurred"
            value={formatDateTime(alarm.occurUtc)}
          />
          <DetailField
            label="Arrived"
            value={formatDateTime(alarm.arriveUtc)}
          />
          <DetailField
            label="Latest Occurred"
            value={formatDateTime(alarm.latestOccurUtc)}
          />
          <DetailField
            label="Last Synced"
            value={formatDateTime(alarm.lastSyncedAt)}
          />
        </DetailCard>

        <DetailCard title="Category / Event Type">
          <DetailField label="Category" value={categoryLabel(alarm.category)} />
          <DetailField label="Event Type" value={alarm.eventType} />
        </DetailCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Probable Cause</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
          {displayValue(alarm.probableCause)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Additional Information</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
          {displayValue(alarm.additionalInformation)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Engineering Next Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Raw ManageOne JSON payload
        </summary>
        <pre className="max-h-[520px] overflow-auto border-t bg-muted/30 p-4 text-xs">
          {JSON.stringify(alarm.rawPayload, null, 2)}
        </pre>
      </details>
    </div>
  );
}
