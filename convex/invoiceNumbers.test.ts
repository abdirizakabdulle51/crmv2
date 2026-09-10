import { describe, expect, it } from "vitest";
import { invoiceNumberForSequence, nextInvoiceSequence } from "./invoiceNumbers";

const invoice = (invoiceNumber?: string) => ({ invoiceNumber });

describe("invoice number allocation", () => {
  it("preserves contiguous count-based numbering", () => {
    const invoices = Array.from({ length: 49 }, (_, index) =>
      invoice(`INV-2026-${String(index + 1).padStart(5, "0")}`),
    );

    expect(nextInvoiceSequence(invoices)).toBe(50);
    expect(invoiceNumberForSequence(Date.UTC(2026, 8, 10), nextInvoiceSequence(invoices))).toBe(
      "INV-2026-00050",
    );
  });

  it("uses the maximum valid suffix when deletion lowers the count", () => {
    const invoices = [
      ...Array.from({ length: 45 }, (_, index) => invoice(`LEGACY-${index}`)),
      invoice("INV-2026-00049"),
    ];

    expect(invoices.filter((row) => row.invoiceNumber).length + 1).toBe(47);
    expect(nextInvoiceSequence(invoices)).toBe(50);
    expect(invoiceNumberForSequence(Date.UTC(2026, 8, 10), nextInvoiceSequence(invoices))).toBe(
      "INV-2026-00050",
    );
  });

  it("considers valid normal numbers across years without an annual reset", () => {
    const invoices = [invoice("INV-2025-00080")];

    expect(nextInvoiceSequence(invoices)).toBe(81);
    expect(invoiceNumberForSequence(Date.UTC(2026, 0, 1), nextInvoiceSequence(invoices))).toBe(
      "INV-2026-00081",
    );
    expect(invoiceNumberForSequence(Date.UTC(2027, 0, 1), nextInvoiceSequence(invoices))).toBe(
      "INV-2027-00081",
    );
  });

  it("ignores legacy, malformed, and missing invoice numbers for the max suffix", () => {
    const invoices = [
      invoice("HIST-ODOO-00099"),
      invoice("INV-2026-1234"),
      invoice("INV-2026-000001"),
      invoice("INV-XXXX-99999"),
      invoice("INV-2026-ABCDE"),
      invoice(),
    ];

    expect(nextInvoiceSequence(invoices)).toBe(6);
  });

  it("never mutates existing invoice numbers and does not move backward across gaps", () => {
    const invoices = [
      invoice("INV-2026-00001"),
      invoice("INV-2026-00003"),
      invoice("INV-2026-00049"),
    ];
    const before = invoices.map((row) => row.invoiceNumber);

    expect(nextInvoiceSequence(invoices)).toBe(50);
    expect(invoices.map((row) => row.invoiceNumber)).toEqual(before);
  });
});
