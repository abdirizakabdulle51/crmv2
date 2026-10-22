import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, Search, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { formatCurrency } from "@/lib/format.ts";

const statusLabels = {
  reconciled: "Reconciled",
  in_progress: "In progress",
  missing_snapshot: "Calculation missing",
  stale_snapshot: "Calculation changed",
  pricing_issue: "Pricing issue",
  missing_invoice: "Invoice missing",
  duplicate_invoice: "Duplicate invoice",
  invoice_variance: "Invoice variance",
  attachment_issue: "Attachment issue",
} as const;

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Mogadishu",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export default function RevenueAssurancePage() {
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const assurance = useQuery(api.dailyUsage.revenueAssurance, { month });
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (assurance?.rows ?? []).filter(
      (row) =>
        (status === "all" || row.status === status) &&
        (!term ||
          row.companyName.toLowerCase().includes(term) ||
          row.invoiceNumber?.toLowerCase().includes(term)),
    );
  }, [assurance?.rows, search, status]);

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Revenue Assurance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One control view from captured usage to saved calculation and invoice.
        </p>
      </div>

      {!assurance ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton className="h-28" key={index} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Metric
            title="Customers checked"
            value={String(assurance.summary.customers)}
          />
          <Metric
            title="Reconciled"
            value={String(assurance.summary.reconciled)}
          />
          <Metric
            title="Exceptions"
            value={String(assurance.summary.exceptions)}
            alert={assurance.summary.exceptions > 0}
          />
          <Metric
            title="Rated usage"
            value={formatCurrency(assurance.summary.expectedUsageAmount)}
          />
        </div>
      )}

      <Card>
        <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Billing controls</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Contract invoice totals can differ from usage because commitment
              terms apply; their source and attachment are still verified.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Billing month"
              className="sm:w-40"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <div className="relative sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Customer or invoice"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="sm:w-48">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!assurance ? (
            <Skeleton className="m-6 h-72" />
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No usage billing records match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-left">
                    <th className="p-3 font-medium">Customer</th>
                    <th className="p-3 font-medium">Model</th>
                    <th className="p-3 text-right font-medium">Rated usage</th>
                    <th className="p-3 text-right font-medium">Invoice</th>
                    <th className="p-3 text-right font-medium">Variance</th>
                    <th className="p-3 font-medium">Coverage</th>
                    <th className="p-3 font-medium">Status / next step</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr className="border-b align-top" key={row.companyId}>
                      <td className="p-3 font-medium">
                        <Link
                          className="hover:underline"
                          to={`/companies/${row.companyId}`}
                        >
                          {row.companyName}
                        </Link>
                      </td>
                      <td className="p-3 uppercase text-muted-foreground">
                        {row.model}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {formatCurrency(row.expectedUsageAmount)}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {row.invoiceId ? (
                          <Link
                            className="hover:underline"
                            to={`/invoices/${row.invoiceId}`}
                          >
                            {formatCurrency(row.invoiceAmount ?? 0)}
                            <span className="block text-xs text-muted-foreground">
                              {row.invoiceNumber ?? "Draft"}
                            </span>
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {row.variance === null
                          ? "Contract governed"
                          : formatCurrency(row.variance)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {row.rowCount} rows · {row.serviceCount} services
                        <span className="block text-xs">
                          Through {row.latestUsageDate ?? "—"}
                        </span>
                      </td>
                      <td className="max-w-sm p-3">
                        <Badge
                          variant={
                            row.status === "reconciled"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {statusLabels[row.status]}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.reason}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  title,
  value,
  alert = false,
}: {
  title: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        {alert ? (
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        ) : title === "Reconciled" ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        ) : (
          <ShieldCheck className="h-5 w-5 text-cyan-600" />
        )}
      </CardContent>
    </Card>
  );
}
