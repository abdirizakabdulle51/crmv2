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

const FALLBACK_SELLER = {
  legalName: "HTG CLOUDS LIMITED",
  addressLines: [
    "Airport road, Next to Ali Jimale Masque",
    "Wadajir District",
    "mogadishu BN 00000",
    "Somalia",
  ],
  email: "finance@htgclouds.com",
  website: "https://htgclouds.com",
  slogan: "Built for us, Ready for the World.",
  bankName: "Salaam Somali Bank",
  bankAccountNumber: "33111777",
  bankAccountName: "HTG CLOUDS LIMITED",
  bankLocation: "MOGADISHU - SOMALIA",
  currencyNote: "All fees are listed in USD",
  paymentInstructions:
    "PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI BANK ACCOUNT.",
};

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

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function formatFooterLocation(value?: string) {
  const parts = value
    ?.split(/\s+-\s+|,/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts || parts.length === 0) return undefined;
  return parts.map(toTitleCase).join(", ");
}

function printCombinedQuote(quote: CombinedQuote) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Please allow popups to print");
    return;
  }

  const seller = FALLBACK_SELLER;
  const footerText = [
    seller.legalName,
    formatFooterLocation(seller.bankLocation),
    seller.email,
    seller.website,
  ]
    .filter(Boolean)
    .join(" | ");
  const printableNumber = quote.quoteNumber ?? "Draft";
  const title =
    quote.status === "draft"
      ? `Draft Combined Quote ${printableNumber}`
      : `Combined Quote ${printableNumber}`;
  const rows = quote.lineItems
    .map(
      (line) => `
        <tr>
          <td>
            <div class="line-title">${escapeHtml(line.product)}</div>
            ${
              line.sourceCompanyName
                ? `<div class="line-subtitle">${escapeHtml(line.sourceCompanyName)}</div>`
                : ""
            }
          </td>
          <td>${formatQuantity(line.quantity)}</td>
          <td>${formatCurrency(line.unitPrice)}</td>
          <td>${line.taxRate ? `${line.taxRate}%` : "-"}</td>
          <td>${line.discountPercent.toFixed(2)}</td>
          <td>${formatCurrency(line.amount)}</td>
        </tr>
      `,
    )
    .join("");

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(printableNumber)} - ${escapeHtml(quote.parentCompanyName)}</title>
        <style>
          @page { size: A4; margin: 0; }
          html,
          body {
            background: #f8fafc;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
            margin: 0;
          }
          * { box-sizing: border-box; }
          .page {
            background: #fff;
            display: flex;
            flex-direction: column;
            min-height: 297mm;
            margin: 0 auto 20px;
            padding: 16mm 14mm 18mm;
            width: 210mm;
          }
          .header {
            align-items: flex-start;
            display: flex;
            justify-content: space-between;
            min-height: 44mm;
          }
          .logo {
            display: block;
            height: 34px;
            margin-bottom: 12px;
            object-fit: contain;
            object-position: left center;
            width: 114px;
          }
          address {
            display: flex;
            flex-direction: column;
            font-style: normal;
            font-size: 14px;
            line-height: 1.5;
          }
          .slogan {
            color: #07999d;
            font-size: 13px;
            font-weight: 700;
            padding-top: 10px;
          }
          .title-row {
            align-items: flex-start;
            display: grid;
            gap: 16mm;
            grid-template-columns: minmax(0, 1fr) 74mm;
            margin-bottom: 6mm;
          }
          h1 {
            color: #07999d;
            font-size: 26px;
            font-weight: 500;
            letter-spacing: 0;
            margin: 0;
          }
          .bill-to {
            font-size: 13px;
            line-height: 1.45;
            padding-top: 1mm;
          }
          .bill-to-label,
          .meta dt {
            color: #37aeb2;
            font-size: 12px;
            font-weight: 700;
            margin-bottom: 4px;
            text-transform: uppercase;
          }
          .bill-to-label {
            font-size: 11px;
            letter-spacing: 0.08em;
          }
          .bill-to-name {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 2px;
          }
          .meta {
            display: grid;
            gap: 18px;
            grid-template-columns: repeat(4, 1fr);
            margin: 0 0 9mm;
          }
          .meta dd {
            font-size: 13px;
            margin: 0;
          }
          table {
            border-collapse: collapse;
            font-size: 13px;
            width: 100%;
          }
          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          th {
            border-bottom: 1px solid #111827;
            font-size: 13px;
            font-weight: 500;
            padding: 0 0 7px;
            text-align: left;
          }
          th:nth-child(n+2),
          td:nth-child(n+2) {
            text-align: right;
          }
          td {
            padding: 10px 0 6px;
            vertical-align: top;
          }
          .line-title {
            font-weight: 500;
            margin-bottom: 2px;
          }
          .line-subtitle {
            color: #111827;
          }
          .totals {
            margin-left: auto;
            margin-top: 14mm;
            max-width: 82mm;
            width: 100%;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
          }
          .grand {
            border-top: 1px solid #111827;
            color: #07999d;
            font-size: 14px;
            font-weight: 700;
            padding-top: 9px;
          }
          .payment-note {
            border-top: 1px solid #d1d5db;
            font-size: 13px;
            line-height: 1.45;
            margin-top: 16mm;
            padding-top: 5mm;
            width: 128mm;
          }
          .payment-note p {
            margin: 0 0 6px;
          }
          .amount-due {
            color: #6b7280;
            font-size: 14px;
            margin-top: 7mm;
          }
          .payment-instruction {
            color: #6b7280;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.01em;
            text-transform: uppercase;
          }
          .footer {
            align-items: center;
            border-top: 1px solid #111827;
            display: flex;
            font-size: 13px;
            font-weight: 600;
            justify-content: space-between;
            margin-top: auto;
            padding-top: 8px;
          }
          .bank-details {
            color: #6b7280;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.6;
            margin-top: 2mm;
            text-transform: uppercase;
          }
          .disclaimer {
            color: #6b7280;
            font-size: 12px;
            line-height: 1.5;
            margin-top: 9mm;
          }
          @media print {
            body { background: #fff; }
            .page {
              box-shadow: none;
              margin: 0;
              page-break-after: always;
            }
            .page:last-child {
              page-break-after: auto;
            }
          }
        </style>
      </head>
      <body>
        <section class="page">
          <header class="header">
            <div>
              <img class="logo" src="/Logo.svg" alt="HTG Clouds" />
              <address>
                ${seller.addressLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
              </address>
            </div>
            <div class="slogan">${escapeHtml(seller.slogan)}</div>
          </header>

          <div class="title-row">
            <div>
              <h1>${escapeHtml(title)}</h1>
            </div>
            <section class="bill-to" aria-label="Bill To">
              <div class="bill-to-label">Bill To</div>
              <div class="bill-to-name">${escapeHtml(quote.parentCompanyName)}</div>
              <div>Parent / Main Company</div>
            </section>
          </div>

          <dl class="meta">
            <div>
              <dt>Quote Date</dt>
              <dd>${escapeHtml(formatDate(quote.date))}</dd>
            </div>
            <div>
              <dt>Expiration</dt>
              <dd>${escapeHtml(formatDate(quote.expirationDate))}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>${escapeHtml(quote.sourceMonth ?? "-")}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>${escapeHtml(printableNumber)}</dd>
            </div>
          </dl>

          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Taxes</th>
                <th>Disc.%</th>
                <th>Amount</th>
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

          <div class="payment-note" aria-label="Payment communication">
            <p>
              Payment Communication: <strong>${escapeHtml(printableNumber)}</strong>
              <br />
              on this account: <strong>${escapeHtml(seller.bankAccountNumber)}</strong>
            </p>
            <p class="amount-due">Combined yearly approval document for ${escapeHtml(quote.sourceMonth ?? "-")}</p>
            <p class="payment-instruction">${escapeHtml(seller.paymentInstructions)}</p>
          </div>

          <div class="disclaimer">
            This combined quote is prepared for parent-office approval and PDF sharing.
            It does not create, post, replace, or modify CRM invoices, payments, balances,
            contracts, usage records, or dashboard calculations.
          </div>

          <footer class="footer">
            <span>${escapeHtml(footerText)}</span>
            <span>Page 1 / 2</span>
          </footer>
        </section>

        <section class="page">
          <header class="header">
            <div>
              <img class="logo" src="/Logo.svg" alt="HTG Clouds" />
              <address>
                ${seller.addressLines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}
              </address>
            </div>
            <div class="slogan">${escapeHtml(seller.slogan)}</div>
          </header>

          <div class="bank-details">
            <div>BANK = ${escapeHtml(seller.bankName)}</div>
            <div>ACCOUNT # = ${escapeHtml(seller.bankAccountNumber)}</div>
            <div>ACC. NAME = ${escapeHtml(seller.bankAccountName)}</div>
            <div>${escapeHtml(seller.bankLocation)}</div>
            <div>${escapeHtml(seller.currencyNote)}</div>
          </div>

          <div class="disclaimer">
            Official monthly invoices should continue to be created and managed separately
            per CRM company. This document is only a consolidated quote/approval summary
            for the parent office.
          </div>

          <footer class="footer">
            <span>${escapeHtml(footerText)}</span>
            <span>Page 2 / 2</span>
          </footer>
        </section>
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
