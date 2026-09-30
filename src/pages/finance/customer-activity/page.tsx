import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowDownToLine, ChevronRight, Download, FileText } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";

const MODEL_LABELS: Record<string, string> = {
  payg: "PAYG",
  flexible_total_commitment: "Overall commitment",
  monthly_minimum: "Monthly minimum",
  discounted_usage: "Discounted usage",
  historical: "Historical",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  cancelled: "Cancelled",
  applied: "Applied",
  reversed: "Reversed",
  reversal: "Reversal",
};

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00`).getTime();
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59.999`).getTime();
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function periodLabel(start?: string, end?: string) {
  if (!start) return "—";
  return end && end !== start ? `${start} – ${end}` : start;
}

function paymentTiming(row: {
  status: string;
  date: number;
  dueDate?: number;
  settledAt?: number;
}) {
  if (!row.dueDate) return "—";
  const day = 86_400_000;
  if (row.status === "paid" && row.settledAt) {
    const days = Math.max(0, Math.ceil((row.settledAt - row.date) / day));
    return `Paid in ${days} day${days === 1 ? "" : "s"}`;
  }
  const days = Math.ceil((row.dueDate - Date.now()) / day);
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days} days`;
}

function statusBadge(status: string) {
  if (status === "paid" || status === "applied") {
    return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">{STATUS_LABELS[status]}</Badge>;
  }
  if (status === "partially_paid") {
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Partially paid</Badge>;
  }
  if (status === "overdue" || status === "reversed" || status === "reversal") {
    return <Badge variant="destructive">{STATUS_LABELS[status]}</Badge>;
  }
  return <Badge variant="secondary">{STATUS_LABELS[status] ?? status}</Badge>;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function CustomerBillingActivityPage() {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);
  const [companyId, setCompanyId] = useState("all");
  const [countryId, setCountryId] = useState("all");
  const [currency, setCurrency] = useState("USD");
  const [startDate, setStartDate] = useState(isoDate(ninetyDaysAgo));
  const [endDate, setEndDate] = useState(isoDate(now));
  const [activityType, setActivityType] = useState("all");
  const [model, setModel] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const companies = useQuery(api.companies.list, {});
  const countries = useQuery(api.countries.list, {});
  const activity = useQuery(api.customerBillingActivity.list, {
    companyId: companyId === "all" ? undefined : companyId as never,
    countryId: countryId === "all" ? undefined : countryId as never,
    currency: currency === "all" ? undefined : currency,
    startDate: startOfDay(startDate),
    endDate: endOfDay(endDate),
    activityType: activityType === "all" ? undefined : activityType as "invoice" | "payment",
    model: model === "all" ? undefined : model as never,
    status: status === "all" ? undefined : status,
    sort,
  });

  const visibleCompanies = useMemo(
    () => (companies ?? []).filter((company) => countryId === "all" || company.countryId === countryId),
    [companies, countryId],
  );

  const exportCsv = () => {
    if (!activity?.rows.length) return;
    const headings = ["Date", "Customer", "Activity", "Reference", "Invoice", "Billing model", "Period or account", "Amount", "Applied", "Remaining or advance", "Currency", "Payment timing", "Status"];
    const lines = activity.rows.map((row) => [
      formatDate(row.date), row.companyName, row.type, row.reference,
      row.type === "payment" ? row.invoiceNumber : row.reference,
      MODEL_LABELS[row.model], row.type === "invoice" ? periodLabel(row.periodStart, row.periodEnd) : [row.receivingBankName, row.receivingAccountName, row.receivingAccountNumber].filter(Boolean).join(" · "),
      row.amount, row.appliedAmount, row.remainingAmount, row.currency,
      row.type === "invoice" ? paymentTiming(row) : "", STATUS_LABELS[row.status] ?? row.status,
    ]);
    const csv = [headings, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `customer-billing-activity-${startDate}-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div><h1 className="text-2xl font-semibold tracking-tight">Customer Billing Activity</h1><p className="text-sm text-muted-foreground">Invoices and payments in one chronological view.</p></div>
        <Button variant="outline" onClick={exportCsv} disabled={!activity?.rows.length}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2"><Label>Customer</Label><Select value={companyId} onValueChange={setCompanyId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All customers</SelectItem>{visibleCompanies.map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Country</Label><Select value={countryId} onValueChange={(value) => { setCountryId(value); setCompanyId("all"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All countries</SelectItem>{(countries ?? []).map((row) => <SelectItem key={row._id} value={row._id}>{row.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="activity-start">Start date</Label><Input id="activity-start" type="date" value={startDate} max={endDate} onChange={(event) => event.target.value && setStartDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="activity-end">End date</Label><Input id="activity-end" type="date" value={endDate} min={startDate} onChange={(event) => event.target.value && setEndDate(event.target.value)} /></div>
          <div className="space-y-2"><Label>Billing model</Label><Select value={model} onValueChange={setModel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All models</SelectItem>{Object.entries(MODEL_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Status</Label><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Currency</Label><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All currencies</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Sort</Label><Select value={sort} onValueChange={(value) => setSort(value as "asc" | "desc")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="desc">Newest first</SelectItem><SelectItem value="asc">Oldest first</SelectItem></SelectContent></Select></div>
          <div className="flex flex-col gap-2 sm:col-span-2 xl:col-span-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={activityType} onValueChange={setActivityType}><TabsList><TabsTrigger value="all">All activity</TabsTrigger><TabsTrigger value="invoice">Invoices</TabsTrigger><TabsTrigger value="payment">Payments</TabsTrigger></TabsList></Tabs>
            <span className="text-sm text-muted-foreground">{activity ? `${activity.total} activities found${activity.total > 500 ? "; showing first 500" : ""}` : "Loading activity…"}</span>
          </div>
        </CardContent>
      </Card>

      {!activity ? <Skeleton className="h-80 w-full" /> : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Customer</th><th className="px-4 py-3 font-medium">Activity</th><th className="px-4 py-3 font-medium">Reference</th><th className="px-4 py-3 font-medium">Billing model</th><th className="px-4 py-3 font-medium">Period / account</th><th className="px-4 py-3 text-right font-medium">Amount</th><th className="px-4 py-3 font-medium">Payment timing</th><th className="px-4 py-3 font-medium">Status</th><th className="w-10" /></tr></thead>
              <tbody className="divide-y">
                {activity.rows.map((row) => {
                  const transactionHref = `/finance/account-transactions?source=invoice_payment${row.receivingAccountId ? `&accountId=${row.receivingAccountId}` : ""}`;
                  return <tr key={row.key} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-4">{formatDate(row.date)}</td>
                    <td className="px-4 py-4"><Link className="font-medium text-primary hover:underline" to={`/companies/${row.companyId}`}>{row.companyName}</Link></td>
                    <td className="px-4 py-4"><span className="flex items-center gap-2">{row.type === "invoice" ? <FileText className="h-4 w-4 text-primary" /> : <ArrowDownToLine className="h-4 w-4 text-emerald-600" />}{row.type === "invoice" ? "Invoice" : "Payment"}</span></td>
                    <td className="px-4 py-4"><Link className="font-medium text-primary hover:underline" to={row.type === "invoice" ? `/invoices/${row.invoiceId}` : transactionHref}>{row.reference}</Link>{row.type === "payment" && row.invoiceNumber ? <Link to={`/invoices/${row.invoiceId}`} className="mt-1 block text-xs text-muted-foreground hover:underline">{row.invoiceNumber}</Link> : null}</td>
                    <td className="px-4 py-4">{MODEL_LABELS[row.model] ?? row.model}</td>
                    <td className="px-4 py-4 text-muted-foreground">{row.type === "invoice" ? periodLabel(row.periodStart, row.periodEnd) : [row.receivingBankName, row.receivingAccountName, row.receivingAccountNumber].filter(Boolean).join(" · ") || "Account not recorded"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right font-medium">{formatMoney(row.amount, row.currency)}</td>
                    <td className="whitespace-nowrap px-4 py-4">{row.type === "invoice" ? paymentTiming(row) : "—"}</td>
                    <td className="px-4 py-4">{statusBadge(row.status)}</td>
                    <td className="px-4 py-4"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                  </tr>;
                })}
                {activity.rows.length === 0 ? <tr><td colSpan={10} className="px-4 py-16 text-center text-muted-foreground">No invoices or payments match these filters.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
