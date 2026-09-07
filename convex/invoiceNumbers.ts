import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

export function invoiceNumberForSequence(now: number, sequence: number) {
  const year = new Date(now).getUTCFullYear();
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

export function nextInvoiceSequence(
  invoices: Pick<Doc<"invoices">, "invoiceNumber">[],
) {
  return invoices.filter((invoice) => invoice.invoiceNumber).length + 1;
}

export async function nextInvoiceNumber(ctx: MutationCtx, now: number) {
  const invoices = await ctx.db.query("invoices").collect();
  return invoiceNumberForSequence(now, nextInvoiceSequence(invoices));
}
