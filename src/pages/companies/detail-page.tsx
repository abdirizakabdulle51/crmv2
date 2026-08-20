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
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  DollarSign,
  FileText,
  Link2,
  Receipt,
  WalletCards,
} from "lucide-react";
import { useCrm } from "@/lib/crm-context.tsx";
import {
  CompanyForm,
  ManageOneUsageCard,
} from "./_components/company-dialog.tsx";
import { isDrMode } from "@/lib/dr-mode.ts";
import { formatCurrency } from "@/lib/format.ts";

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

function formatDateLabel(value?: number | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateKeyLabel(value: string) {
  const [, month, day] = value.split("-");
  return month && day ? `${month}/${day}` : value;
}

function billingFrequencyLabel(value: string) {
  switch (value) {
    case "yearly":
      return "year";
    case "quarterly":
    case "every_3_months":
      return "quarter";
    default:
      return "month";
  }
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

function FinancialMetricCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">{title}</div>
        <div className="text-cyan-600">{icon}</div>
      </div>
      <div className="mt-3 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function BillingUsageSection({
  snapshot,
}: {
  snapshot:
    | {
        month: string;
        currentBalance: number;
        upcomingCharges: number;
        paidThisMonth: number;
        projectedMonthEnd: number | null;
        contractCoverage: {
          contractId: Id<"customerContracts">;
          contractNumber: string;
          title: string;
          billingFrequency: string;
          capturedDays: number;
          monthDayCount: number;
          contractPeriodAmount: number;
          frequencyMonthCount: number;
          coverageBasis: "month_to_date" | "contract_period";
          monthlyMinimum: number;
          includedToDate: number;
          usageToDate: number;
          extraToDate: number;
          status: "within_contract" | "overage" | "pricing_not_configured";
          rows: Array<{
            lineItemId: Id<"customerContractLineItems">;
            itemName: string;
            serviceCategory: string;
            includedQuantity: number;
            unit: string;
            amount: number;
            includedAmount: number;
            extraAmount: number;
          }>;
        } | null;
        dailyUsageReady: boolean;
        latestUsageDate: string | null;
        dailySeries: Array<{
          usageDate: string;
          dailyCharge: number;
          cumulativeCharge: number;
        }>;
        chargeBreakdown: Array<{
          serviceType: string;
          amount: number;
          billableQuantity: number;
          capturedDays: number;
          unpricedCount: number;
        }>;
        openInvoices: Array<{
          _id: Id<"invoices">;
          invoiceNumber?: string;
          status: string;
          issueDate?: number;
          dueDate?: number;
          grandTotal: number;
          amountPaid: number;
          balanceDue: number;
        }>;
        recentPayments: Array<{
          _id: Id<"invoicePayments">;
          invoiceId: Id<"invoices">;
          invoiceNumber?: string;
          amount: number;
          paidAt: number;
          method?: string;
          reference?: string;
        }>;
        unpricedCount: number;
        uninvoicedRowCount: number;
        dailyRowCount: number;
      }
    | undefined;
}) {
  if (!snapshot) {
    return (
      <Card className="max-w-5xl">
        <CardHeader>
          <CardTitle>Billing & Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = snapshot.dailySeries.map((row) => ({
    ...row,
    label: formatDateKeyLabel(row.usageDate),
  }));

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Billing & Usage</CardTitle>
          <p className="text-sm text-muted-foreground">
            Read-only view of customer balance, payments, and current month usage.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FinancialMetricCard
              title="Current Balance"
              value={formatCurrency(snapshot.currentBalance)}
              detail="Open invoice balance due"
              icon={<WalletCards className="h-4 w-4" />}
            />
            <FinancialMetricCard
              title="Current Usage Bill"
              value={
                snapshot.dailyUsageReady
                  ? formatCurrency(snapshot.upcomingCharges)
                  : "Not calculated"
              }
              detail={
                snapshot.dailyUsageReady
                  ? "Unbilled usage as of today"
                  : "Daily billing snapshot missing"
              }
              icon={<Receipt className="h-4 w-4" />}
            />
            <FinancialMetricCard
              title="Paid This Month"
              value={formatCurrency(snapshot.paidThisMonth)}
              detail={`Payments recorded for ${snapshot.month}`}
              icon={<DollarSign className="h-4 w-4" />}
            />
            <FinancialMetricCard
              title="Projected Month End"
              value={
                snapshot.projectedMonthEnd === null
                  ? "Not available"
                  : formatCurrency(snapshot.projectedMonthEnd)
              }
              detail={
                snapshot.latestUsageDate
                  ? "Estimated full-month usage"
                  : "No daily usage captured"
              }
              icon={<BarChart3 className="h-4 w-4" />}
            />
          </div>

          {snapshot.contractCoverage ? (
            <ContractCoveragePanel coverage={snapshot.contractCoverage} />
          ) : null}

          {!snapshot.dailyUsageReady ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Daily usage has not been calculated for this month. Upcoming
              charges and projection will appear after the midnight billing sync
              or Auto-fill from ManageOne runs.
            </div>
          ) : null}

          <div className="rounded-md border p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Daily Billing Trend</div>
                <div className="text-xs text-muted-foreground">
                  Daily usage cost and month-to-date total.
                </div>
              </div>
              <Badge variant="outline">{snapshot.month}</Badge>
            </div>
            {chartData.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `$${Number(value) / 1000}k`}
                      width={56}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatCurrency(Number(value)),
                        name === "Daily usage cost"
                          ? "Daily usage cost"
                          : "Month-to-date total",
                      ]}
                      labelClassName="text-foreground"
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="dailyCharge"
                      name="Daily usage cost"
                      stroke="#35C7C9"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulativeCharge"
                      name="Month-to-date total"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No daily billing rows found for this company and month.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Charge Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.chargeBreakdown.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 font-medium">Service</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                      <th className="py-2 text-right font-medium">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.chargeBreakdown.map((row) => (
                      <tr key={row.serviceType} className="border-b last:border-0">
                        <td className="py-2 font-medium">{row.serviceType}</td>
                        <td className="py-2 text-right">
                          {row.unpricedCount > 0
                            ? "Missing price"
                            : formatCurrency(row.amount)}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {row.capturedDays}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No uninvoiced usage charges for this month.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices & Payments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-cyan-600" />
                Open invoices
              </div>
              {snapshot.openInvoices.length > 0 ? (
                <div className="space-y-2">
                  {snapshot.openInvoices.map((invoice) => (
                    <div
                      key={invoice._id}
                      className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <div className="font-medium">
                          {invoice.invoiceNumber ?? "Draft invoice"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Due {formatDateLabel(invoice.dueDate)}
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <div className="font-semibold">
                          {formatCurrency(invoice.balanceDue)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {invoice.status.replace("_", " ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No open invoices.
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <DollarSign className="h-4 w-4 text-cyan-600" />
                Recent payments this month
              </div>
              {snapshot.recentPayments.length > 0 ? (
                <div className="space-y-2">
                  {snapshot.recentPayments.map((payment) => (
                    <div
                      key={payment._id}
                      className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <div className="font-medium">
                          {payment.invoiceNumber ?? "Invoice"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateLabel(payment.paidAt)}
                        </div>
                      </div>
                      <div className="text-left font-semibold sm:text-right">
                        {formatCurrency(payment.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No payments recorded this month.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ContractCoveragePanel({
  coverage,
}: {
  coverage: NonNullable<
    NonNullable<Parameters<typeof BillingUsageSection>[0]["snapshot"]>["contractCoverage"]
  >;
}) {
  const visibleRows = coverage.rows.filter(
    (row) => row.amount > 0 || row.includedAmount > 0,
  );
  const frequencyLabel = billingFrequencyLabel(coverage.billingFrequency);
  const hasConfiguredContractValue = coverage.contractPeriodAmount > 0;
  const remainingCoverage = hasConfiguredContractValue
    ? Math.max(0, coverage.includedToDate - coverage.usageToDate)
    : 0;

  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium">Contract Coverage</div>
            <Badge
              variant={
                coverage.status === "overage"
                  ? "destructive"
                  : coverage.status === "pricing_not_configured"
                    ? "outline"
                    : "secondary"
              }
            >
              {coverage.status === "overage"
                ? "Extra usage"
                : coverage.status === "pricing_not_configured"
                  ? "Pricing not configured"
                  : "Within contract"}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {coverage.contractNumber} · {coverage.title}
          </div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Contract value</div>
            <div className="font-semibold">
              {formatCurrency(coverage.contractPeriodAmount)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                / {frequencyLabel}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {coverage.coverageBasis === "contract_period"
                ? "Used this period"
                : "Covered so far"}
            </div>
            <div className="font-semibold">
              {formatCurrency(coverage.usageToDate)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {coverage.coverageBasis === "contract_period"
                ? "Remaining coverage"
                : "Covered so far"}
            </div>
            <div className="font-semibold">
              {hasConfiguredContractValue
                ? formatCurrency(
                    coverage.coverageBasis === "contract_period"
                      ? remainingCoverage
                      : coverage.includedToDate,
                  )
                : "-"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Extra so far</div>
            <div className="font-semibold">
              {hasConfiguredContractValue
                ? formatCurrency(coverage.extraToDate)
                : "-"}
            </div>
          </div>
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 font-medium">Service</th>
                <th className="py-2 text-right font-medium">Included</th>
                <th className="py-2 text-right font-medium">Covered</th>
                <th className="py-2 text-right font-medium">Current usage</th>
                <th className="py-2 text-right font-medium">Extra</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.lineItemId} className="border-b last:border-0">
                  <td className="py-2">
                    <div className="font-medium">{row.itemName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.serviceCategory}
                    </div>
                  </td>
                  <td className="py-2 text-right text-muted-foreground">
                    {row.includedQuantity} {row.unit}
                  </td>
                  <td className="py-2 text-right">
                    {formatCurrency(row.includedAmount)}
                  </td>
                  <td className="py-2 text-right">
                    {formatCurrency(row.amount)}
                  </td>
                  <td className="py-2 text-right">
                    {row.extraAmount > 0
                      ? formatCurrency(row.extraAmount)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-3 text-xs text-muted-foreground">
        {coverage.status === "pricing_not_configured"
          ? "This contract exists, but its priced contract services are not configured yet. This is read-only and does not create or change invoices."
          : coverage.coverageBasis === "contract_period"
            ? `Based on current usage for ${coverage.billingFrequency} contract coverage. This is read-only and does not create or change invoices.`
            : `Based on ${coverage.capturedDays} of ${coverage.monthDayCount} captured billing days. This is read-only and does not create or change invoices.`}
      </div>
    </div>
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
  const usageHealth = useQuery(
    api.dailyUsage.health,
    companyId && !isDrMode
      ? { companyId, month: currentMonthInputValue() }
      : "skip",
  );
  const billingSnapshot = useQuery(
    api.dailyUsage.companyBillingSnapshot,
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
        <TabsList className="grid h-auto w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="company-info">Company Detail</TabsTrigger>
          <TabsTrigger value="usage-trends">Usage Trends</TabsTrigger>
          <TabsTrigger value="manageone-usage">Cloud Resources</TabsTrigger>
          <TabsTrigger value="billing-usage">Billing & Usage</TabsTrigger>
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
          <div className="space-y-4">
            <UsageHealthPanel health={usageHealth} />
            <ManageOneUsageCard manageOneTenants={manageOneTenants} />
          </div>
        </TabsContent>

        <TabsContent value="billing-usage" className="mt-4">
          {isDrMode ? (
            <Card className="max-w-5xl">
              <CardHeader>
                <CardTitle>Billing & Usage</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Billing snapshot is available in the live CRM.
                </div>
              </CardContent>
            </Card>
          ) : (
            <BillingUsageSection snapshot={billingSnapshot} />
          )}
        </TabsContent>
      </Tabs>

      <div className="h-12" aria-hidden="true" />
    </div>
  );
}
