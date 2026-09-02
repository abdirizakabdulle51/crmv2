import { Component, type ReactNode, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CreditCard,
  FileText,
  Loader2,
  LockKeyhole,
  Printer,
  Send,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
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
import { Textarea } from "@/components/ui/textarea.tsx";
import { formatCurrency } from "@/lib/format.ts";

type Invoice = Doc<"invoices">;
type InvoiceEvent = Doc<"invoiceEvents"> & {
  actorEmail?: string;
  actorName?: string;
};
type InvoicePayment = Doc<"invoicePayments">;
type InvoiceStatus = Invoice["status"];
type InvoiceLineItem = Invoice["lineItems"][number];
type User = Doc<"users">;
type CleanupAction = "cancel" | "void" | "mark_test" | "unmark_test";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  cancelled: "Cancelled",
};

const PRINTABLE_STATUSES = new Set<InvoiceStatus>([
  "draft",
  "issued",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
]);

const PAYABLE_STATUSES = new Set<InvoiceStatus>([
  "issued",
  "sent",
  "overdue",
  "partially_paid",
]);
const VOIDABLE_STATUSES = new Set<InvoiceStatus>([
  "issued",
  "sent",
  "partially_paid",
  "overdue",
]);

const PAYMENT_METHODS = ["Bank Transfer", "Mobile Money"];

