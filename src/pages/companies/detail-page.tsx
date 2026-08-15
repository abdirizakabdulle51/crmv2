import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { ArrowLeft } from "lucide-react";
import { useCrm } from "@/lib/crm-context.tsx";
import {
  CompanyForm,
  ManageOneUsageCard,
} from "./_components/company-dialog.tsx";
import { isDrMode } from "@/lib/dr-mode.ts";

type TenantUsageHistoryRow = Doc<"tenantUsageHistory">;
type Company = Doc<"companies">;
type Country = Doc<"countries">;
type Sector = Doc<"sectors">;
type User = Doc<"users">;
type ManageOneTenant = Doc<"manageOneTenants">;

const CHART_GROUPS = [
  {
    title: "Compute Counts",
    metrics: [
      { key: "ecsInstances", label: "ECS", color: "#35C7C9" },
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

function useDrRow<T>(path: string | null) {
  const [row, setRow] = useState<T | undefined>();

  useEffect(() => {
    if (!path) {
      return;
    }

    const controller = new AbortController();
    setRow(undefined);

    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${path} failed: ${response.status}`);
        }
        const payload = (await response.json()) as { row: T };
        return payload.row;
      })
      .then(setRow)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      });

    return () => controller.abort();
  }, [path]);

  return row;
}

function useDrRows<T>(path: string | null) {
  const [rows, setRows] = useState<T[] | undefined>();

  useEffect(() => {
    if (!path) {
      return;
    }

    const controller = new AbortController();
    setRows(undefined);

    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${path} failed: ${response.status}`);
        }
        const payload = (await response.json()) as { rows: T[] };
        return payload.rows;
      })
      .then(setRows)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setRows([]);
        }
      });

    return () => controller.abort();
  }, [path]);

  return rows;
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value || "-"}</div>
    </div>
  );
}

export default function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useCrm();
  const companyId = id as Id<"companies"> | undefined;
  const canViewTrends = canViewUsageHistory(currentUser?.role);

  const convexCompany = useQuery(
    api.companies.getById,
    companyId && !isDrMode ? { id: companyId } : "skip",
  );
  const convexCountries = useQuery(api.countries.list, isDrMode ? "skip" : {});
  const convexSectors = useQuery(api.sectors.list, isDrMode ? "skip" : {});
  const convexUsers = useQuery(api.users.listAll, isDrMode ? "skip" : {});
  const convexUsageHistory = useQuery(
    api.tenantUsageHistory.history,
    companyId && canViewTrends && !isDrMode ? { companyId } : "skip",
  );
  const convexManageOneTenants = useQuery(
    api.manageOneTenants.getByCompanyId,
    companyId && !isDrMode ? { companyId } : "skip",
  );
  const drCompany = useDrRow<Company>(
    isDrMode && companyId ? `/api/companies/${companyId}` : null,
  );
  const drCountries = useDrRows<Country>(
    isDrMode ? "/api/countries?limit=1000" : null,
  );
  const drSectors = useDrRows<Sector>(
    isDrMode ? "/api/sectors?limit=1000" : null,
  );
  const drUsers = useDrRows<User>(isDrMode ? "/api/users?limit=1000" : null);
  const drUsageHistory = useDrRows<TenantUsageHistoryRow>(
    isDrMode && companyId && canViewTrends
      ? `/api/tenant-usage-history?companyId=${companyId}&limit=2000`
      : null,
  );
  const company = isDrMode ? drCompany : convexCompany;
  const countries = isDrMode ? drCountries : convexCountries;
  const sectors = isDrMode ? drSectors : convexSectors;
  const users = isDrMode ? drUsers : convexUsers;
  const usageHistory = isDrMode ? drUsageHistory : convexUsageHistory;
  const manageOneTenants: ManageOneTenant[] | undefined = isDrMode
    ? []
    : convexManageOneTenants;

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
        <h1 className="text-2xl font-bold tracking-tight">
          {isDrMode ? "Company Details" : "Edit Company"}
        </h1>
        <p className="mt-1 text-muted-foreground">{company.name}</p>
      </div>

      <Tabs defaultValue="company-info" className="max-w-5xl">
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="company-info">Company Info</TabsTrigger>
          <TabsTrigger value="usage-trends">Usage Trends</TabsTrigger>
          <TabsTrigger value="manageone-usage">ManageOne Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="company-info" className="mt-4">
          {isDrMode ? (
            <Card>
              <CardHeader>
                <CardTitle>Company Info</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailItem label="Company" value={company.name} />
                <DetailItem
                  label="Sector"
                  value={
                    sectors.find((sector) => sector._id === company.sectorId)
                      ?.name
                  }
                />
                <DetailItem
                  label="Country"
                  value={
                    countries.find(
                      (country) => country._id === company.countryId,
                    )
                      ? `${countries.find((country) => country._id === company.countryId)?.name} (${countries.find((country) => country._id === company.countryId)?.region})`
                      : undefined
                  }
                />
                <DetailItem
                  label="Account Manager"
                  value={
                    users.find((user) => user._id === company.accountManagerId)
                      ?.name
                  }
                />
                <DetailItem
                  label="Contract Status"
                  value={company.contractStatus}
                />
                <DetailItem
                  label="Payment Status"
                  value={company.paymentStatus}
                />
                <DetailItem
                  label="Payment Terms"
                  value={
                    company.paymentTermDays
                      ? `${company.paymentTermDays} days`
                      : undefined
                  }
                />
                <DetailItem label="Contact" value={company.contactName} />
                <DetailItem label="Email" value={company.contactEmail} />
                <DetailItem label="Website" value={company.website} />
              </CardContent>
            </Card>
          ) : (
            <Card className="max-w-3xl">
              <CardContent className="pt-6">
                <CompanyForm
                  company={company}
                  countries={countries}
                  sectors={sectors}
                  users={users}
                  onFinished={goBack}
                  showManageOneUsage={false}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="usage-trends" className="mt-4">
          {canViewTrends ? (
            <UsageTrendsSection history={usageHistory} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Usage Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  You do not have access to company usage trends.
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="manageone-usage" className="mt-4">
          <ManageOneUsageCard manageOneTenants={manageOneTenants} />
        </TabsContent>
      </Tabs>

      <div className="h-12" aria-hidden="true" />
    </div>
  );
}
