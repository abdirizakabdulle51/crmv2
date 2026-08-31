import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  ArrowLeft,
  CheckCircle,
  FileText,
  Printer,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format.ts";

type Quote = Doc<"quotes">;

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

export default function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const quote = useQuery(
    api.quotes.getById,
    id ? { id: id as Id<"quotes"> } : "skip",
  );
  const companies = useQuery(api.companies.list, {});
  const updateStatus = useMutation(api.quotes.updateStatus);
  const removeQuote = useMutation(api.quotes.remove);

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
        <div class="footer">Generated by HTGCLOUDS CRM - ${new Date().toLocaleDateString()}</div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const handleStatusChange = async (status: "draft" | "sent" | "accepted") => {
    await updateStatus({ id: quote._id, status });
  };

  const handleDelete = async () => {
    await removeQuote({ id: quote._id });
    returnToQuotes();
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
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => handleStatusChange("sent")}
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
          {quote.status === "accepted" &&
            quote.commercialModel === "contracted" && (
              <Button
                className="bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={() =>
                  navigate(
                    `/finance/customer-contracts/new?quoteId=${quote._id}`,
                  )
                }
              >
                <FileText className="h-4 w-4 mr-2" /> Prepare Contract
              </Button>
            )}
          {quote.status === "accepted" &&
          quote.commercialModel !== "contracted" ? (
            <Button onClick={() => navigate("/pipeline")}>
              <CheckCircle className="h-4 w-4 mr-2" /> Continue to Won
              Onboarding
            </Button>
          ) : null}
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
    </div>
  );
}
