import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCurrency } from "@/lib/format.ts";
import {
  ArrowLeft,
  CheckCircle,
  Printer,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type CombinedQuote = Doc<"combinedQuotes">;
type CombinedQuoteStatus = CombinedQuote["status"];

function statusBadge(status: CombinedQuoteStatus) {
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
  }
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatQuantity(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function printCombinedQuote(quote: CombinedQuote) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Please allow popups to print");
    return;
  }

  const rows = quote.lineItems
    .map(
      (line) => `
        <tr>
          <td>${line.product}</td>
          <td class="right">${formatQuantity(line.quantity)}</td>
          <td class="right">${formatCurrency(line.unitPrice)}</td>
          <td class="right">${line.taxRate ? `${line.taxRate}%` : ""}</td>
          <td class="right">${line.discountPercent.toFixed(2)}</td>
          <td class="right">${formatCurrency(line.amount)}</td>
        </tr>
      `,
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${quote.quoteNumber ?? "Combined Quote"} - ${quote.parentCompanyName}</title>
        <style>
          @page { size: A4; margin: 16mm; }
          body {
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
            margin: 0;
          }
          .header {
            align-items: flex-start;
            border-bottom: 2px solid #111827;
            display: flex;
            justify-content: space-between;
            padding-bottom: 18px;
          }
          .brand {
            color: #07999d;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 0;
          }
          .title {
            font-size: 28px;
            font-weight: 700;
            margin: 30px 0 20px;
          }
          .meta {
            display: grid;
            gap: 18px;
            grid-template-columns: 1.5fr 1fr 1fr;
            margin-bottom: 26px;
          }
          .label {
            color: #6b7280;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: .04em;
            text-transform: uppercase;
          }
          .value {
            font-size: 15px;
            font-weight: 700;
            margin-top: 4px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th {
            border-bottom: 1px solid #111827;
            color: #374151;
            font-size: 12px;
            padding: 10px 8px;
            text-align: left;
          }
          td {
            border-bottom: 1px solid #e5e7eb;
            padding: 11px 8px;
          }
          .right { text-align: right; }
          .totals {
            margin-left: auto;
            margin-top: 28px;
            width: 280px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            padding: 7px 0;
          }
          .grand {
            border-top: 2px solid #111827;
            color: #07999d;
            font-size: 18px;
            font-weight: 700;
            margin-top: 8px;
            padding-top: 12px;
          }
          .notes {
            border-top: 1px solid #e5e7eb;
            color: #4b5563;
            margin-top: 32px;
            padding-top: 16px;
            white-space: pre-wrap;
          }
          .footer {
            border-top: 1px solid #111827;
            color: #6b7280;
            display: flex;
            font-size: 12px;
            justify-content: space-between;
            margin-top: 50px;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">HTGCLOUDS</div>
            <div>One System. Every Team. Total Control.</div>
          </div>
          <div>
            <div class="label">Combined Quote</div>
            <div class="value">${quote.quoteNumber ?? "Draft"}</div>
          </div>
        </div>

        <div class="title">${quote.status === "draft" ? "Draft Combined Quote" : "Combined Quote"}</div>

        <div class="meta">
          <div>
            <div class="label">Parent / Main Company</div>
            <div class="value">${quote.parentCompanyName}</div>
          </div>
          <div>
            <div class="label">Date</div>
            <div class="value">${formatDate(quote.date)}</div>
          </div>
          <div>
            <div class="label">Expiration</div>
            <div class="value">${formatDate(quote.expirationDate)}</div>
          </div>
          <div>
            <div class="label">Usage Month</div>
            <div class="value">${quote.sourceMonth ?? "-"}</div>
          </div>
          <div>
            <div class="label">Payment Terms</div>
            <div class="value">${quote.paymentTerms ?? "-"}</div>
          </div>
          <div>
            <div class="label">Status</div>
            <div class="value">${quote.status.toUpperCase()}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th class="right">Quantity</th>
              <th class="right">Unit Price</th>
              <th class="right">Taxes</th>
              <th class="right">Disc.%</th>
              <th class="right">Amount</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="totals">
          <div class="total-row"><span>Subtotal</span><span>${formatCurrency(quote.subtotal)}</span></div>
          <div class="total-row"><span>Discount</span><span>${formatCurrency(quote.discountTotal)}</span></div>
          <div class="total-row"><span>Taxes</span><span>${formatCurrency(quote.taxTotal)}</span></div>
          <div class="total-row grand"><span>Total</span><span>${formatCurrency(quote.grandTotal)}</span></div>
        </div>

        ${quote.notes ? `<div class="notes">${quote.notes}</div>` : ""}
        <div class="footer">
          <span>Generated by HTGCLOUDS CRM</span>
          <span>This document does not create or replace CRM invoices.</span>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export default function CombinedQuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const quote = useQuery(
    api.combinedQuotes.getById,
    id ? { id: id as Id<"combinedQuotes"> } : "skip",
  );
  const updateStatus = useMutation(api.combinedQuotes.updateStatus);
  const remove = useMutation(api.combinedQuotes.remove);

  if (!id) {
    return (
      <div className="p-6 md:p-8">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Combined quote ID is missing.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const handleStatus = async (status: CombinedQuoteStatus) => {
    await updateStatus({ id: quote._id, status });
  };

  const handleDelete = async () => {
    await remove({ id: quote._id });
    toast.success("Combined quote deleted");
    navigate("/quotes");
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button
            variant="ghost"
            className="-ml-2 mb-3"
            onClick={() => navigate("/quotes")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Quotes
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {quote.quoteNumber ?? "Combined Quote"}
            </h1>
            {statusBadge(quote.status)}
          </div>
          <p className="mt-1 text-muted-foreground">
            Parent-office yearly document. It does not create CRM invoices.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => printCombinedQuote(quote)}>
            <Printer className="mr-2 h-4 w-4" />
            Print / Export PDF
          </Button>
          {quote.status === "draft" ? (
            <Button
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => handleStatus("sent")}
            >
              <Send className="mr-2 h-4 w-4" />
              Mark as Sent
            </Button>
          ) : null}
          {quote.status === "sent" ? (
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => handleStatus("accepted")}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Mark as Accepted
            </Button>
          ) : null}
          {quote.status !== "draft" ? (
            <Button variant="outline" onClick={() => handleStatus("draft")}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Revert to Draft
            </Button>
          ) : null}
          {quote.status === "draft" ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Parent / Main Company</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{quote.parentCompanyName}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Usage month: {quote.sourceMonth ?? "-"}
            </div>
          </CardContent>
        </Card>
        <SummaryCard label="Expiration" value={formatDate(quote.expirationDate)} />
        <SummaryCard label="Grand Total" value={formatCurrency(quote.grandTotal)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium">Product</th>
                  <th className="p-3 text-right font-medium">Quantity</th>
                  <th className="p-3 text-right font-medium">Unit Price</th>
                  <th className="p-3 text-right font-medium">Taxes</th>
                  <th className="p-3 text-right font-medium">Disc.%</th>
                  <th className="p-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {quote.lineItems.map((line, index) => (
                  <tr key={`${line.product}-${index}`} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{line.product}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {line.sourceCompanyName ?? "Manual line"}
                      </div>
                    </td>
                    <td className="p-3 text-right">{formatQuantity(line.quantity)}</td>
                    <td className="p-3 text-right">{formatCurrency(line.unitPrice)}</td>
                    <td className="p-3 text-right">
                      {line.taxRate ? `${line.taxRate}%` : "-"}
                    </td>
                    <td className="p-3 text-right">
                      {line.discountPercent.toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/20">
                <tr>
                  <td colSpan={5} className="p-3 text-right font-semibold">
                    Total
                  </td>
                  <td className="p-3 text-right text-base font-bold">
                    {formatCurrency(quote.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {quote.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {quote.notes}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
