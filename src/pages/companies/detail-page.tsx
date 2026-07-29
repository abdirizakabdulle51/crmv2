import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ArrowLeft } from "lucide-react";
import { useCrm } from "@/lib/crm-context.tsx";
import { CompanyForm } from "./_components/company-dialog.tsx";

type TenantUsageHistoryRow = Doc<"tenantUsageHistory">;

const CHART_GROUPS = [
  {
    title: "Compute Counts",
    metrics: [
      { key: "ecsInstances", label: "ECS", color: "#0d9488" },
      { key: "rdsInstances", label: "RDS", color: "#2563eb" },
      { key: "cceClusters", label: "CCE", color: "#7c3aed" },
    ],
  },
  {
    title: "Compute Sizing",
    metrics: [
      { key: "ecsCores", label: "vCPU", color: "#0891b2" },
      { key: "ecsRamGb", label: "RAM GB", color: "#65a30d" },
    ],
  },
  {
    title: "Storage",
    metrics: [
      { key: "evsGb", label: "EVS GB", color: "#ea580c" },
      { key: "obsGb", label: "OBS GB", color: "#ca8a04" },
      { key: "sfsGb", label: "SFS GB", color: "#16a34a" },
    ],
  },
  {
    title: "Network & Security",
    metrics: [
      { key: "publicIps", label: "Public IPs", color: "#0284c7" },
      { key: "wafInstances", label: "WAF", color: "#dc2626" },
    ],
  },
] satisfies Array<{
  title: string;
  metrics: Array<{
    key: keyof Pick<
      TenantUsageHistoryRow,
      | "ecsInstances"
      | "ecsCores"
      | "ecsRamGb"
      | "rdsInstances"
      | "cceClusters"
      | "evsGb"
      | "obsGb"
      | "sfsGb"
      | "publicIps"
      | "wafInstances"
    >;
    label: string;
    color: string;
  }>;
}>;

function canViewUsageHistory(role: string | undefined) {
  return role === "ceo" || role === "head_of_business" || role === "country_gm";
}

function formatSyncLabel(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function UsageTrendChart({
  title,
  metrics,
  data,
}: {
  title: string;
  metrics: (typeof CHART_GROUPS)[number]["metrics"];
  data: Array<TenantUsageHistoryRow & { syncedLabel: string }>;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 text-sm font-medium">{title}</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="syncedLabel"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12 }}
              width={48}
            />
            <Tooltip
              labelClassName="text-foreground"
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            />
            {metrics.map((metric) => (
              <Line
                key={metric.key}
                type="monotone"
                dataKey={metric.key}
                name={metric.label}
                stroke={metric.color}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {metrics.map((metric) => (
          <span key={metric.key} className="inline-flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: metric.color }}
            />
            {metric.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function UsageTrendsSection({
  history,
}: {
  history: TenantUsageHistoryRow[] | undefined;
}) {
  if (!history) {
    return (
      <Card className="max-w-5xl">
        <CardHeader>
          <CardTitle>Usage Trends</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (history.length < 2) {
    return (
      <Card className="max-w-5xl">
        <CardHeader>
          <CardTitle>Usage Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Collecting tenant usage history. Trends will appear after at least
            two sync snapshots have been received for this company.
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = history.map((row) => ({
    ...row,
    syncedLabel: formatSyncLabel(row.syncedAt),
  }));

  return (
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle>Usage Trends</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        {CHART_GROUPS.map((group) => (
          <UsageTrendChart
            key={group.title}
            title={group.title}
            metrics={group.metrics}
            data={chartData}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useCrm();
  const companyId = id as Id<"companies"> | undefined;
  const canViewTrends = canViewUsageHistory(currentUser?.role);

  const company = useQuery(
    api.companies.getById,
    companyId ? { id: companyId } : "skip",
  );
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const users = useQuery(api.users.listAll, {});
  const usageHistory = useQuery(
    api.tenantUsageHistory.history,
    companyId && canViewTrends ? { companyId } : "skip",
  );

  const goBack = () => navigate("/companies");

  if (!company || !countries || !sectors || !users) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[640px] w-full max-w-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 pb-20 md:p-8 md:pb-24">
      <Button variant="ghost" className="px-0" onClick={goBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Companies
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Company</h1>
        <p className="mt-1 text-muted-foreground">{company.name}</p>
      </div>

      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <CompanyForm
            company={company}
            countries={countries}
            sectors={sectors}
            users={users}
            onFinished={goBack}
          />
        </CardContent>
      </Card>

      {canViewTrends && <UsageTrendsSection history={usageHistory} />}

      <div className="h-12" aria-hidden="true" />
    </div>
  );
}
