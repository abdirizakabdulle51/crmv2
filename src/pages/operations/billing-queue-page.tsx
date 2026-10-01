import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
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
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { useDebounce } from "@/hooks/use-debounce.ts";
import {
  AlertCircle,
  CheckCircle2,
  FileClock,
  FileText,
  Info,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

const statusLabel = {
  ready: "Ready",
  already_invoiced: "Draft / Invoiced",
  needs_refresh: "Refresh Required",
  no_services: "Requires Review",
  incomplete_usage: "Incomplete Usage",
  unpriced: "Unpriced Services",
  missing_profile: "Missing Billing Profile",
  no_charge: "No Charge",
  unlinked_tenant: "Unlinked Tenant",
  not_in_period: "Not in Period",
  not_due: "Not Due",
  inactive: "Inactive",
} as const;

function BillingQueuePageContent() {
  const navigate = useNavigate();
  const now = new Date();
  const previousMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const [month, setMonth] = useState(
    `${previousMonth.getUTCFullYear()}-${String(previousMonth.getUTCMonth() + 1).padStart(2, "0")}`,
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [queueType, setQueueType] = useState<"payg" | "contracts">("payg");
  const [page, setPage] = useState(0);
  const [onlyActionable, setOnlyActionable] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [gapReview, setGapReview] = useState<{
    companyId: string;
    companyName: string;
  }>();
  const [zeroGap, setZeroGap] = useState<{
    tenantId: string;
    tenantName: string;
    usageDate: string;
  }>();
  const [zeroReason, setZeroReason] = useState("");
  const [assignmentDates, setAssignmentDates] = useState<
    Record<string, string>
  >({});
  const contracts = useQuery(
    api.invoices.previewContractInvoiceBatch,
    queueType === "contracts" ? { sourceMonth: month } : "skip",
  );
  const payg = useQuery(
    api.dailyUsage.billingCandidatesPage,
    queueType === "payg"
      ? {
          month,
          page,
          pageSize: 20,
          search: debouncedSearch || undefined,
        }
      : "skip",
  );
  const usageGaps = useQuery(
    api.dailyUsage.usageGaps,
    gapReview ? { companyId: gapReview.companyId as never, month } : "skip",
  );
  const createContractDraft = useMutation(api.invoices.createDraftFromContract);
  const createPaygDraft = useMutation(
    api.dailyUsage.createDraftInvoiceFromRollup,
  );
  const refreshPaygDraft = useMutation(
    api.dailyUsage.refreshDraftInvoiceFromRollup,
  );
  const confirmZeroUsageGap = useMutation(api.dailyUsage.confirmZeroUsageGap);
  const correctTenantAssignmentStart = useMutation(
    api.dailyUsage.correctTenantAssignmentStart,
  );

  useEffect(() => setPage(0), [month, debouncedSearch, queueType]);

  const loading = queueType === "payg" ? !payg : !contracts;
  const sourceRows =
    queueType === "payg"
      ? (payg?.rows ?? []).map((row) => ({
          ...row,
          id:
            "companyId" in row
              ? `payg:${row.companyId}`
              : `tenant:${row.tenantId}`,
        }))
      : (contracts ?? []).map((row) => ({
          id: `contract:${row.contractId}`,
          contractId: row.contractId,
          companyName: row.companyName,
          model: "Contracted" as const,
          period: month,
          amount: row.amount,
          status: row.status,
          reason: row.reason,
          invoiceId: row.existingInvoiceId,
        }));
  const rows = sourceRows.filter((row) => {
    if (search && !row.companyName.toLowerCase().includes(search.toLowerCase()))
      return false;
    return (
      !onlyActionable ||
      !["already_invoiced", "not_in_period", "not_due", "inactive"].includes(
        row.status,
      )
    );
  });
  const counts = {
    ready: rows.filter((row) => row.status === "ready").length,
    review: rows.filter((row) =>
      [
        "no_services",
        "incomplete_usage",
        "unpriced",
        "missing_profile",
        "needs_refresh",
        "unlinked_tenant",
      ].includes(row.status),
    ).length,
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
      if (row.model === "Unlinked") return;
      const invoiceId =
        row.model === "PAYG"
          ? row.status === "needs_refresh" && row.invoiceId
            ? (await refreshPaygDraft({ invoiceId: row.invoiceId })).invoiceId
            : (await createPaygDraft({ companyId: row.companyId, month }))
                .invoiceId
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

  async function confirmZero() {
    if (!gapReview || !zeroGap) return;
    setPendingId(`gap:${zeroGap.tenantId}:${zeroGap.usageDate}`);
    try {
      await confirmZeroUsageGap({
        companyId: gapReview.companyId as never,
        tenantId: zeroGap.tenantId as never,
        usageDate: zeroGap.usageDate,
        reason: zeroReason,
      });
      toast.success("Zero usage confirmed", {
        description: `${zeroGap.tenantName} · ${zeroGap.usageDate}`,
      });
      setZeroGap(undefined);
      setZeroReason("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not resolve gap",
      );
    } finally {
      setPendingId(undefined);
    }
  }

  async function correctAssignment(tenantId: string, assignmentId: string) {
    if (!assignmentDates[tenantId]) return;
    setPendingId(`assignment:${tenantId}`);
    try {
      await correctTenantAssignmentStart({
        assignmentId: assignmentId as never,
        effectiveFrom: assignmentDates[tenantId],
      });
      toast.success("Tenant assignment date updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update assignment",
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
          Review automatically prepared drafts and billing exceptions.
        </p>
      </div>
      <Tabs
        value={queueType}
        onValueChange={(value) => setQueueType(value as typeof queueType)}
      >
        <TabsList>
          <TabsTrigger value="payg">PAYG</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
        </TabsList>
      </Tabs>
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
        Completed PAYG and contract cycles create drafts automatically. Invoices
        are never issued or emailed without review.
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
              onChange={(event) =>
                event.target.value && setMonth(event.target.value)
              }
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
          {loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-72" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead>
                  <tr className="border-y bg-muted/30 text-left">
                    <th className="p-3">Customer</th>
                    <th className="p-3">Model</th>
                    <th className="p-3">Billing Period</th>
                    <th className="p-3 text-right">Usage</th>
                    <th className="p-3">Coverage</th>
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
                      <td className="p-3 text-muted-foreground">
                        {"expectedLastDate" in row
                          ? row.latestUsageDate
                            ? `${row.latestUsageDate} / ${row.expectedLastDate}`
                            : `No data / ${row.expectedLastDate}`
                          : "—"}
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
                      <td className="p-3 text-muted-foreground">
                        {row.reason}
                      </td>
                      <td className="p-3 text-right">
                        {row.status === "incomplete_usage" &&
                        row.model === "PAYG" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setGapReview({
                                companyId: row.companyId,
                                companyName: row.companyName,
                              })
                            }
                          >
                            Review Usage Gaps
                          </Button>
                        ) : row.status === "ready" ||
                          row.status === "needs_refresh" ? (
                          <Button
                            size="sm"
                            disabled={pendingId === row.id}
                            onClick={() => void generate(row)}
                          >
                            {row.status === "needs_refresh"
                              ? "Refresh Draft"
                              : "Generate Draft"}
                          </Button>
                        ) : "invoiceId" in row && row.invoiceId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigate(`/invoices/${row.invoiceId}`)
                            }
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
                        colSpan={8}
                        className="p-10 text-center text-muted-foreground"
                      >
                        No billing candidates match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {queueType === "payg" && payg && !loading ? (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Page {page + 1} · {payg.total} eligible customers
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!payg.hasMore}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Dialog
        open={Boolean(gapReview)}
        onOpenChange={(open) => {
          if (!open) {
            setGapReview(undefined);
            setZeroGap(undefined);
            setZeroReason("");
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review usage gaps</DialogTitle>
            <DialogDescription>
              {gapReview?.companyName} · {month}. Confirm zero usage only after
              checking ManageOne, or correct an assignment that began later.
            </DialogDescription>
          </DialogHeader>
          {!usageGaps ? (
            <Skeleton className="h-40" />
          ) : usageGaps.length === 0 ? (
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
              All tenant-day gaps are resolved. The queue will update
              automatically.
            </div>
          ) : (
            <div className="space-y-3">
              {usageGaps.map((gap) => {
                const assignmentDate =
                  assignmentDates[gap.tenantId] ??
                  gap.assignmentEffectiveFrom ??
                  "";
                const gapKey = `gap:${gap.tenantId}:${gap.usageDate}`;
                return (
                  <div key={gapKey} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{gap.tenantName}</div>
                        <div className="text-sm text-muted-foreground">
                          Missing capture: {gap.usageDate}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setZeroGap(gap);
                          setZeroReason("");
                        }}
                      >
                        Confirm Zero Usage
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label htmlFor={`assignment-${gap.tenantId}`}>
                          Assignment effective from
                        </Label>
                        <Input
                          id={`assignment-${gap.tenantId}`}
                          type="date"
                          value={assignmentDate}
                          onChange={(event) =>
                            setAssignmentDates((current) => ({
                              ...current,
                              [gap.tenantId]: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <Button
                        variant="secondary"
                        disabled={
                          !assignmentDate ||
                          !gap.assignmentId ||
                          assignmentDate === gap.assignmentEffectiveFrom ||
                          pendingId === `assignment:${gap.tenantId}`
                        }
                        onClick={() =>
                          gap.assignmentId &&
                          void correctAssignment(gap.tenantId, gap.assignmentId)
                        }
                      >
                        Update Assignment
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {zeroGap ? (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div>
                <div className="font-medium">Confirm genuine zero usage</div>
                <div className="text-sm text-muted-foreground">
                  {zeroGap.tenantName} · {zeroGap.usageDate}
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="zero-usage-reason">Audit reason</Label>
                <Textarea
                  id="zero-usage-reason"
                  value={zeroReason}
                  onChange={(event) => setZeroReason(event.target.value)}
                  placeholder="Example: Verified in ManageOne; tenant had no active resources."
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setZeroGap(undefined)}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    zeroReason.trim().length < 5 ||
                    pendingId === `gap:${zeroGap.tenantId}:${zeroGap.usageDate}`
                  }
                  onClick={() => void confirmZero()}
                >
                  Confirm Zero Usage
                </Button>
              </div>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            If ManageOne contains usage for a missing day, recover the
            historical source data before confirming anything. This screen never
            substitutes current usage for a past date.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

class BillingQueueErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Billing queue failed", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6 md:p-8">
        <Card className="max-w-2xl border-destructive/40">
          <CardHeader>
            <CardTitle>Billing queue could not load</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {this.state.error.message ||
                "The selected billing calculation failed."}
            </p>
            <Button onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}

export default function BillingQueuePage() {
  return (
    <BillingQueueErrorBoundary>
      <BillingQueuePageContent />
    </BillingQueueErrorBoundary>
  );
}
