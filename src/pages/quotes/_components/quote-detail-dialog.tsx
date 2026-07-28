import { useRef } from "react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { toast } from "sonner";
import { Printer, Trash2, Send, CheckCircle } from "lucide-react";
import { formatCurrency } from "../_lib/format.ts";

type Quote = Doc<"quotes">;

type QuoteDetailDialogProps = {
  quote: Quote;
  companyName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStatusChange: (status: "draft" | "sent" | "accepted") => Promise<void>;
  onDelete: () => Promise<void>;
};

export default function QuoteDetailDialog({
  quote,
  companyName,
  open,
  onOpenChange,
  onStatusChange,
  onDelete,
}: QuoteDetailDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

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
              <td colspan="5" class="text-right">Grand Total</td>
              <td class="text-right">${formatCurrency(quote.monthlyGrandTotal)}</td>
              <td class="text-right">${formatCurrency(quote.yearlyGrandTotal)}</td>
            </tr>
          </tbody>
        </table>
        ${quote.notes ? `<div class="notes"><h4>Notes</h4><p>${quote.notes}</p></div>` : ""}
        <div class="footer">Generated by HTGCLOUDS CRM · ${new Date().toLocaleDateString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const statusBadge = (status: string) => {
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
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Quote — {companyName}
            {statusBadge(quote.status)}
          </DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="space-y-4">
          {/* Meta */}
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Date:</span>{" "}
              <span className="font-medium">{quote.date}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Line items:</span>{" "}
              <span className="font-medium">{quote.lineItems.length}</span>
            </div>
          </div>

          {/* Line items table */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-2 font-medium">Item</th>
                  <th className="text-left p-2 font-medium">Category</th>
                  <th className="text-left p-2 font-medium">Unit</th>
                  <th className="text-right p-2 font-medium">Qty</th>
                  <th className="text-right p-2 font-medium">Rate</th>
                  <th className="text-right p-2 font-medium">Monthly</th>
                  <th className="text-right p-2 font-medium">Yearly</th>
                </tr>
              </thead>
              <tbody>
                {quote.lineItems.map((li, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="p-2 font-medium">{li.itemName}</td>
                    <td className="p-2 text-muted-foreground">
                      {li.serviceCategory}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {li.billingUnit}
                    </td>
                    <td className="p-2 text-right">{li.quantity}</td>
                    <td className="p-2 text-right">
                      {formatCurrency(li.monthlyUnitPrice)}
                    </td>
                    <td className="p-2 text-right">
                      {formatCurrency(li.monthlyTotal)}
                    </td>
                    <td className="p-2 text-right">
                      {formatCurrency(li.yearlyTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/20">
                <tr>
                  <td colSpan={5} className="p-2 font-semibold text-right">
                    Grand Total
                  </td>
                  <td className="p-2 text-right font-bold">
                    {formatCurrency(quote.monthlyGrandTotal)}
                  </td>
                  <td className="p-2 text-right font-bold">
                    {formatCurrency(quote.yearlyGrandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Notes */}
          {quote.notes && (
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-sm text-muted-foreground">{quote.notes}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePrint}
            className="cursor-pointer"
          >
            <Printer className="h-4 w-4 mr-1" /> Print / Export
          </Button>

          {quote.status === "draft" && (
            <Button
              size="sm"
              className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => onStatusChange("sent")}
            >
              <Send className="h-4 w-4 mr-1" /> Mark as Sent
            </Button>
          )}
          {quote.status === "sent" && (
            <Button
              size="sm"
              className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => onStatusChange("accepted")}
            >
              <CheckCircle className="h-4 w-4 mr-1" /> Mark as Accepted
            </Button>
          )}
          {quote.status !== "draft" && (
            <Button
              variant="secondary"
              size="sm"
              className="cursor-pointer"
              onClick={() => onStatusChange("draft")}
            >
              Revert to Draft
            </Button>
          )}
          {quote.status === "draft" && (
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
