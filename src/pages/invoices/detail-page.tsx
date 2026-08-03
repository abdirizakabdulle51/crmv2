import { Component, type ReactNode, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  FileText,
  Loader2,
  LockKeyhole,
  Printer,
  Send,
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCurrency } from "@/lib/format.ts";

type Invoice = Doc<"invoices">;
type InvoiceEvent = Doc<"invoiceEvents">;
type InvoiceStatus = Invoice["status"];

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

function formatDate(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
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
    case "voided":
      return "Voided";
    case "sent":
      return "Sent";
    case "payment_recorded":
      return "Payment recorded";
    default:
      return type;
  }
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
  const [isIssuing, setIsIssuing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const invoice = useQuery(
    api.invoices.getById,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  );
  const events = useQuery(
    api.invoices.listEvents,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  );
  const issueInvoice = useMutation(api.invoices.issueInvoice);
  const sendInvoiceEmail = useAction(api.invoices.sendInvoiceEmail);

  if (!invoiceId) {
    return <UnavailableState />;
  }

  if (invoice === null) {
    return <UnavailableState />;
  }

  if (!invoice || !events) {
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
              label="Source Quote"
              value={
                invoice.sourceQuoteId ? String(invoice.sourceQuoteId) : "-"
              }
            />
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
                    key={`${item.catalogItemId}-${index}`}
                    className="border-b last:border-0"
                  >
                    <td className="p-3 font-medium">{item.itemName}</td>
                    <td className="p-3 text-muted-foreground">
                      {item.serviceCategory}
                    </td>
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
                  {event.message ? (
                    <p className="mt-1 text-muted-foreground">
                      {event.message}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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
