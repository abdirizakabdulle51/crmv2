import { Component, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

type Invoice = Doc<"invoices">;
type InvoiceStatus = Invoice["status"];

const BUSINESS_TIME_ZONE = "Africa/Mogadishu";
const BANK_ACCOUNT = "33111777";
const OFFICIAL_PRINT_STATUSES = new Set<InvoiceStatus>([
  "issued",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
]);

function displayInvoiceNumber(invoiceNumber?: string) {
  if (!invoiceNumber) return "Draft";
  const match = invoiceNumber.match(/^INV-(\d{4})-(\d+)$/);
  return match ? `INV/${match[1]}/${match[2]}` : invoiceNumber;
}

function formatPrintDate(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(value));
}

function formatDueMonth(value?: number) {
  if (!value) return "-";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).formatToParts(new Date(value));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  return month && year ? `${month}, ${year}` : "-";
}

function formatQuantity(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUnitPrice(value: number) {
  const hasMoreThanTwoDecimals =
    Math.abs(value - Math.round(value * 100) / 100) > 0.000001;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: hasMoreThanTwoDecimals ? 3 : 2,
    maximumFractionDigits: 3,
  });
}

function formatCurrency(value: number) {
  return `$ ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function sourceLabel(invoice: Invoice) {
  return (
    invoice.sourceMonth ??
    (invoice.sourceQuoteId ? String(invoice.sourceQuoteId) : "-")
  );
}

function referenceLabel(invoice: Invoice) {
  return invoice.sourceQuoteId
    ? String(invoice.sourceQuoteId)
    : (invoice.sourceMonth ?? "-");
}

function Header() {
  return (
    <header className="invoice-header">
      <div>
        <img className="invoice-logo" src="/Logo.svg" alt="HTG Clouds" />
        <address>
          <strong>HTG Clouds</strong>
          <span>Airport road, Next to Ali Jimale Masque</span>
          <span>Wadajir District</span>
          <span>mogadishu BN 00000</span>
          <span>Somalia</span>
        </address>
      </div>
      <div className="invoice-slogan">Built for us, Ready for the World.</div>
    </header>
  );
}

function BillTo({ invoice }: { invoice: Invoice }) {
  const email = invoice.billingEmail?.trim() || invoice.contactEmail?.trim();

  return (
    <section className="bill-to" aria-label="Bill To">
      <div className="bill-to-label">Bill To</div>
      <div className="bill-to-name">{invoice.companyName}</div>
      {invoice.contactName ? <div>{invoice.contactName}</div> : null}
      {email ? <div>{email}</div> : null}
      {invoice.billingAddress ? <div>{invoice.billingAddress}</div> : null}
    </section>
  );
}

function Footer({ page }: { page: 1 | 2 }) {
  return (
    <footer className="invoice-footer">
      <span>
        +252 61 5558484 | Mohamed.hussein@htgclouds.com | https://htgclouds.com/
      </span>
      <span>Page {page} / 2</span>
    </footer>
  );
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
            This invoice may not exist, or you may not have access to print it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

class InvoicePrintErrorBoundary extends Component<
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

function InvoicePrintContent() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const invoice = useQuery(
    api.invoices.getById,
    invoiceId ? { invoiceId: invoiceId as Id<"invoices"> } : "skip",
  );

  if (!invoiceId || invoice === null) {
    return <UnavailableState />;
  }

  if (!invoice) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  if (
    invoice.status !== "draft" &&
    !OFFICIAL_PRINT_STATUSES.has(invoice.status)
  ) {
    return (
      <div className="p-6 md:p-8">
        <Button
          variant="ghost"
          className="mb-4 -ml-2"
          onClick={() => navigate(`/invoices/${invoice._id}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Invoice
        </Button>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>Invoice print unavailable</EmptyTitle>
            <EmptyDescription>
              Only draft previews and issued invoice snapshots can be printed.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const invoiceNumber = displayInvoiceNumber(invoice.invoiceNumber);
  const title =
    invoice.status === "draft" ? "Draft Preview" : `Invoice ${invoiceNumber}`;
  const dueSource = invoice.dueDate ?? invoice.issueDate ?? invoice.createdAt;

  return (
    <div className="invoice-print-shell">
      <style>{`
        @page {
          size: A4;
          margin: 0;
        }

        @media print {
          body {
            background: #fff !important;
          }
          .invoice-print-actions {
            display: none !important;
          }
          .invoice-print-shell {
            padding: 0 !important;
            background: #fff !important;
          }
          .invoice-page {
            box-shadow: none !important;
            margin: 0 !important;
            page-break-after: always;
          }
          .invoice-page:last-child {
            page-break-after: auto;
          }
        }

        .invoice-print-shell {
          min-height: 100vh;
          background: #f8fafc;
          padding: 24px;
          color: #111827;
        }

        .invoice-print-actions {
          align-items: center;
          display: flex;
          gap: 12px;
          justify-content: space-between;
          margin: 0 auto 18px;
          max-width: 210mm;
        }

        .invoice-page {
          background: #fff;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
          height: 297mm;
          margin: 0 auto 20px;
          padding: 16mm 14mm 18mm;
          position: relative;
          width: 210mm;
        }

        .invoice-header {
          display: flex;
          justify-content: space-between;
          min-height: 44mm;
        }

        .invoice-logo {
          display: block;
          height: 34px;
          margin-bottom: 12px;
          object-fit: contain;
          object-position: left center;
          width: 114px;
        }

        .invoice-header address {
          display: flex;
          flex-direction: column;
          font-style: normal;
          font-size: 14px;
          line-height: 1.5;
        }

        .invoice-slogan {
          color: #07999d;
          font-size: 13px;
          font-weight: 700;
          padding-top: 10px;
        }

        .invoice-title-row {
          align-items: flex-start;
          display: grid;
          gap: 16mm;
          grid-template-columns: minmax(0, 1fr) 74mm;
          margin-bottom: 6mm;
        }

        .bill-to {
          font-size: 13px;
          line-height: 1.45;
          padding-top: 1mm;
        }

        .bill-to-label {
          color: #37aeb2;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          margin-bottom: 4px;
          text-transform: uppercase;
        }

        .bill-to-name {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 2px;
        }

        .invoice-title {
          color: #07999d;
          font-size: 26px;
          font-weight: 500;
          letter-spacing: 0;
          margin: 0;
        }

        .invoice-meta {
          display: grid;
          gap: 18px;
          grid-template-columns: repeat(4, 1fr);
          margin-bottom: 9mm;
        }

        .invoice-meta dt {
          color: #37aeb2;
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .invoice-meta dd {
          font-size: 13px;
          margin: 0;
        }

        .invoice-table {
          border-collapse: collapse;
          font-size: 13px;
          width: 100%;
        }

        .invoice-table th {
          border-bottom: 1px solid #111827;
          font-size: 13px;
          font-weight: 500;
          padding: 0 0 7px;
          text-align: left;
        }

        .invoice-table th:nth-child(2),
        .invoice-table th:nth-child(3),
        .invoice-table th:nth-child(4),
        .invoice-table td:nth-child(2),
        .invoice-table td:nth-child(3),
        .invoice-table td:nth-child(4) {
          text-align: right;
        }

        .invoice-table td {
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

        .invoice-total {
          margin-left: auto;
          margin-top: 14mm;
          max-width: 82mm;
        }

        .invoice-total-row {
          border-top: 1px solid #111827;
          color: #07999d;
          display: flex;
          font-size: 14px;
          font-weight: 700;
          justify-content: space-between;
          padding-top: 9px;
        }

        .payment-note {
          bottom: 36mm;
          font-size: 13px;
          left: 14mm;
          position: absolute;
          width: 112mm;
        }

        .payment-note p {
          margin: 0 0 8px;
        }

        .amount-due {
          color: #6b7280;
          font-size: 14px;
          margin-top: 10mm;
        }

        .payment-instruction {
          color: #6b7280;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.01em;
          text-transform: uppercase;
        }

        .invoice-footer {
          align-items: center;
          border-top: 1px solid #111827;
          bottom: 15mm;
          display: flex;
          font-size: 13px;
          font-weight: 600;
          justify-content: space-between;
          left: 14mm;
          padding-top: 8px;
          position: absolute;
          right: 14mm;
        }

        .bank-details {
          color: #6b7280;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.6;
          margin-top: 2mm;
          text-transform: uppercase;
        }

        .draft-watermark {
          border: 1px solid #f59e0b;
          border-radius: 999px;
          color: #b45309;
          display: inline-flex;
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 5mm;
          padding: 4px 12px;
          text-transform: uppercase;
        }
      `}</style>

      <div className="invoice-print-actions">
        <Button
          variant="ghost"
          onClick={() => navigate(`/invoices/${invoice._id}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Invoice
        </Button>
        <Button
          className="bg-cyan-600 text-white hover:bg-cyan-700"
          onClick={() => window.print()}
        >
          <Printer className="mr-2 h-4 w-4" />
          Print / Export PDF
        </Button>
      </div>

      <main aria-label="Invoice print template">
        <section className="invoice-page" aria-label="Invoice page 1">
          <Header />
          <div className="invoice-title-row">
            <div>
              {invoice.status === "draft" ? (
                <div className="draft-watermark">Draft Preview</div>
              ) : null}
              <h1 className="invoice-title">{title}</h1>
            </div>
            <BillTo invoice={invoice} />
          </div>

          <dl className="invoice-meta">
            <div>
              <dt>Invoice Date</dt>
              <dd>{formatPrintDate(invoice.issueDate ?? invoice.createdAt)}</dd>
            </div>
            <div>
              <dt>Due Date</dt>
              <dd>{formatPrintDate(invoice.dueDate)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{sourceLabel(invoice)}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{referenceLabel(invoice)}</dd>
            </div>
          </dl>

          <table className="invoice-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((item, index) => (
                <tr key={`${item.catalogItemId}-${index}`}>
                  <td>
                    <div className="line-title">{item.itemName}</div>
                    <div className="line-subtitle">
                      {item.serviceCategory || item.billingUnit}
                    </div>
                  </td>
                  <td>{formatQuantity(item.quantity)}</td>
                  <td>{formatUnitPrice(item.monthlyUnitPrice)}</td>
                  <td>{formatCurrency(item.monthlyTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="invoice-total" aria-label="Invoice total">
            <div className="invoice-total-row">
              <span>Total</span>
              <span>{formatCurrency(invoice.grandTotal)}</span>
            </div>
          </div>

          <div className="payment-note">
            <p>
              Payment Communication: <strong>{invoiceNumber}</strong>
              <br />
              on this account: <strong>{BANK_ACCOUNT}</strong>
            </p>
            <p className="amount-due">Amount Due {formatDueMonth(dueSource)}</p>
            <p className="payment-instruction">
              PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI
              BANK ACCOUNT.
            </p>
          </div>

          <Footer page={1} />
        </section>

        <section className="invoice-page" aria-label="Invoice page 2">
          <Header />
          <div className="bank-details">
            <div>ACCOUNT # = {BANK_ACCOUNT}</div>
            <div>ACC. NAME = HTG CLOUDS LIMITED</div>
            <div>MOGADISHU - SOMALIA</div>
            <div>All fees are listed in USD</div>
          </div>
          <Footer page={2} />
        </section>
      </main>
    </div>
  );
}

export default function InvoicePrintPage() {
  return (
    <InvoicePrintErrorBoundary>
      <InvoicePrintContent />
    </InvoicePrintErrorBoundary>
  );
}
