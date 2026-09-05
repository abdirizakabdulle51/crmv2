import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { CompanyCombobox } from "@/components/company-combobox.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { fromCents, toCents } from "@/convex/money.ts";

type HistoricalArgs = {
  companyId: Id<"companies">;
  originalReference: string;
  invoiceDate: string;
  coverageStartMonth: string;
  monthsCovered: number;
  monthlyAmount: number;
  paymentDate: string;
  paymentMethod?: string;
  receivingAccountId?: Id<"receivingAccounts">;
  paymentReference?: string;
  transactionId?: string;
  notes?: string;
};
type HistoricalInvoiceRow = Doc<"invoices"> & { paymentDate?: number };
type HistoricalListRef = FunctionReference<"query", "public", Record<string, never>, HistoricalInvoiceRow[]>;
type HistoricalCreateRef = FunctionReference<"mutation", "public", HistoricalArgs, Id<"invoices">>;
const historicalApi = api as unknown as {
  historicalInvoices: { list: HistoricalListRef; create: HistoricalCreateRef };
};

function monthsFrom(start: string, count: number) {
  if (!/^\d{4}-\d{2}$/.test(start) || !Number.isInteger(count) || count < 1) return [];
  const base = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const absolute = base + index;
    return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, "0")}`;
  });
}

function dateLabel(value?: number) {
  if (value === undefined) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(value));
}

function emptyForm() {
  return {
    companyId: "", originalReference: "", invoiceDate: "", coverageStartMonth: "",
    monthsCovered: "1", monthlyAmount: "", paymentDate: "", paymentMethod: "Bank Transfer",
    receivingAccountId: "", paymentReference: "", transactionId: "", notes: "",
  };
}

export default function HistoricalInvoicesPage() {
  const companies = useQuery(api.companies.list, {});
  const accounts = useQuery(api.receivingAccounts.list, { purpose: "incoming" });
  const historicalInvoices = useQuery(historicalApi.historicalInvoices.list, {});
  const createHistorical = useMutation(historicalApi.historicalInvoices.create);
  const [form, setForm] = useState(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const months = useMemo(() => monthsFrom(form.coverageStartMonth, Number(form.monthsCovered)), [form.coverageStartMonth, form.monthsCovered]);
  const monthlyCents = Number(form.monthlyAmount) > 0 ? toCents(Number(form.monthlyAmount), "Monthly amount") : 0;
  const total = fromCents(monthlyCents * (Number(form.monthsCovered) || 0));
  const set = (field: keyof ReturnType<typeof emptyForm>, value: string) => setForm((current) => ({ ...current, [field]: value }));

  if (!companies || !accounts || !historicalInvoices) {
    return <div className="space-y-4 p-6 md:p-8"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.companyId || !form.originalReference.trim() || !form.invoiceDate || !form.coverageStartMonth || !form.paymentDate || !Number(form.monthlyAmount) || !Number.isInteger(Number(form.monthsCovered)) || Number(form.monthsCovered) < 1) {
      toast.error("Complete all required historical invoice fields");
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await createHistorical({
        companyId: form.companyId as Id<"companies">,
        originalReference: form.originalReference,
        invoiceDate: form.invoiceDate,
        coverageStartMonth: form.coverageStartMonth,
        monthsCovered: Number(form.monthsCovered),
        monthlyAmount: Number(form.monthlyAmount),
        paymentDate: form.paymentDate,
        paymentMethod: form.paymentMethod,
        receivingAccountId: form.receivingAccountId ? form.receivingAccountId as Id<"receivingAccounts"> : undefined,
        paymentReference: form.paymentReference || undefined,
        transactionId: form.transactionId || undefined,
        notes: form.notes || undefined,
      });
      toast.success("Historical paid invoice recorded");
      setForm(emptyForm());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record historical invoice");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div><h1 className="text-2xl font-bold tracking-tight">Historical Paid Invoices</h1><p className="mt-1 text-muted-foreground">Record paid invoices and payments from the previous Odoo system.</p></div>
      <form onSubmit={submit} className="space-y-6">
        <Card><CardHeader><CardTitle>Historical invoice</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2"><Label>Customer *</Label><CompanyCombobox companies={companies} value={form.companyId} onValueChange={(value) => set("companyId", value)} allLabel="Select customer" /></div>
          <div className="space-y-2"><Label htmlFor="historical-reference">Original Odoo / Historical Reference *</Label><Input id="historical-reference" value={form.originalReference} onChange={(e) => set("originalReference", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="invoice-date">Invoice Date *</Label><Input id="invoice-date" type="date" value={form.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="coverage-month">Coverage Start Month *</Label><Input id="coverage-month" type="month" value={form.coverageStartMonth} onChange={(e) => set("coverageStartMonth", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="months-covered">Months Covered *</Label><Input id="months-covered" type="number" min="1" step="1" value={form.monthsCovered} onChange={(e) => set("monthsCovered", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="monthly-amount">Monthly Amount (USD) *</Label><Input id="monthly-amount" type="number" min="0.01" step="0.01" value={form.monthlyAmount} onChange={(e) => set("monthlyAmount", e.target.value)} /></div>
          <div className="space-y-2"><Label>Invoice Total</Label><Input value={formatCurrency(total)} readOnly /></div>
          <div className="space-y-2"><Label htmlFor="payment-date">Payment Date *</Label><Input id="payment-date" type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} /></div>
          <div className="space-y-2"><Label>Payment Amount</Label><Input value={formatCurrency(total)} readOnly /></div>
          <div className="space-y-2"><Label htmlFor="payment-method">Payment Method</Label><Input id="payment-method" value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} /></div>
          <div className="space-y-2 lg:col-span-2"><Label htmlFor="receiving-account">Receiving Account</Label><select id="receiving-account" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={form.receivingAccountId} onChange={(e) => set("receivingAccountId", e.target.value)}><option value="">No account selected</option>{accounts.map((account) => <option key={account._id} value={account._id}>{account.name} — {account.providerName}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="payment-reference">Payment / Bank Reference</Label><Input id="payment-reference" value={form.paymentReference} onChange={(e) => set("paymentReference", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="transaction-id">Transaction ID</Label><Input id="transaction-id" value={form.transactionId} onChange={(e) => set("transactionId", e.target.value)} /></div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label htmlFor="historical-notes">Notes</Label><Textarea id="historical-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </CardContent></Card>
        {months.length > 0 && Number(form.monthlyAmount) > 0 ? <Card><CardHeader><CardTitle>Coverage preview</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{months.map((month) => <div className="flex justify-between" key={month}><span>{new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))}</span><span>{formatCurrency(Number(form.monthlyAmount))}</span></div>)}<div className="flex justify-between border-t pt-2 font-semibold"><span>Invoice Total</span><span>{formatCurrency(total)}</span></div></CardContent></Card> : null}
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Recording…" : "Record Historical Paid Invoice"}</Button>
      </form>
      <Card><CardHeader><CardTitle>Historical ledger</CardTitle></CardHeader><CardContent><div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/30"><th className="p-3 text-left">Customer</th><th className="p-3 text-left">Original Reference</th><th className="p-3 text-left">Invoice Date</th><th className="p-3 text-left">Coverage</th><th className="p-3 text-right">Total</th><th className="p-3 text-left">Payment Date</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Source</th></tr></thead><tbody>{historicalInvoices.map((invoice) => <tr key={invoice._id} className="border-b last:border-0"><td className="p-3">{invoice.companyName}</td><td className="p-3">{invoice.originalReference}</td><td className="p-3">{dateLabel(invoice.issueDate)}</td><td className="p-3">{invoice.historicalCoverageStartMonth} ({invoice.historicalCoverageMonths} month{invoice.historicalCoverageMonths === 1 ? "" : "s"})</td><td className="p-3 text-right">{formatCurrency(invoice.grandTotal)}</td><td className="p-3">{dateLabel(invoice.paymentDate)}</td><td className="p-3"><Badge variant="secondary">{invoice.status}</Badge></td><td className="p-3"><Badge>Historical · Odoo</Badge></td></tr>)}</tbody></table></div></CardContent></Card>
    </div>
  );
}
