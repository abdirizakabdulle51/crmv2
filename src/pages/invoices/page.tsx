import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { FileText, Eye } from "lucide-react";

type Invoice = Doc<"invoices">;
type InvoiceStatus = Invoice["status"];

const STATUS_OPTIONS: Array<{ value: "all" | InvoiceStatus; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "sent", label: "Sent" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
  { value: "cancelled", label: "Cancelled" },
];

function formatDate(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: InvoiceStatus) {
  return (
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
  );
}

function statusBadge(status: InvoiceStatus) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "issued":
      return (
        <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
          Issued
        </Badge>
      );
    case "sent":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Sent
        </Badge>
      );
    case "partially_paid":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Partially Paid
        </Badge>
      );
    case "paid":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          Paid
        </Badge>
      );
    case "overdue":
      return <Badge variant="destructive">Overdue</Badge>;
    case "void":
    case "cancelled":
      return <Badge variant="outline">{statusLabel(status)}</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const invoices = useQuery(api.invoices.list, {});
  const companies = useQuery(api.companies.list, {});
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>(
    "all",
  );
  const [companyFilter, setCompanyFilter] = useState("all");
  const [search, setSearch] = useState("");

  const companyMap = useMemo(
    () => new Map((companies ?? []).map((company) => [company._id, company])),
    [companies],
  );

  if (!invoices || !companies) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const totalInvoiced = invoices
    .filter(
      (invoice) =>
        invoice.status !== "void" && invoice.status !== "cancelled",
    )
    .reduce((sum, invoice) => sum + invoice.grandTotal, 0);
  const outstanding = invoices
    .filter(
      (invoice) =>
        invoice.status !== "void" &&
        invoice.status !== "cancelled" &&
        invoice.status !== "paid",
    )
    .reduce((sum, invoice) => sum + invoice.balanceDue, 0);
  const paid = invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0);
  const overdue = invoices
    .filter((invoice) => invoice.status === "overdue")
    .reduce((sum, invoice) => sum + invoice.balanceDue, 0);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredInvoices = invoices
    .filter((invoice) => {
      if (statusFilter !== "all" && invoice.status !== statusFilter) {
        return false;
      }
      if (companyFilter !== "all" && invoice.companyId !== companyFilter) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return [
        invoice.invoiceNumber,
        invoice.companyName,
        companyMap.get(invoice.companyId)?.name,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearch));
    })
    .sort((a, b) => {
      const aDate = a.issueDate ?? a.createdAt;
      const bDate = b.issueDate ?? b.createdAt;
      return bDate - aDate;
    });

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="mt-1 text-muted-foreground">
            Track issued invoices, balances, and customer payment status.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Invoiced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalInvoiced)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {formatCurrency(outstanding)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Paid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {formatCurrency(paid)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {formatCurrency(overdue)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search invoices or customers..."
          className="lg:max-w-sm"
        />
        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setStatusFilter(value as "all" | InvoiceStatus)
          }
        >
          <SelectTrigger className="w-[190px]" aria-label="Filter by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filter by company">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((company) => (
              <SelectItem key={company._id} value={company._id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {invoices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No invoices yet.</EmptyTitle>
            <EmptyDescription>
              Accepted quotes can become draft invoices in the next phase.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : filteredInvoices.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No matching invoices</EmptyTitle>
            <EmptyDescription>
              Adjust your filters to see invoice records.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium">Invoice Number</th>
                  <th className="p-3 text-left font-medium">
                    Date / Issue Date
                  </th>
                  <th className="p-3 text-left font-medium">Customer</th>
                  <th className="p-3 text-right font-medium">Total</th>
                  <th className="p-3 text-right font-medium">Balance Due</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Due Date</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => {
                  const invoiceHref = `/invoices/${invoice._id}`;
                  const openInvoice = () => navigate(invoiceHref);

                  return (
                    <tr
                      key={invoice._id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={openInvoice}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openInvoice();
                        }
                      }}
                    >
                      <td className="p-3 font-medium">
                        {invoice.invoiceNumber ?? "Draft"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {formatDate(invoice.issueDate ?? invoice.createdAt)}
                      </td>
                      <td className="p-3">{invoice.companyName}</td>
                      <td className="p-3 text-right">
                        {formatCurrency(invoice.grandTotal)}
                      </td>
                      <td className="p-3 text-right">
                        {formatCurrency(invoice.balanceDue)}
                      </td>
                      <td className="p-3">{statusBadge(invoice.status)}</td>
                      <td className="p-3 text-muted-foreground">
                        {formatDate(invoice.dueDate)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            openInvoice();
                          }}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
