import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  FileText,
  Loader2,
  Percent,
  Printer,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format.ts";
import { useCrm } from "@/lib/crm-context.tsx";

type Quote = Doc<"quotes">;
type DiscountApprovalStatus = NonNullable<Quote["discountApprovalStatus"]>;
type DiscountApprovalLevel = NonNullable<Quote["discountApprovalLevel"]>;

function statusBadge(status: string) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "sent":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Sent
        </Badge>
      );
    case "accepted":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          Accepted
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function discountLimitForRole(role: Doc<"users">["role"]) {
  switch (role) {
    case "ceo":
      return 50;
    case "head_of_business":
      return 25;
    case "country_gm":
      return 15;
    case "account_manager":
      return 10;
    default:
      return 5;
  }
}

function discountLevelLabel(level?: DiscountApprovalLevel) {
  switch (level) {
    case "account_manager":
      return "Account Manager";
    case "country_gm":
      return "Country Manager";
    case "head_of_business":
      return "HOB";
    case "ceo":
      return "CEO";
    default:
      return "Team";
  }
}

function discountStatusForQuote(quote: Quote): DiscountApprovalStatus {
  if ((quote.discountPercent ?? 0) <= 0) return "not_required";
  return quote.discountApprovalStatus ?? "approved";
}

export default function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
  const [isResolvingDiscount, setIsResolvingDiscount] = useState(false);
  const { currentUser } = useCrm();
  const quote = useQuery(
    api.quotes.getById,
    id ? { id: id as Id<"quotes"> } : "skip",
  );
  const companies = useQuery(api.companies.list, {});
  const updateStatus = useMutation(api.quotes.updateStatus);
  const updateDiscount = useMutation(api.quotes.updateDiscount);
  const approveDiscount = useMutation(api.quotes.approveDiscount);
  const rejectDiscount = useMutation(api.quotes.rejectDiscount);
  const removeQuote = useMutation(api.quotes.remove);
  const createDraftInvoice = useMutation(api.invoices.createDraftFromQuote);

  const returnToQuotes = () => {
    navigate("/quotes");
  };

  if (!id) {
    return (
      <div className="p-6 md:p-8">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Quote ID is missing.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!quote || !companies) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const companyName =
    companies.find((company) => company._id === quote.companyId)?.name ??
    "Unknown";
  const monthlySubtotal =
    quote.monthlySubtotal ??
    quote.lineItems.reduce((sum, lineItem) => sum + lineItem.monthlyTotal, 0);
  const yearlySubtotal =
    quote.yearlySubtotal ??
    quote.lineItems.reduce((sum, lineItem) => sum + lineItem.yearlyTotal, 0);
  const discountPercent = quote.discountPercent ?? 0;
  const monthlyDiscountTotal =
    quote.monthlyDiscountTotal ?? monthlySubtotal - quote.monthlyGrandTotal;
  const yearlyDiscountTotal =
    quote.yearlyDiscountTotal ?? yearlySubtotal - quote.yearlyGrandTotal;
  const discountApprovalStatus = discountStatusForQuote(quote);
  const discountApprovalLevel = quote.discountApprovalLevel;
  const discountBlocksProgress =
    discountPercent > 0 &&
    (discountApprovalStatus === "pending" ||
      discountApprovalStatus === "rejected");
  const canCurrentUserApproveDiscount =
    discountApprovalStatus === "pending" &&
    !!currentUser &&
    discountLimitForRole(currentUser.role) >= discountPercent;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Please allow popups to print");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Quote - ${companyName} - ${quote.date}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #1a1a1a; }
          .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
          .header h1 { font-size: 24px; margin: 0; }
          .header p { color: #666; margin: 4px 0 0; }
          .meta { display: flex; gap: 32px; margin-bottom: 24px; }
          .meta-item { }
          .meta-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
          .meta-value { font-size: 14px; font-weight: 600; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
          th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #e5e5e5; font-size: 12px; text-transform: uppercase; color: #666; }
          td { padding: 8px 12px; border-bottom: 1px solid #e5e5e5; font-size: 13px; }
          .text-right { text-align: right; }
          .totals { background: #f9f9f9; font-weight: bold; }
          .totals td { border-top: 2px solid #1a1a1a; border-bottom: none; padding: 12px; }
          .notes { margin-top: 24px; padding: 16px; background: #f9f9f9; border-radius: 4px; }
          .notes h4 { margin: 0 0 8px; font-size: 13px; }
          .notes p { margin: 0; font-size: 13px; color: #444; }
          .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; color: #999; font-size: 11px; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>HTGCLOUDS</h1>
          <p>Service Quote</p>
        </div>
        <div class="meta">
          <div class="meta-item">
            <div class="meta-label">Company</div>
            <div class="meta-value">${companyName}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Date</div>
            <div class="meta-value">${quote.date}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Status</div>
            <div class="meta-value">${quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Unit</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Unit Price</th>
              <th class="text-right">Monthly</th>
              <th class="text-right">Yearly</th>
            </tr>
          </thead>
          <tbody>
            ${quote.lineItems
              .map(
                (li) => `
              <tr>
                <td>${li.itemName}</td>
                <td>${li.serviceCategory}</td>
                <td>${li.billingUnit}</td>
                <td class="text-right">${li.quantity}</td>
                <td class="text-right">${formatCurrency(li.monthlyUnitPrice)}</td>
                <td class="text-right">${formatCurrency(li.monthlyTotal)}</td>
                <td class="text-right">${formatCurrency(li.yearlyTotal)}</td>
              </tr>
            `,
              )
              .join("")}
            <tr class="totals">
              <td colspan="5" class="text-right">Subtotal</td>
              <td class="text-right">${formatCurrency(monthlySubtotal)}</td>
              <td class="text-right">${formatCurrency(yearlySubtotal)}</td>
            </tr>
            ${
              discountPercent > 0
                ? `<tr class="totals">
              <td colspan="5" class="text-right">Discount (${discountPercent}%)</td>
              <td class="text-right">-${formatCurrency(monthlyDiscountTotal)}</td>
              <td class="text-right">-${formatCurrency(yearlyDiscountTotal)}</td>
            </tr>`
                : ""
            }
            <tr class="totals">
              <td colspan="5" class="text-right">Grand Total</td>
              <td class="text-right">${formatCurrency(quote.monthlyGrandTotal)}</td>
              <td class="text-right">${formatCurrency(quote.yearlyGrandTotal)}</td>
            </tr>
          </tbody>
        </table>
        ${quote.notes ? `<div class="notes"><h4>Notes</h4><p>${quote.notes}</p></div>` : ""}
        <div class="footer">Generated by HTGCLOUDS CRM - ${new Date().toLocaleDateString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleStatusChange = async (status: "draft" | "sent" | "accepted") => {
    try {
      await updateStatus({ id: quote._id, status });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update quote";
      toast.error(message);
    }
  };

  const openDiscountDialog = () => {
    setDiscountInput(discountPercent > 0 ? String(discountPercent) : "");
    setDiscountDialogOpen(true);
  };

  const handleApplyDiscount = async () => {
    const parsedDiscount = Number.parseFloat(discountInput || "0");
    if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0) {
      toast.error("Enter a discount from 0 to 100");
      return;
    }
    if (parsedDiscount > 100) {
      toast.error("Discount cannot be more than 100%");
      return;
    }

    setIsSavingDiscount(true);
    try {
      const result = await updateDiscount({
        id: quote._id,
        discountPercent: parsedDiscount,
      });
      if (parsedDiscount <= 0) {
        toast.success("Discount removed");
      } else if (result.discountApprovalStatus === "pending") {
        toast.success(
          `Discount saved and sent for ${discountLevelLabel(result.discountApprovalLevel)} approval`,
        );
      } else {
        toast.success("Discount approved and applied");
      }
      setDiscountDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update discount";
      toast.error(message);
    } finally {
      setIsSavingDiscount(false);
    }
  };

  const handleDelete = async () => {
    await removeQuote({ id: quote._id });
    returnToQuotes();
  };

  const handleCreateInvoice = async () => {
    setIsCreatingInvoice(true);
    try {
      await createDraftInvoice({ quoteId: quote._id });
      toast.success("Draft invoice created");
      navigate("/invoices");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not create draft invoice";
      toast.error(message);
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  const handleApproveDiscount = async () => {
    setIsResolvingDiscount(true);
    try {
      await approveDiscount({ id: quote._id });
      toast.success("Discount approved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not approve discount";
      toast.error(message);
    } finally {
      setIsResolvingDiscount(false);
    }
  };

  const handleRejectDiscount = async () => {
    setIsResolvingDiscount(true);
    try {
      await rejectDiscount({ id: quote._id });
      toast.success("Discount rejected");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reject discount";
      toast.error(message);
    } finally {
      setIsResolvingDiscount(false);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button
            variant="ghost"
            className="mb-3 -ml-2"
            onClick={returnToQuotes}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Quotes
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Quote - {companyName}
            </h1>
            {statusBadge(quote.status)}
          </div>
          <p className="text-muted-foreground mt-1">
            Review quote details and update its status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Print / Export
          </Button>
          {quote.status === "draft" && (
            <Button variant="secondary" onClick={openDiscountDialog}>
              <Percent className="h-4 w-4 mr-2" /> Discount
            </Button>
          )}
          {quote.status === "draft" && (
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => handleStatusChange("sent")}
              disabled={discountBlocksProgress}
            >
              <Send className="h-4 w-4 mr-2" /> Mark as Sent
            </Button>
          )}
          {quote.status === "sent" && (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => handleStatusChange("accepted")}
            >
              <CheckCircle className="h-4 w-4 mr-2" /> Mark as Accepted
            </Button>
          )}
          {quote.status === "accepted" && (
            <Button
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
              onClick={handleCreateInvoice}
              disabled={isCreatingInvoice || discountBlocksProgress}
            >
              {isCreatingInvoice ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              {isCreatingInvoice ? "Creating..." : "Create Invoice"}
            </Button>
          )}
          {quote.status !== "draft" && (
            <Button
              variant="secondary"
              onClick={() => handleStatusChange("draft")}
            >
              Revert to Draft
            </Button>
          )}
          {quote.status === "draft" && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </Button>
          )}
        </div>
      </div>

      {discountPercent > 0 && (
        <Card
          className={
            discountApprovalStatus === "pending"
              ? "border-amber-200 bg-amber-50"
              : discountApprovalStatus === "rejected"
                ? "border-red-200 bg-red-50"
                : "border-emerald-200 bg-emerald-50"
          }
        >
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {discountApprovalStatus === "rejected" ? (
                <XCircle className="mt-0.5 h-5 w-5 text-red-600" />
              ) : discountApprovalStatus === "pending" ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              ) : (
                <CheckCircle className="mt-0.5 h-5 w-5 text-emerald-600" />
              )}
              <div>
                <div className="font-semibold">
                  {discountApprovalStatus === "pending"
                    ? "Discount approval pending"
                    : discountApprovalStatus === "rejected"
                      ? "Discount approval rejected"
                      : "Discount approved"}
                </div>
                <p className="text-sm text-muted-foreground">
                  {discountApprovalStatus === "not_required"
                    ? `${discountPercent}% discount does not require higher approval.`
                    : discountApprovalStatus === "approved"
                      ? `${discountPercent}% discount has the required approval.`
                      : `${discountPercent}% discount requires ${discountLevelLabel(discountApprovalLevel)} approval. This quote cannot be sent or invoiced while approval is pending or rejected.`}
                </p>
              </div>
            </div>
            {canCurrentUserApproveDiscount && (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={handleRejectDiscount}
                  disabled={isResolvingDiscount}
                >
                  Reject
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleApproveDiscount}
                  disabled={isResolvingDiscount}
                >
                  Approve
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div ref={printRef} className="space-y-4">
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Date:</span>{" "}
                <span className="font-medium">{quote.date}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Line items:</span>{" "}
                <span className="font-medium">{quote.lineItems.length}</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Item</th>
                    <th className="text-left p-3 font-medium">Category</th>
                    <th className="text-left p-3 font-medium">Unit</th>
                    <th className="text-right p-3 font-medium">Qty</th>
                    <th className="text-right p-3 font-medium">Rate</th>
                    <th className="text-right p-3 font-medium">Monthly</th>
                    <th className="text-right p-3 font-medium">Yearly</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lineItems.map((li, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="p-3 font-medium">{li.itemName}</td>
                      <td className="p-3 text-muted-foreground">
                        {li.serviceCategory}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {li.billingUnit}
                      </td>
                      <td className="p-3 text-right">{li.quantity}</td>
                      <td className="p-3 text-right">
                        {formatCurrency(li.monthlyUnitPrice)}
                      </td>
                      <td className="p-3 text-right">
                        {formatCurrency(li.monthlyTotal)}
                      </td>
                      <td className="p-3 text-right">
                        {formatCurrency(li.yearlyTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20">
                  <tr>
                    <td colSpan={5} className="p-3 font-semibold text-right">
                      Subtotal
                    </td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(monthlySubtotal)}
                    </td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(yearlySubtotal)}
                    </td>
                  </tr>
                  {discountPercent > 0 && (
                    <tr>
                      <td colSpan={5} className="p-3 font-semibold text-right">
                        Discount ({discountPercent}%)
                      </td>
                      <td className="p-3 text-right font-bold text-emerald-700">
                        -{formatCurrency(monthlyDiscountTotal)}
                      </td>
                      <td className="p-3 text-right font-bold text-emerald-700">
                        -{formatCurrency(yearlyDiscountTotal)}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={5} className="p-3 font-semibold text-right">
                      Grand Total
                    </td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(quote.monthlyGrandTotal)}
                    </td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(quote.yearlyGrandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {quote.notes && (
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">{quote.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={discountDialogOpen}
        onOpenChange={(open) => {
          if (!isSavingDiscount) setDiscountDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Apply Quote Discount</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-muted-foreground">Current subtotal</div>
              <div className="font-semibold">{formatCurrency(monthlySubtotal)} / month</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quote-detail-discount">Discount percent</Label>
              <Input
                id="quote-detail-discount"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={discountInput}
                onChange={(event) => setDiscountInput(event.target.value)}
                placeholder="Example: 10 or 15"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This applies only to this draft quote. It does not change catalog
              prices, usage, or other invoices.
            </p>
            <p className="text-xs text-muted-foreground">
              Approval rules: team up to 5%, Account Manager up to 10%, Country
              Manager up to 15%, HOB up to 25%, CEO up to 50%.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDiscountDialogOpen(false)}
              disabled={isSavingDiscount}
            >
              Cancel
            </Button>
            <Button onClick={handleApplyDiscount} disabled={isSavingDiscount}>
              {isSavingDiscount ? "Saving..." : "Apply Discount"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
