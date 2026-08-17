import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Filter,
  Link2,
  Search,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { CompanyCombobox } from "@/components/company-combobox.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
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

function currentMonthInputValue() {
  return new Date().toISOString().slice(0, 7);
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMoney(value?: number) {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function DailyUsagePage() {
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const createDraftInvoice = useMutation(
    api.dailyUsage.createDraftInvoiceFromRollup,
  );
  const [month, setMonth] = useState(currentMonthInputValue());
  const [companyId, setCompanyId] = useState("all");
  const [serviceType, setServiceType] = useState("all");
  const [usageDate, setUsageDate] = useState("all");
  const [search, setSearch] = useState("");
  const [creatingDraft, setCreatingDraft] = useState(false);

  const review = useQuery(api.dailyUsage.review, {
    month,
    companyId: companyId === "all" ? undefined : (companyId as Id<"companies">),
  });
  const health = useQuery(api.dailyUsage.health, {
    month,
    companyId: companyId === "all" ? undefined : (companyId as Id<"companies">),
  });

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (review?.rows ?? []).filter((row) => {
      if (serviceType !== "all" && row.serviceType !== serviceType) {
        return false;
      }
      if (usageDate !== "all" && row.usageDate !== usageDate) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [
        row.companyName,
        row.tenantName,
        row.serviceType,
        row.itemName,
        row.regionName,
        row.dataCenterName,
        row.unit,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [review?.rows, search, serviceType, usageDate]);

  const rollupRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (review?.rollup.rows ?? []).filter((row) => {
      if (serviceType !== "all" && row.serviceType !== serviceType) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [
        row.companyName,
        row.serviceType,
        row.itemName,
        row.regionName,
        row.dataCenterName,
        row.unit,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [review?.rollup.rows, search, serviceType]);

  const totals = useMemo(() => {
    const companyCount = new Set(rows.map((row) => row.companyId)).size;
    const dayCount = new Set(rows.map((row) => row.usageDate)).size;
    const serviceCount = new Set(rows.map((row) => row.serviceType)).size;
    return {
      rows: rows.length,
      companyCount,
      dayCount,
      serviceCount,
      locked: rows.filter((row) => row.lockedAt).length,
      attached: rows.filter((row) => row.invoiceId || row.lockedAt).length,
    };
  }, [rows]);

  const rollupTotals = useMemo(
    () => ({
      estimatedAmount: rollupRows.reduce(
        (total, row) => total + (row.estimatedAmount ?? 0),
        0,
      ),
      pricedRows: rollupRows.filter((row) => row.estimatedAmount !== undefined)
        .length,
      unpricedRows: rollupRows.filter(
        (row) => row.estimatedAmount === undefined,
      ).length,
    }),
    [rollupRows],
  );
  const canCreateDraft =
    companyId !== "all" &&
    rollupRows.length > 0 &&
    rollupTotals.unpricedRows === 0 &&
    totals.attached === 0;

  async function handleCreateDraftInvoice() {
    if (companyId === "all") {
      toast.error("Select one customer before creating a draft invoice");
      return;
    }
    if (!canCreateDraft) {
      toast.error("Daily usage rollup is not ready for draft invoicing");
      return;
    }
    const confirmed = window.confirm(
      `Create a draft invoice from daily usage for ${month}?`,
    );
    if (!confirmed) return;

    setCreatingDraft(true);
    try {
      const result = await createDraftInvoice({
        companyId: companyId as Id<"companies">,
        month,
      });
      toast.success("Daily usage draft invoice created");
      navigate(`/invoices/${result.invoiceId}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create daily usage invoice",
      );
    } finally {
      setCreatingDraft(false);
    }
  }

  if (!companies || !review) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Daily Usage Review
        </h1>
        <p className="mt-1 text-muted-foreground">
          Review captured daily ManageOne usage snapshots before monthly rollup
          or billing is enabled.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Snapshot rows" value={totals.rows} />
        <SummaryCard label="Customers" value={totals.companyCount} />
        <SummaryCard label="Services" value={totals.serviceCount} />
        <SummaryCard label="Captured days" value={totals.dayCount} />
      </div>

      <DailyUsageHealthPanel health={health} />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[180px_260px_220px_220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="daily-usage-month">Month</Label>
              <Input
                id="daily-usage-month"
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setUsageDate("all");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Customer</Label>
              <CompanyCombobox
                companies={companies}
                value={companyId}
                onValueChange={setCompanyId}
                className="sm:w-full"
              />
            </div>
            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger>
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {review.filters.serviceTypes.map((service) => (
                    <SelectItem key={service} value={service}>
                      {service}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Usage date</Label>
              <Select value={usageDate} onValueChange={setUsageDate}>
                <SelectTrigger>
                  <SelectValue placeholder="All days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All days</SelectItem>
                  {review.filters.usageDates.map((date) => (
                    <SelectItem key={date} value={date}>
                      {formatDate(date)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-usage-search">Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="daily-usage-search"
                  className="pl-9"
                  placeholder="Customer, tenant, service, region..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Monthly Rollup Preview</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only month-end preview from captured daily rows. Estimated
              quantities are prorated across {review.rollup.daysInMonth} days.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{rollupRows.length} rollup rows</Badge>
            <Badge variant="outline">
              {rollupTotals.unpricedRows} unpriced
            </Badge>
            <Badge variant="outline">{totals.attached} attached</Badge>
            <Button
              disabled={!canCreateDraft || creatingDraft}
              size="sm"
              onClick={handleCreateDraftInvoice}
            >
              <FileText className="mr-2 h-4 w-4" />
              {creatingDraft ? "Creating..." : "Create Draft Invoice"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {companyId === "all" ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              Select one customer to create a draft invoice from the daily usage
              rollup.
            </div>
          ) : null}
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <SummaryCard
              label="Estimated monthly total"
              valueText={formatMoney(rollupTotals.estimatedAmount)}
            />
            <SummaryCard label="Priced rows" value={rollupTotals.pricedRows} />
            <SummaryCard
              label="Unpriced rows"
              value={rollupTotals.unpricedRows}
            />
          </div>

          {rollupRows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Database className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>No monthly rollup rows yet.</EmptyTitle>
                <EmptyDescription>
                  The preview appears once daily usage snapshots exist for the
                  selected month and filters.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1120px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Region</th>
                    <th className="px-3 py-2 text-right">Days</th>
                    <th className="px-3 py-2 text-right">Daily Total</th>
                    <th className="px-3 py-2 text-right">Billable Qty</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2 text-right">Pricing</th>
                    <th className="px-3 py-2 text-right">Estimated Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rollupRows.map((row) => (
                    <tr
                      key={[
                        row.companyId,
                        row.serviceType,
                        row.itemName,
                        row.regionName ?? row.dataCenterName ?? "",
                      ].join("|")}
                      className="border-b last:border-0"
                    >
                      <td className="px-3 py-3 font-medium">
                        {row.companyName}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="secondary">{row.serviceType}</Badge>
                      </td>
                      <td className="px-3 py-3">{row.itemName}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.regionName ?? row.dataCenterName ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {row.capturedDays}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatQuantity(row.dailyQuantityTotal)}
                      </td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatQuantity(row.billableQuantity)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.unit}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="font-medium">
                          {formatMoney(row.monthlyUnitPrice)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.pricingSource === "contract"
                            ? `Contract ${row.contractNumber ?? ""}`.trim()
                            : "Catalog"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatMoney(row.estimatedAmount)}
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
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Captured Daily Usage</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only data captured from ManageOne snapshots. It does not
              create or change invoices.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{totals.attached} attached</Badge>
            <Badge variant="outline">{totals.locked} locked</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Database className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>No daily usage snapshots found.</EmptyTitle>
                <EmptyDescription>
                  The Phase 1 capture job stores rows after it runs. Adjust the
                  month or customer filter if you are reviewing older data.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1180px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Usage Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Tenant</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Quantity</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2">Region</th>
                    <th className="px-3 py-2">Captured</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          {formatDate(row.usageDate)}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-medium">
                        {row.companyName}
                      </td>
                      <td className="px-3 py-3">
                        <div>{row.tenantName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.tenantVdcId}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="secondary">{row.serviceType}</Badge>
                      </td>
                      <td className="px-3 py-3">{row.itemName}</td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatQuantity(row.quantity)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.unit}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.regionName ?? row.dataCenterName ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatTimestamp(row.capturedAt)}
                      </td>
                      <td className="px-3 py-3">
                        {row.lockedAt ? (
                          <Badge variant="outline">Locked</Badge>
                        ) : row.invoiceId ? (
                          <Badge variant="secondary">Drafted</Badge>
                        ) : (
                          <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
                            Captured
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <Filter className="mt-0.5 h-4 w-4" />
          <p>
            This page creates draft invoices only after you select one customer
            and review priced monthly rollup rows. Issued invoices lock the
            daily usage rows used.
          </p>
        </div>
      </div>
    </div>
  );
}

function HealthBadge({ healthy, label }: { healthy: boolean; label: string }) {
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

function DailyUsageHealthPanel({
  health,
}: {
  health:
    | {
        businessDate: string;
        linkedTenantCount: number;
        unlinkedTenantCount: number;
        latestHourly: {
          capturedAt: number | null;
          tenantCount: number;
          stale: boolean;
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
    return <Skeleton className="h-40" />;
  }

  const liveOk =
    Boolean(health.latestHourly.capturedAt) && !health.latestHourly.stale;
  const dailyOk =
    Boolean(health.dailyBilling.latestUsageDate) &&
    health.dailyBilling.capturedThroughToday;
  const catalogOk = health.catalog.missingPriceRowCount === 0;
  const linksOk =
    health.linkedTenantCount > 0 && health.unlinkedTenantCount === 0;

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Usage Data Health</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Safety checks before billing. This panel is read-only and does not
            change usage entries, quotes, invoices, or contracts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HealthBadge healthy={liveOk} label="Live snapshot" />
          <HealthBadge healthy={dailyOk} label="Billing snapshot" />
          <HealthBadge healthy={catalogOk} label="Catalog pricing" />
          <HealthBadge healthy={linksOk} label="Tenant links" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock3 className="h-4 w-4 text-cyan-600" />
            Live Resources
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Latest hourly capture
          </div>
          <div className="mt-1 text-sm font-medium">
            {formatTimestamp(health.latestHourly.capturedAt ?? undefined)}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Tenants in latest view
          </div>
          <div className="font-semibold">{health.latestHourly.tenantCount}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database className="h-4 w-4 text-cyan-600" />
            Billing Snapshot
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Latest usage date
          </div>
          <div className="mt-1 text-sm font-medium">
            {health.dailyBilling.latestUsageDate ?? "-"}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Latest day rows
          </div>
          <div className="font-semibold">
            {health.dailyBilling.latestDayRowCount}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4 text-cyan-600" />
            Tenant Links
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Linked tenants
          </div>
          <div className="font-semibold">{health.linkedTenantCount}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            Unlinked visible tenants
          </div>
          <div className="font-semibold">{health.unlinkedTenantCount}</div>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-cyan-600" />
            Pricing Gaps
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Rows without catalog price
          </div>
          <div className="font-semibold">
            {health.catalog.missingPriceRowCount}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {health.catalog.missingServices.length > 0
              ? health.catalog.missingServices.join(", ")
              : "No missing services"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  label,
  value,
  valueText,
}: {
  label: string;
  value?: number;
  valueText?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{valueText ?? value}</div>
      </CardContent>
    </Card>
  );
}