function formatDate(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateInput(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatUserDisplayName(user?: User) {
  return user?.name?.trim() || user?.email?.trim() || "Recorded user";
}

function formatActorDisplayName(event: InvoiceEvent) {
  return (
    event.actorName?.trim() ||
    event.actorEmail?.trim() ||
    (event.actorId ? "Unknown user" : undefined)
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
      return <Badge variant="outline">{STATUS_LABELS[status]}</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function eventLabel(type: InvoiceEvent["type"]) {
  switch (type) {
    case "draft_created":
      return "Draft created";
    case "draft_updated":
      return "Draft updated";
    case "issued":
      return "Issued";
    case "cancelled":
      return "Cancelled";
    case "voided":
      return "Voided";
    case "marked_test":
      return "Marked test";
    case "unmarked_test":
      return "Unmarked test";
    case "sent":
      return "Sent";
    case "payment_recorded":
      return "Payment recorded";
    default:
      return type;
  }
}

function cleanupEventAction(type: InvoiceEvent["type"]) {
  switch (type) {
    case "cancelled":
      return "Invoice cancelled";
    case "voided":
      return "Invoice voided";
    case "marked_test":
      return "Invoice marked as test/hidden";
    case "unmarked_test":
      return "Invoice unmarked as test/hidden";
    default:
      return undefined;
  }
}

function cleanupEventReason(message?: string) {
  if (!message) return undefined;
  const reasonIndex = message.indexOf("Reason:");
  if (reasonIndex >= 0) {
    return message.slice(reasonIndex + "Reason:".length).trim();
  }
  return message.trim();
}

function eventMessage(event: InvoiceEvent) {
  const action = cleanupEventAction(event.type);
  if (!action) {
    return event.message;
  }
  const actor = formatActorDisplayName(event);
  if (!actor) {
    return event.message;
  }
  const reason = cleanupEventReason(event.message);
  return `${action} by ${actor}.${reason ? ` Reason: ${reason}` : ""}`;
}

function lineItemRegionLabel(item: InvoiceLineItem) {
  return (
    item.regionName || item.dataCenterName || item.regionId || "Unassigned"
  );
}

function hasLineItemRegion(item: InvoiceLineItem) {
  return Boolean(item.regionName || item.dataCenterName || item.regionId);
}

function buildRegionTotals(lineItems: InvoiceLineItem[]) {
  const totals = new Map<string, number>();
  for (const item of lineItems) {
    const label = lineItemRegionLabel(item);
    totals.set(label, (totals.get(label) ?? 0) + item.monthlyTotal);
  }
  return [...totals.entries()].map(([label, total]) => ({ label, total }));
}

function paymentReceivingDetails(payment: InvoicePayment) {
  if (
    !payment.receivingAccountNumber &&
    !payment.receivingAccountName &&
    !payment.receivingBankLocation &&
    !payment.receivingCurrencyNote
  ) {
    return "-";
  }
  return [
    payment.receivingBankName,
    payment.receivingAccountNumber
      ? `ACCOUNT # = ${payment.receivingAccountNumber}`
      : undefined,
    payment.receivingAccountName
      ? `ACC. NAME = ${payment.receivingAccountName}`
      : undefined,
    payment.receivingBankLocation,
    payment.receivingCurrencyNote,
  ]
    .filter(Boolean)
    .join(" / ");
}

function parsePaymentDate(value: string) {
  return value ? new Date(`${value}T00:00:00`).getTime() : undefined;
}

function UnavailableState() {
  const navigate = useNavigate();

  return (
    <div className="p-6 md:p-8">
      <Button
        variant="ghost"
        className="mb-4 -ml-2"
        onClick={() => navigate("/invoices")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Invoices
      </Button>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>Invoice not found or unavailable</EmptyTitle>
          <EmptyDescription>
            This invoice may not exist, or you may not have access to view it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

class InvoiceDetailErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <UnavailableState />;
    }

    return this.props.children;
  }
}

function InvoiceDetailContent() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [reconcilingLegacyPayment, setReconcilingLegacyPayment] = useState(false);
  const [cleanupAction, setCleanupAction] = useState<CleanupAction | null>(
    null,
  );
  const [cleanupReason, setCleanupReason] = useState("");
  const [isIssuing, setIsIssuing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() =>
    formatDateInput(Date.now()),
  );
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [paymentReference, setPaymentReference] = useState("");
  const [receivingAccountId, setReceivingAccountId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const invoice = useQuery(
    api.invoices.getById,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  );
  const sourceContract = useQuery(
    api.customerContracts.getByContractNumber,
    invoice?.sourceReference
      ? { contractNumber: invoice.sourceReference }
      : "skip",
  );
  const events = useQuery(
    api.invoices.listEvents,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  );
  const payments = useQuery(
    api.invoices.listPayments,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  );
  const users = useQuery(api.users.listAll, {});
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const receivingAccounts = useQuery(api.receivingAccounts.list, {
    purpose: "incoming",
  });
  const invoiceCompany = useQuery(
    api.companies.getById,
    invoice ? { id: invoice.companyId } : "skip",
  );
  const issueInvoice = useMutation(api.invoices.issueInvoice);
  const recordPayment = useMutation(api.invoices.recordPayment);
  const reconcileLegacyPayment = useMutation(api.invoices.reconcileLegacyPayment);
  const cancelDraftInvoice = useMutation(api.invoices.cancelDraftInvoice);
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  const setInvoiceTestMode = useMutation(api.invoices.setInvoiceTestMode);
  const sendInvoiceEmail = useAction(api.invoices.sendInvoiceEmail);

  if (!invoiceId) {
    return <UnavailableState />;
  }

  if (invoice === null) {
    return <UnavailableState />;
  }

  if (
    !invoice ||
    !events ||
    !payments ||
    !users ||
    !receivingAccounts ||
    !invoiceCompany ||
    currentUser === undefined
  ) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const title = invoice.invoiceNumber ?? "Draft";
  const sendRecipient =
    invoice.billingEmail?.trim() || invoice.contactEmail?.trim();
  const canRecordPayment = PAYABLE_STATUSES.has(invoice.status);
  const isCleanupAdmin =
    currentUser?.role === "ceo" || currentUser?.role === "head_of_business";
  const recordedPaymentTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const legacyPaymentGap = Math.round((invoice.amountPaid - recordedPaymentTotal) * 100) / 100;
  const isTestHidden = Boolean(invoice.isTest || invoice.hiddenAt);
  const usersById = new Map(users.map((user) => [user._id, user]));
  const showRegionBreakdown = invoice.lineItems.some(hasLineItemRegion);
  const regionTotals = showRegionBreakdown
    ? buildRegionTotals(invoice.lineItems)
    : [];

  const handleIssueInvoice = async () => {
    setIsIssuing(true);
    try {
      await issueInvoice({ invoiceId: invoice._id });
      toast.success("Invoice issued and locked");
      setIssueDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not issue invoice";
      toast.error(message);
    } finally {
      setIsIssuing(false);
    }
  };

  const handleSendInvoice = async () => {
    setIsSending(true);
    try {
      await sendInvoiceEmail({ invoiceId: invoice._id });
      toast.success("Invoice sent");
      setSendDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not send invoice";
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const resetPaymentForm = () => {
    setPaymentAmount("");
    setPaymentDate(formatDateInput(Date.now()));
    setPaymentMethod(PAYMENT_METHODS[0]);
    setPaymentReference("");
    setReceivingAccountId("");
    setTransactionId("");
  };

  const handleRecordPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive payment amount");
      return;
    }
    const maximumAmount = reconcilingLegacyPayment ? legacyPaymentGap : invoice.balanceDue;
    if (amount > maximumAmount) {
      toast.error(`Payment cannot exceed ${formatCurrency(maximumAmount)}`);
      return;
    }
    if (!receivingAccountId) {
      toast.error("Select the account that received the payment");
      return;
    }
    if (!transactionId.trim()) {
      toast.error("Enter the bank or provider transaction ID");
      return;
    }

    setIsRecordingPayment(true);
    try {
      const common = {
        invoiceId: invoice._id,
        amount,
        paidAt: parsePaymentDate(paymentDate)!,
        reference: paymentReference.trim() || undefined,
        receivingAccountId: receivingAccountId as Id<"receivingAccounts">,
        transactionId: transactionId.trim(),
      };
      if (reconcilingLegacyPayment) await reconcileLegacyPayment(common);
      else await recordPayment({ ...common, method: paymentMethod });
      toast.success(reconcilingLegacyPayment ? "Historical payment reconciled" : "Payment recorded");
      setPaymentDialogOpen(false);
      setReconcilingLegacyPayment(false);
      resetPaymentForm();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not record payment";
      toast.error(message);
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const closeCleanupDialog = () => {
    if (isCleaningUp) return;
    setCleanupAction(null);
    setCleanupReason("");
  };

  const cleanupDialogTitle =
    cleanupAction === "cancel"
      ? "Cancel draft invoice?"
      : cleanupAction === "void"
        ? "Void invoice?"
        : cleanupAction === "mark_test"
          ? "Mark invoice as test/hidden?"
          : "Unmark invoice as test/hidden?";

  const cleanupConfirmLabel =
    cleanupAction === "cancel"
      ? "Cancel Draft"
      : cleanupAction === "void"
        ? "Void Invoice"
        : cleanupAction === "mark_test"
          ? "Mark as Test"
          : "Unmark Test";

  const handleCleanup = async () => {
    if (!cleanupAction) return;
    const reason = cleanupReason.trim();
    if (!reason) {
      toast.error("Cleanup reason is required");
      return;
    }

    setIsCleaningUp(true);
    try {
      if (cleanupAction === "cancel") {
        await cancelDraftInvoice({ invoiceId: invoice._id, reason });
        toast.success("Draft invoice cancelled");
      } else if (cleanupAction === "void") {
        await voidInvoice({ invoiceId: invoice._id, reason });
        toast.success("Invoice voided");
      } else {
        await setInvoiceTestMode({
          invoiceId: invoice._id,
          isTest: cleanupAction === "mark_test",
          reason,
        });
        toast.success(
          cleanupAction === "mark_test"
            ? "Invoice marked as test/hidden"
            : "Invoice unmarked as test/hidden",
        );
      }
      setCleanupAction(null);
      setCleanupReason("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update invoice";
      toast.error(message);
    } finally {
      setIsCleaningUp(false);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            variant="ghost"
            className="mb-3 -ml-2"
            onClick={() => navigate("/invoices")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {statusBadge(invoice.status)}
            {isTestHidden ? <Badge variant="outline">Test/Hidden</Badge> : null}
          </div>
          <p className="mt-1 text-muted-foreground">
            Read-only invoice snapshot and history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRINTABLE_STATUSES.has(invoice.status) ? (
            <Button
              variant="secondary"
              onClick={() => navigate(`/invoices/${invoice._id}/print`)}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print / Export PDF
            </Button>
          ) : null}
          {invoice.status === "draft" ? (
            <AlertDialog
              open={issueDialogOpen}
              onOpenChange={(open) => {
                if (!isIssuing) setIssueDialogOpen(open);
              }}
            >
              <Button
                className="bg-cyan-600 text-white hover:bg-cyan-700"
                onClick={() => setIssueDialogOpen(true)}
                disabled={isIssuing}
              >
                {isIssuing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <LockKeyhole className="mr-2 h-4 w-4" />
                )}
                {isIssuing ? "Issuing..." : "Issue Invoice"}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Issue and lock this invoice?
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-left">
                      <p>
                        Issuing will lock the invoice and finalize the current
                        snapshot.
                      </p>
                      <ul className="list-disc space-y-1 pl-5">
                        <li>Locked invoices cannot be edited.</li>
                        <li>The invoice will receive an invoice number.</li>
                        <li>This does not send email yet.</li>
                      </ul>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isIssuing}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isIssuing}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleIssueInvoice();
                    }}
                  >
                    {isIssuing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {isIssuing ? "Issuing..." : "Issue Invoice"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {invoice.status === "issued" ? (
            <AlertDialog
              open={sendDialogOpen}
              onOpenChange={(open) => {
                if (!isSending) setSendDialogOpen(open);
              }}
            >
              <Button
                className="bg-cyan-600 text-white hover:bg-cyan-700"
                onClick={() => setSendDialogOpen(true)}
                disabled={isSending}
              >
                {isSending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isSending ? "Sending..." : "Send Invoice"}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Send this invoice?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will email invoice {title} to{" "}
                    {sendRecipient || "the customer email on the invoice"}.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isSending}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isSending}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleSendInvoice();
                    }}
                  >
                    {isSending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {isSending ? "Sending..." : "Send Invoice"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {canRecordPayment ? (
            <Button
              variant="outline"
              onClick={() => setPaymentDialogOpen(true)}
              disabled={isRecordingPayment}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Record Payment
            </Button>
          ) : null}
          {isCleanupAdmin && legacyPaymentGap > 0 ? (
            <Button
              variant="outline"
              onClick={() => {
                setReconcilingLegacyPayment(true);
                setPaymentAmount(String(legacyPaymentGap));
                setPaymentDialogOpen(true);
              }}
              disabled={isRecordingPayment}
            >
              Reconcile Historical Payment
            </Button>
          ) : null}
          {isCleanupAdmin && invoice.status === "draft" ? (
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setCleanupAction("cancel")}
              disabled={isCleaningUp}
            >
              <ShieldAlert className="mr-2 h-4 w-4" />
              Cancel Draft
            </Button>
          ) : null}
          {isCleanupAdmin && VOIDABLE_STATUSES.has(invoice.status) ? (
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setCleanupAction("void")}
              disabled={isCleaningUp}
            >
              <ShieldAlert className="mr-2 h-4 w-4" />
              Void Invoice
            </Button>
          ) : null}
          {isCleanupAdmin ? (
            <Button
              variant="outline"
              onClick={() =>
                setCleanupAction(isTestHidden ? "unmark_test" : "mark_test")
              }
              disabled={isCleaningUp}
            >
              <ShieldAlert className="mr-2 h-4 w-4" />
              {isTestHidden ? "Unmark Test" : "Mark as Test"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Customer Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Customer" value={invoice.companyName} />
            <Detail label="Contact" value={invoice.contactName} />
            <Detail label="Contact Email" value={invoice.contactEmail} />
            <Detail label="Billing Email" value={invoice.billingEmail} />
            <Detail label="Billing Address" value={invoice.billingAddress} />
            <Detail label="Tax ID" value={invoice.taxId} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Created" value={formatDate(invoice.createdAt)} />
            <Detail label="Issue Date" value={formatDate(invoice.issueDate)} />
            <Detail label="Due Date" value={formatDate(invoice.dueDate)} />
            <Detail
              label="Locked At"
              value={formatDateTime(invoice.lockedAt)}
            />
            <Detail label="Sent At" value={formatDateTime(invoice.sentAt)} />
            <Detail
              label="Source Reference"
              value={invoice.sourceReference ?? "-"}
            />
            {sourceContract ? (
              <Button
                className="mt-1 px-0"
                variant="link"
                onClick={() =>
                  navigate(`/finance/customer-contracts/${sourceContract._id}`)
                }
              >
                Open source contract
              </Button>
            ) : null}
            <Detail label="Source Month" value={invoice.sourceMonth} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Item Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium">Item</th>
                  <th className="p-3 text-left font-medium">Category</th>
                  {showRegionBreakdown ? (
                    <th className="p-3 text-left font-medium">Region</th>
                  ) : null}
                  <th className="p-3 text-left font-medium">Unit</th>
                  <th className="p-3 text-right font-medium">Qty</th>
                  <th className="p-3 text-right font-medium">Unit Price</th>
                  <th className="p-3 text-right font-medium">Monthly</th>
                  <th className="p-3 text-right font-medium">Yearly</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, index) => (
                  <tr
                    key={`${item.catalogItemId ?? item.itemName}-${index}`}
                    className="border-b last:border-0"
                  >
                    <td className="p-3 font-medium">{item.itemName}</td>
                    <td className="p-3 text-muted-foreground">
                      {item.serviceCategory}
                    </td>
                    {showRegionBreakdown ? (
                      <td className="p-3 text-muted-foreground">
                        {lineItemRegionLabel(item)}
                      </td>
                    ) : null}
                    <td className="p-3 text-muted-foreground">
                      {item.billingUnit}
                    </td>
                    <td className="p-3 text-right">{item.quantity}</td>
                    <td className="p-3 text-right">
                      {formatCurrency(item.monthlyUnitPrice)}
                    </td>
                    <td className="p-3 text-right">
                      {formatCurrency(item.monthlyTotal)}
                    </td>
                    <td className="p-3 text-right">
                      {formatCurrency(item.yearlyTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {showRegionBreakdown ? (
        <Card>
          <CardHeader>
            <CardTitle>Region Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {regionTotals.map((region) => (
                <div
                  key={region.label}
                  className="rounded-md border bg-muted/20 p-3"
                >
                  <div className="text-sm font-medium">{region.label}</div>
                  <div className="mt-1 text-lg font-semibold">
                    {formatCurrency(region.total)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(invoice.grandTotal)}
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
              {formatCurrency(invoice.amountPaid)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Balance Due
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {formatCurrency(invoice.balanceDue)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payments recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium">Amount</th>
                    <th className="p-3 text-left font-medium">Payment Date</th>
                    <th className="p-3 text-left font-medium">Method</th>
                    <th className="p-3 text-left font-medium">Reference</th>
                    <th className="p-3 text-left font-medium">
                      Receiving Account
                    </th>
                    <th className="p-3 text-left font-medium">Recorded By</th>
                    <th className="p-3 text-left font-medium">Recorded At</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment._id} className="border-b last:border-0">
                      <td className="p-3 font-medium">
                        {formatCurrency(payment.amount)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {formatDate(payment.paidAt)}
                      </td>
                      <td className="p-3">{payment.method ?? "-"}</td>
                      <td className="p-3">{payment.reference ?? "-"}</td>
                      <td className="max-w-xs p-3 text-muted-foreground">
                        {paymentReceivingDetails(payment)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {formatUserDisplayName(
                          usersById.get(payment.recordedBy),
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {formatDateTime(payment.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {invoice.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{invoice.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invoice Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoice events yet.
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event._id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">
                      {eventLabel(event.type)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                  {eventMessage(event) ? (
                    <p className="mt-1 text-muted-foreground">
                      {eventMessage(event)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RecordPaymentDialog
        balanceDue={reconcilingLegacyPayment ? legacyPaymentGap : invoice.balanceDue}
        reconciliation={reconcilingLegacyPayment}
        amount={paymentAmount}
        date={paymentDate}
        method={paymentMethod}
        reference={paymentReference}
        receivingAccountId={receivingAccountId}
        transactionId={transactionId}
        accounts={receivingAccounts.filter(
          (account) => account.countryId === invoiceCompany.countryId,
        )}
        open={paymentDialogOpen}
        pending={isRecordingPayment}
        onAmountChange={setPaymentAmount}
        onDateChange={setPaymentDate}
        onMethodChange={(value) => {
          setPaymentMethod(value);
          setReceivingAccountId("");
        }}
        onReferenceChange={setPaymentReference}
        onReceivingAccountChange={setReceivingAccountId}
        onTransactionIdChange={setTransactionId}
        onOpenChange={(open) => {
          if (isRecordingPayment) return;
          setPaymentDialogOpen(open);
          if (!open) {
            setReconcilingLegacyPayment(false);
            resetPaymentForm();
          }
        }}
        onSubmit={handleRecordPayment}
      />
      <Dialog
        open={cleanupAction !== null}
        onOpenChange={(open) => {
          if (!open) closeCleanupDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{cleanupDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
              This does not delete the invoice. It keeps the invoice snapshot,
              payments, and audit history for review.
            </div>
            <div className="space-y-2">
              <Label htmlFor="cleanup-reason">Reason</Label>
              <Textarea
                id="cleanup-reason"
                value={cleanupReason}
                onChange={(event) => setCleanupReason(event.target.value)}
                placeholder="Explain why this cleanup action is needed"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeCleanupDialog}
              disabled={isCleaningUp}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleCleanup()}
              disabled={isCleaningUp || !cleanupReason.trim()}
            >
              {isCleaningUp ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {isCleaningUp ? "Saving..." : cleanupConfirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordPaymentDialog({
  balanceDue,
  reconciliation,
  amount,
  date,
  method,
  reference,
  receivingAccountId,
  transactionId,
  accounts,
  open,
  pending,
  onAmountChange,
  onDateChange,
  onMethodChange,
  onReferenceChange,
  onReceivingAccountChange,
  onTransactionIdChange,
  onOpenChange,
  onSubmit,
}: {
  balanceDue: number;
  reconciliation?: boolean;
  amount: string;
  date: string;
  method: string;
  reference: string;
  receivingAccountId: string;
  transactionId: string;
  accounts: Doc<"receivingAccounts">[];
  open: boolean;
  pending: boolean;
  onAmountChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onMethodChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onReceivingAccountChange: (value: string) => void;
  onTransactionIdChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const numericAmount = Number(amount);
  const isOverBalance = Number.isFinite(numericAmount)
    ? numericAmount > balanceDue
    : false;
  const accountType = method === "Bank Transfer" ? "bank" : "mobile_money";
  const eligibleAccounts = accounts.filter(
    (account) => account.type === accountType,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{reconciliation ? "Reconcile Historical Payment" : "Record Payment"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="text-muted-foreground">{reconciliation ? "Unrecorded paid amount" : "Current balance due"}</div>
            <div className="mt-1 text-xl font-bold">
              {formatCurrency(balanceDue)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
              placeholder="0.00"
            />
            {isOverBalance ? (
              <p className="text-xs text-destructive">
                Payment cannot exceed the balance due.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-date">Payment date</Label>
            <Input
              id="payment-date"
              type="date"
              value={date}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </div>

          <div className="space-y-2 pb-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={onMethodChange}>
              <SelectTrigger aria-label="Payment method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start">
                {PAYMENT_METHODS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Paid into account</Label>
            <Select
              value={receivingAccountId}
              onValueChange={onReceivingAccountChange}
            >
              <SelectTrigger aria-label="Paid into account" className="w-full">
                <SelectValue placeholder="Select receiving account" />
              </SelectTrigger>
              <SelectContent>
                {eligibleAccounts.map((account) => (
                  <SelectItem key={account._id} value={account._id}>
                    {account.name} · {account.accountNumber} ({account.currency}
                    )
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleAccounts.length === 0 ? (
              <p className="text-xs text-destructive">
                Configure an active{" "}
                {accountType === "bank" ? "bank" : "mobile money"} account in
                Collections first.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-transaction-id">Transaction ID</Label>
            <Input
              id="payment-transaction-id"
              value={transactionId}
              onChange={(event) => onTransactionIdChange(event.target.value)}
              placeholder="Bank or provider transaction ID"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-reference">Internal note (optional)</Label>
            <Input
              id="payment-reference"
              value={reference}
              onChange={(event) => onReferenceChange(event.target.value)}
              placeholder="Optional payment note"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-cyan-600 text-white hover:bg-cyan-700"
              disabled={
                pending ||
                isOverBalance ||
                !receivingAccountId ||
                !transactionId.trim()
              }
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {pending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-medium">{value || "-"}</div>
    </div>
  );
}

export default function InvoiceDetailPage() {
  return (
    <InvoiceDetailErrorBoundary>
      <InvoiceDetailContent />
    </InvoiceDetailErrorBoundary>
  );
}
