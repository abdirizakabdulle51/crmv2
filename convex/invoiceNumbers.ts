import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

export function invoiceNumberForSequence(now: number, sequence: number) {
  const year = new Date(now).getUTCFullYear();
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

export function nextInvoiceSequence(
  invoices: Pick<Doc<"invoices">, "invoiceNumber">[],
) {
  const countBasedNext =
    invoices.filter((invoice) => invoice.invoiceNumber).length + 1;
  const normalInvoiceNumberPattern = /^INV-\d{4}-(\d{5})$/;
  const maximumNormalSequence = invoices.reduce((maximum, invoice) => {
    const match = invoice.invoiceNumber?.match(normalInvoiceNumberPattern);
    if (!match) return maximum;
    return Math.max(maximum, Number(match[1]));
  }, 0);
  return Math.max(countBasedNext, maximumNormalSequence + 1);
}

export async function nextInvoiceNumber(ctx: MutationCtx, now: number) {
  const invoices = await ctx.db.query("invoices").collect();
  return invoiceNumberForSequence(now, nextInvoiceSequence(invoices));
}
