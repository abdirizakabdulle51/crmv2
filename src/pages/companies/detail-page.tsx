import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
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
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Database,
  Link2,
} from "lucide-react";
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
      { key: "bmsInstances", label: "BMS", color: "#0f766e" },
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
      { key: "wafBasicInstances", label: "WAF Basic", color: "#f97316" },
      { key: "wafEnterpriseInstances", label: "WAF Ent", color: "#be123c" },
    ],
  },
] satisfies Array<{
  title: string;
  metrics: Array<{
    key: keyof Pick<
      TenantUsageHistoryRow,
      | "ecsInstances"
      | "bmsInstances"
      | "ecsCores"
      | "ecsRamGb"
      | "rdsInstances"
      | "cceClusters"
      | "evsGb"
      | "obsGb"
      | "sfsGb"
      | "publicIps"
      | "wafInstances"
      | "wafBasicInstances"
      | "wafEnterpriseInstances"
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

function currentMonthInputValue() {
  return new Date().toISOString().slice(0, 7);
}

function formatTimestamp(value?: number | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function HealthStatusBadge({
  healthy,
  label,
}: {
  healthy: boolean;
  label: string;
}) {
  return (
    <Badge
      variant="outline"
      className={
        healthy
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
      }
    >
      {healthy ? (
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
      ) : (
        <AlertTriangle className="mr-1 h-3.5 w-3.5" />
      )}
      {label}
    </Badge>
  );
}

function UsageHealthPanel({
  health,
}: {
  health:
    | {
        month: string;
        businessDate: string;
        linkedTenantCount: number;
        unlinkedTenantCount: number;
        latestHourly: {
          capturedAt: number | null;
          tenantCount: number;
          stale: boolean;
          totals: {
            ecs: number;
            cce: number;
            bms: number;
            vcpu: number;
            ramGb: number;
            evsGb: number;
            sfsGb: number;
            csbsGb: number;
            vbsGb: number;
            obsGb: number;
            eip: number;
            elb: number;
            vpn: number;
            vpcep: number;
            nat: number;
            waf: number;
          };
        };
        dailyBilling: {
          latestUsageDate: string | null;
          capturedThroughToday: boolean;
          rowCount: number;
          latestDayRowCount: number;
          attachedRowCount: number;
        };
        catalog: {
          missingPriceRowCount: number;
          missingServices: string[];
        };
      }
    | undefined;
}) {
  if (!health) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Usage Data Health</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const liveOk =
    Boolean(health.latestHourly.capturedAt) && !health.latestHourly.stale;
  const dailyOk =
    Boolean(health.dailyBilling.latestUsageDate) &&
    health.dailyBilling.capturedThroughToday;
  const catalogOk = health.catalog.missingPriceRowCount === 0;
  const linksOk =
    health.linkedTenantCount > 0 && health.unlinkedTenantCount === 0;
  const totals = health.latestHourly.totals;

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Usage Data Health</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only checks. Billing, quotes, invoices, and contracts are not
            changed here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HealthStatusBadge healthy={liveOk} label="Live snapshot" />
          <HealthStatusBadge healthy={dailyOk} label="Billing snapshot" />
          <HealthStatusBadge healthy={catalogOk} label="Catalog pricing" />
          <HealthStatusBadge healthy={linksOk} label="Tenant links" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-4">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock3 className="h-4 w-4 text-cyan-600" />
              Live Resources
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Latest hourly capture
            </div>
            <div className="mt-1 text-sm font-medium">
              {formatTimestamp(health.latestHourly.capturedAt)}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Tenants in latest view
            </div>
            <div className="mt-1 text-lg font-semibold">
              {health.latestHourly.tenantCount}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4 text-cyan-600" />
              Billing Snapshot
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Latest daily usage date
            </div>
            <div className="mt-1 text-sm font-medium">
              {health.dailyBilling.latestUsageDate ?? "-"}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Rows captured this month
            </div>
            <div className="mt-1 text-lg font-semibold">
              {health.dailyBilling.rowCount}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4 text-cyan-600" />
              Company Linking
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Linked ManageOne tenants
            </div>
            <div className="mt-1 text-lg font-semibold">
              {health.linkedTenantCount}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Unlinked visible tenants
            </div>
            <div className="mt-1 text-sm font-medium">
              {health.unlinkedTenantCount}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-cyan-600" />
              Pricing Gaps
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Rows without catalog price
            </div>
            <div className="mt-1 text-lg font-semibold">
              {health.catalog.missingPriceRowCount}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {health.catalog.missingServices.length > 0
                ? health.catalog.missingServices.join(", ")
                : "No missing services"}
            </div>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 text-sm font-medium">Latest Live Totals</div>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["ECS", totals.ecs],
              ["ECS-CCE", totals.cce],
              ["BMS", totals.bms],
              ["vCPU", totals.vcpu],
              ["RAM GB", totals.ramGb],
              ["EVS GB", totals.evsGb],
              ["SFS GB", totals.sfsGb],
              ["CSBS GB", totals.csbsGb],
              ["VBS GB", totals.vbsGb],
              ["OBS GB", totals.obsGb],
              ["EIP", totals.eip],
              ["ELB", totals.elb],
              ["VPN", totals.vpn],
              ["VPCEP", totals.vpcep],
              ["NAT", totals.nat],
              ["WAF", totals.waf],
            ].map(([label, value]) => (
              <div key={label} className="rounded bg-background px-3 py-2">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-semibold">
                  {formatNumber(Number(value))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
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

function OnboardingCreditCard({
  companyId,
  canManage,
}: {
  companyId: Id<"companies">;
  canManage: boolean;
}) {
  const credits = useQuery(api.customerCredits.listByCompany, { companyId });
  const grant = useMutation(api.customerCredits.grant);
  const [amount, setAmount] = useState("");
  const [policy, setPolicy] = useState<"first_invoice_only" | "carry_forward">(
    "first_invoice_only",
  );
  const [appliesTo, setAppliesTo] = useState<
    "all" | "contract" | "non_contract"
  >("all");
  const [pending, setPending] = useState(false);

  return (
    <Card className="mt-4 max-w-3xl">
      <CardHeader>
        <CardTitle>Onboarding Credit</CardTitle>
        <p className="text-sm text-muted-foreground">
          Customer-level credit that can apply with or without a contract.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {(credits ?? []).map((credit) => (
            <div key={credit._id} className="rounded-md border p-3 text-sm">
              <div className="font-medium">
                {credit.description ?? "Onboarding credit"}
              </div>
              <div className="mt-1 text-muted-foreground">
                ${credit.remainingAmount.toFixed(2)} remaining · {credit.status}
              </div>
            </div>
          ))}
        </div>
        {canManage && (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Credit amount</Label>
              <Input
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Unused balance</Label>
              <Select
                value={policy}
                onValueChange={(value) => setPolicy(value as typeof policy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first_invoice_only">
                    First invoice only
                  </SelectItem>
                  <SelectItem value="carry_forward">Carry forward</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Applies to</Label>
              <Select
                value={appliesTo}
                onValueChange={(value) =>
                  setAppliesTo(value as typeof appliesTo)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All invoices</SelectItem>
                  <SelectItem value="contract">Contract invoices</SelectItem>
                  <SelectItem value="non_contract">
                    Non-contract invoices
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                disabled={pending || !amount || Number(amount) <= 0}
                onClick={async () => {
                  setPending(true);
                  try {
                    await grant({
                      companyId,
                      amount: Number(amount),
                      policy,
                      appliesTo,
                      description: "Onboarding credit",
                    });
                    setAmount("");
                    toast.success("Onboarding credit granted");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Could not grant credit",
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Grant credit
              </Button>
            </div>
          </div>
        )}
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
  const usageHealth = useQuery(
    api.dailyUsage.health,
    companyId && !isDrMode
      ? { companyId, month: currentMonthInputValue() }
      : "skip",
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
          <TabsTrigger value="company-info">Company Detail</TabsTrigger>
          <TabsTrigger value="usage-trends">Usage Trends</TabsTrigger>
          <TabsTrigger value="manageone-usage">Billing & Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="company-info" className="mt-4">
          {isDrMode ? (
            <Card>
              <CardHeader>
                <CardTitle>Company Detail</CardTitle>
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
            <>
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
              <OnboardingCreditCard
                companyId={company._id}
                canManage={
                  currentUser?.role === "ceo" ||
                  currentUser?.role === "head_of_business"
                }
              />
            </>
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
          <div className="space-y-4">
            <UsageHealthPanel health={usageHealth} />
            <ManageOneUsageCard manageOneTenants={manageOneTenants} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="h-12" aria-hidden="true" />
    </div>
  );
}
