import { useMemo, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
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
import { formatCurrency } from "@/lib/format.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { downloadCsv, rowsToCsv, type CsvColumn } from "@/lib/csv.ts";

type ExpenseStatus = Doc<"expenseRequests">["status"];
type InvoicePaymentExportRow = {
  paymentDate: number;
  invoiceNumber: string;
  customerCompany: string;
  country: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  customerReference: string;
  receivingBankName: string;
  receivingAccountNumber: string;
  receivingAccountName: string;
  receivingBankLocation: string;
  receivingCurrencyNote: string;
  recordedByName: string;
  recordedByEmail: string;
  recordedAt: number;
  invoiceStatus: string;
  sourceReference: string;
};
type PaidExpenseExportRow = {
  expenseDate: number;
  paidDate: number;
  title: string;
  category: string;
  requesterName: string;
  requesterEmail: string;
  company: string;
  country: string;
  vendor: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  approvedByName: string;
  approvedByEmail: string;
  paidByName: string;
  paidByEmail: string;
  status: string;
};
type RegionIncomeExportRow = {
  paymentDate: number;
  invoiceNumber: string;
  customerCompany: string;
  country: string;
  region: string;
  allocatedAmount: number;
  originalPaymentAmount: number;
  paymentMethod: string;
  customerReference: string;
  recordedByName: string;
  recordedByEmail: string;
  recordedAt: number;
  invoiceStatus: string;
  sourceReference: string;
};
type IncomeByRegionRow = {
  region: string;
  income: number;
  paymentCount: number;
  invoiceCount: number;
};

const STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  cancelled: "Cancelled",
};

function currentMonthInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function currentYearStartMonth() {
  return `${new Date().getFullYear()}-01`;
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function formatDateForCsv(timestamp: number | undefined) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Mogadishu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function formatDateTimeForCsv(timestamp: number | undefined) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Mogadishu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const INVOICE_PAYMENT_EXPORT_COLUMNS: CsvColumn<InvoicePaymentExportRow>[] = [
  { header: "Payment Date", value: (row) => formatDateForCsv(row.paymentDate) },
  { header: "Invoice Number", value: (row) => row.invoiceNumber },
  { header: "Customer / Company", value: (row) => row.customerCompany },
  { header: "Country", value: (row) => row.country },
  { header: "Amount", value: (row) => row.amount.toFixed(2) },
  { header: "Currency", value: (row) => row.currency },
  { header: "Payment Method", value: (row) => row.paymentMethod },
  { header: "Customer Reference", value: (row) => row.customerReference },
  { header: "Receiving Bank Name", value: (row) => row.receivingBankName },
  {
    header: "Receiving Account Number",
    value: (row) => row.receivingAccountNumber,
  },
  {
    header: "Receiving Account Name",
    value: (row) => row.receivingAccountName,
  },
  {
    header: "Receiving Bank Location",
    value: (row) => row.receivingBankLocation,
  },
  {
    header: "Receiving Currency Note",
    value: (row) => row.receivingCurrencyNote,
  },
  { header: "Recorded By Name", value: (row) => row.recordedByName },
  { header: "Recorded By Email", value: (row) => row.recordedByEmail },
  {
    header: "Recorded At",
    value: (row) => formatDateTimeForCsv(row.recordedAt),
  },
  { header: "Invoice Status", value: (row) => row.invoiceStatus },
  { header: "Source Reference", value: (row) => row.sourceReference },
];

const REGION_INCOME_EXPORT_COLUMNS: CsvColumn<RegionIncomeExportRow>[] = [
  { header: "Payment Date", value: (row) => formatDateForCsv(row.paymentDate) },
  { header: "Invoice Number", value: (row) => row.invoiceNumber },
  { header: "Customer / Company", value: (row) => row.customerCompany },
  { header: "Country", value: (row) => row.country },
  { header: "Region / Data Center", value: (row) => row.region },
  {
    header: "Allocated Amount",
    value: (row) => row.allocatedAmount.toFixed(2),
  },
  {
    header: "Original Payment Amount",
    value: (row) => row.originalPaymentAmount.toFixed(2),
  },
  { header: "Payment Method", value: (row) => row.paymentMethod },
  { header: "Customer Reference", value: (row) => row.customerReference },
  { header: "Recorded By Name", value: (row) => row.recordedByName },
  { header: "Recorded By Email", value: (row) => row.recordedByEmail },
  {
    header: "Recorded At",
    value: (row) => formatDateTimeForCsv(row.recordedAt),
  },
  { header: "Invoice Status", value: (row) => row.invoiceStatus },
  { header: "Source Reference", value: (row) => row.sourceReference },
];

const PAID_EXPENSE_EXPORT_COLUMNS: CsvColumn<PaidExpenseExportRow>[] = [
  { header: "Expense Date", value: (row) => formatDateForCsv(row.expenseDate) },
  { header: "Paid Date", value: (row) => formatDateForCsv(row.paidDate) },
  { header: "Title", value: (row) => row.title },
  { header: "Category", value: (row) => row.category },
  { header: "Requester Name", value: (row) => row.requesterName },
  { header: "Requester Email", value: (row) => row.requesterEmail },
  { header: "Company", value: (row) => row.company },
  { header: "Country", value: (row) => row.country },
  { header: "Vendor", value: (row) => row.vendor },
  { header: "Amount", value: (row) => row.amount.toFixed(2) },
  { header: "Currency", value: (row) => row.currency },
  { header: "Payment Method", value: (row) => row.paymentMethod },
  { header: "Payment Reference", value: (row) => row.paymentReference },
  { header: "Approved By Name", value: (row) => row.approvedByName },
  { header: "Approved By Email", value: (row) => row.approvedByEmail },
  { header: "Paid By Name", value: (row) => row.paidByName },
  { header: "Paid By Email", value: (row) => row.paidByEmail },
  { header: "Status", value: (row) => row.status },
];

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function canViewReports(role: Doc<"users">["role"] | undefined) {
  return isAdminRole(role) || role === "country_gm";
}

export default function FinanceReportsPage() {
  const { currentUser } = useCrm();
  const convex = useConvex();
  const [startMonth, setStartMonth] = useState(currentYearStartMonth());
  const [endMonth, setEndMonth] = useState(currentMonthInputValue());
  const [countryFilter, setCountryFilter] = useState("all");
  const [exporting, setExporting] = useState<
    "invoice-payments" | "region-income" | "paid-expenses" | null
  >(null);
  const canView = canViewReports(currentUser?.role);
  const canFilterCountry = isAdminRole(currentUser?.role);
  const countries = useQuery(
    api.countries.list,
    canFilterCountry ? {} : "skip",
  );
  const report = useQuery(
    api.financeReports.summary,
    canView
      ? {
          startMonth,
          endMonth,
          countryId:
            canFilterCountry && countryFilter !== "all"
              ? (countryFilter as Id<"countries">)
              : undefined,
        }
      : "skip",
  );

  const chartData = useMemo(
    () =>
      (report?.monthly ?? []).map((row) => ({
        ...row,
        label: formatMonthLabel(row.month),
      })),
    [report],
  );
  const hasData =
    (report?.totals.income ?? 0) > 0 ||
    (report?.totals.recognizedRevenue ?? 0) > 0 ||
    (report?.totals.expenses ?? 0) > 0 ||
    (report?.expenseStatusSummary ?? []).some((row) => row.count > 0);
  const exportArgs = {
    startMonth,
    endMonth,
    countryId:
      canFilterCountry && countryFilter !== "all"
        ? (countryFilter as Id<"countries">)
        : undefined,
  };

  async function handleExportInvoicePayments() {
    setExporting("invoice-payments");
    try {
      const rows = await convex.query(
        api.financeReports.invoicePaymentsExport,
        exportArgs,
      );
      downloadCsv(
        `finance-invoice-payments-${startMonth}-to-${endMonth}.csv`,
        rowsToCsv(INVOICE_PAYMENT_EXPORT_COLUMNS, rows),
      );
      toast.success("Invoice payments CSV exported");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to export invoice payments",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPaidExpenses() {
    setExporting("paid-expenses");
    try {
      const rows = await convex.query(
        api.financeReports.paidExpensesExport,
        exportArgs,
      );
      downloadCsv(
        `finance-paid-expenses-${startMonth}-to-${endMonth}.csv`,
        rowsToCsv(PAID_EXPENSE_EXPORT_COLUMNS, rows),
      );
      toast.success("Paid expenses CSV exported");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to export paid expenses",
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExportRegionIncome() {
    setExporting("region-income");
    try {
      const rows = await convex.query(
        api.financeReports.invoicePaymentsByRegionExport,
        exportArgs,
      );
      downloadCsv(
        `finance-region-income-${startMonth}-to-${endMonth}.csv`,
        rowsToCsv(REGION_INCOME_EXPORT_COLUMNS, rows),
      );
      toast.success("Region income CSV exported");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to export region income",
      );
    } finally {
      setExporting(null);
    }
  }

  if (currentUser === undefined) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance Reports</h1>
          <p className="mt-1 text-muted-foreground">
            Operational income and expense reporting for finance leadership.
          </p>
        </div>
        <Card>
          <CardContent className="p-8">
            <h2 className="text-lg font-semibold">
              Finance reports unavailable
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Finance reports are available to CEO, Head of Business, and
              Country GM roles.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!report || (canFilterCountry && !countries)) {
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
  const visibleCountries = countries ?? [];

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance Reports</h1>
          <p className="mt-1 text-muted-foreground">
            Operational income, expense, and approval status reporting. USD only
            for this phase.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExportInvoicePayments}
            disabled={exporting !== null}
          >
            <Download className="mr-2 size-4" />
            {exporting === "invoice-payments"
              ? "Exporting..."
              : "Export Invoice Payments CSV"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportRegionIncome}
            disabled={exporting !== null}
          >
            <Download className="mr-2 size-4" />
            {exporting === "region-income"
              ? "Exporting..."
              : "Export Region Income CSV"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportPaidExpenses}
            disabled={exporting !== null}
          >
            <Download className="mr-2 size-4" />
            {exporting === "paid-expenses"
              ? "Exporting..."
              : "Export Paid Expenses CSV"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="space-y-2">
          <Label htmlFor="finance-report-start">Start month</Label>
          <Input
            id="finance-report-start"
            type="month"
            value={startMonth}
            onChange={(event) => setStartMonth(event.target.value)}
            className="w-[180px]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="finance-report-end">End month</Label>
          <Input
            id="finance-report-end"
            type="month"
            value={endMonth}
            onChange={(event) => setEndMonth(event.target.value)}
            className="w-[180px]"
          />
        </div>
        {canFilterCountry ? (
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger
                className="w-[220px]"
                aria-label="Filter by country"
              >
                <SelectValue placeholder="All Countries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Countries</SelectItem>
                {visibleCountries.map((country) => (
                  <SelectItem key={country._id} value={country._id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Income"
          value={formatCurrency(report.totals.income)}
        />
        <SummaryCard
          title="Recognized contract revenue"
          value={formatCurrency(report.totals.recognizedRevenue ?? 0)}
        />
        <SummaryCard
          title="Pre-collected allocation"
          value={formatCurrency(report.totals.preCollected ?? 0)}
        />
        <SummaryCard
          title="Expected collections"
          value={formatCurrency(report.totals.expectedCollections ?? 0)}
        />
        <SummaryCard
          title="Expenses"
          value={formatCurrency(report.totals.expenses)}
        />
        <SummaryCard title="Net" value={formatCurrency(report.totals.net)} />
        <SummaryCard
          title="Paid invoice payments"
          value={report.totals.paymentCount.toLocaleString()}
        />
      </div>

      {!hasData ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No finance report data yet.</EmptyTitle>
            <EmptyDescription>
              Recorded invoice payments and paid expense requests will appear
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Monthly Income vs Expenses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="label" className="text-xs" />
                <YAxis tickFormatter={formatCompact} className="text-xs" />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  labelFormatter={(label) => String(label)}
                />
                <Legend />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill="oklch(0.6 0.18 170)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses"
                  fill="oklch(0.65 0.18 35)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3">Month</th>
                  <th className="px-3 py-3 text-right">Income</th>
                  <th className="px-3 py-3 text-right">Recognized</th>
                  <th className="px-3 py-3 text-right">Pre-collected</th>
                  <th className="px-3 py-3 text-right">Expected</th>
                  <th className="px-3 py-3 text-right">Expenses</th>
                  <th className="px-3 py-3 text-right">Net</th>
                  <th className="px-3 py-3 text-right">Payments</th>
                  <th className="px-3 py-3 text-right">Paid Expenses</th>
                </tr>
              </thead>
              <tbody>
                {report.monthly.map((row) => (
                  <tr key={row.month} className="border-b last:border-0">
                    <td className="px-3 py-3 font-medium">
                      {formatMonthLabel(row.month)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(row.income)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(row.recognizedRevenue ?? 0)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(row.preCollected ?? 0)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(row.expectedCollections ?? 0)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {formatCurrency(row.expenses)}
                    </td>
                    <td className="px-3 py-3 text-right font-medium">
                      {formatCurrency(row.net)}
                    </td>
                    <td className="px-3 py-3 text-right">{row.paymentCount}</td>
                    <td className="px-3 py-3 text-right">
                      {row.paidExpenseCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Income by Region / Data Center</CardTitle>
          <p className="text-sm text-muted-foreground">
            Allocated income from invoice payments. Payments are recorded at the
            invoice level and split by invoice line item region totals.
          </p>
        </CardHeader>
        <CardContent>
          {(report.incomeByRegion ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No region income data in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Region / Data Center</th>
                    <th className="px-3 py-3 text-right">Allocated Income</th>
                    <th className="px-3 py-3 text-right">Payments</th>
                    <th className="px-3 py-3 text-right">Invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.incomeByRegion as IncomeByRegionRow[]).map((row) => (
                    <tr key={row.region} className="border-b last:border-0">
                      <td className="px-3 py-3 font-medium">{row.region}</td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(row.income)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {row.paymentCount}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {row.invoiceCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Expense Categories</CardTitle>
          </CardHeader>
          <CardContent>
            {report.topExpenseCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No paid expenses in this period.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3 text-right">Count</th>
                    <th className="px-3 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topExpenseCategories.map((category) => (
                    <tr
                      key={category.categoryId}
                      className="border-b last:border-0"
                    >
                      <td className="px-3 py-3 font-medium">
                        {category.categoryName}
                      </td>
                      <td className="px-3 py-3 text-right">{category.count}</td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(category.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expense Status Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.expenseStatusSummary.map((row) => (
                <div
                  key={row.status}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      {STATUS_LABELS[row.status]}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {row.count} request{row.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatCurrency(row.total)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
