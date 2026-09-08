import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCurrency } from "@/lib/format.ts";
import {
  AlertCircle,
  CheckCircle2,
  FileClock,
  FileText,
  Info,
  Search,
} from "lucide-react";
import { toast } from "sonner";

const statusLabel = {
  ready: "Ready",
  already_invoiced: "Draft / Invoiced",
  no_services: "Requires Review",
  not_in_period: "Not in Period",
  not_due: "Not Due",
  inactive: "Inactive",
} as const;

export default function BillingQueuePage() {
  const navigate = useNavigate();
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
  );
  const [search, setSearch] = useState("");
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const contracts = useQuery(api.invoices.previewContractInvoiceBatch, {
    sourceMonth: month,
  });
  const customers = useQuery(api.companies.dashboard, {});
  const createContractDraft = useMutation(api.invoices.createDraftFromContract);
  const createPaygDraft = useMutation(api.invoices.createPaygDraftFromUsage);

  if (!contracts || !customers)
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );

  const payg =
    month === customers.previousMonth
      ? customers.rows
          .filter((row) => row.missingInvoice)
          .map((row) => ({
            id: `payg:${row._id}`,
            companyId: row._id,
            companyName: row.name,
            model: "PAYG" as const,
            period: month,
            amount: row.previousMonthUsage,
            status: "ready" as const,
            reason: "Completed month with uninvoiced usage",
          }))
      : [];
  const rows = [
    ...payg,
    ...contracts.map((row) => ({
      id: `contract:${row.contractId}`,
      contractId: row.contractId,
      companyName: row.companyName,
      model: "Contracted" as const,
      period: month,
      amount: undefined,
      status: row.status,
      reason: row.reason,
      invoiceId: row.existingInvoiceId,
    })),
  ].filter((row) => {
    if (search && !row.companyName.toLowerCase().includes(search.toLowerCase()))
      return false;
    return (
      !onlyActionable || row.status === "ready" || row.status === "no_services"
    );
  });
  const counts = {
    ready: rows.filter((row) => row.status === "ready").length,
    review: rows.filter((row) => row.status === "no_services").length,
    existing: rows.filter((row) => row.status === "already_invoiced").length,
    waiting: rows.filter((row) => row.status === "not_due").length,
  };
  const summaryCards = [
    {
      label: "Ready to Invoice",
      count: counts.ready,
      icon: CheckCircle2,
      tone: "text-cyan-600",
    },
    {
      label: "Requires Review",
      count: counts.review,
      icon: AlertCircle,
      tone: "text-amber-600",
    },
    {
      label: "Draft / Invoiced",
      count: counts.existing,
      icon: FileText,
      tone: "text-teal-600",
    },
    {
      label: "Not Due",
      count: counts.waiting,
      icon: FileClock,
      tone: "text-slate-500",
    },
  ];

  async function generate(row: (typeof rows)[number]) {
    setPendingId(row.id);
    try {
      const invoiceId =
        "companyId" in row
          ? await createPaygDraft({ companyId: row.companyId, month })
          : await createContractDraft({
              contractId: row.contractId,
              sourceMonth: month,
            });
      toast.success("Draft invoice created");
      navigate(`/invoices/${invoiceId}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create draft invoice",
      );
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing Queue</h1>
        <p className="mt-1 text-muted-foreground">
          Review completed billing cycles before creating draft invoices.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, count, icon: Icon, tone }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="text-2xl font-bold">{count}</div>
              </div>
              <Icon className={`h-6 w-6 ${tone}`} />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
        <Info className="h-4 w-4" />
        This queue creates drafts for review. It never issues invoices
        automatically.
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Billing Candidates</CardTitle>
          <div className="grid gap-2 pt-2 sm:grid-cols-[1fr_180px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search customer..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Input
              aria-label="Billing month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <Button
              variant={onlyActionable ? "default" : "outline"}
              onClick={() => setOnlyActionable((value) => !value)}
            >
              Only actionable
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead>
                <tr className="border-y bg-muted/30 text-left">
                  <th className="p-3">Customer</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">Billing Period</th>
                  <th className="p-3 text-right">Usage</th>
                  <th className="p-3">Readiness</th>
                  <th className="p-3">Reason / Next Step</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-3 font-medium">{row.companyName}</td>
                    <td className="p-3">{row.model}</td>
                    <td className="p-3">{row.period}</td>
                    <td className="p-3 text-right">
                      {row.amount === undefined
                        ? "—"
                        : formatCurrency(row.amount)}
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={
                          row.status === "ready" ? "default" : "secondary"
                        }
                      >
                        {statusLabel[row.status]}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{row.reason}</td>
                    <td className="p-3 text-right">
                      {row.status === "ready" ? (
                        <Button
                          size="sm"
                          disabled={pendingId === row.id}
                          onClick={() => void generate(row)}
                        >
                          Generate Draft
                        </Button>
                      ) : row.invoiceId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/invoices/${row.invoiceId}`)}
                        >
                          Open Invoice
                        </Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-10 text-center text-muted-foreground"
                    >
                      No billing candidates match this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
