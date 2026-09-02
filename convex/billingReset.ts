import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const CONFIRMATION = "RESET_CONTRACTS_AND_INVOICES";

type ResetCounts = {
  invoices: number;
  invoicePayments: number;
  invoiceEvents: number;
  dailyUsageRowsToUnlock: number;
  creditLedgerRefsToClear: number;
  contracts: number;
  groupDiscounts: number;
  lineItems: number;
  amendments: number;
  contractEvents: number;
};

export const resetContractsAndInvoices = internalMutation({
  args: {
    dryRun: v.boolean(),
    confirm: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ResetCounts> => {
    if (!args.dryRun && args.confirm !== CONFIRMATION) {
      throw new Error(`Exact confirmation required: ${CONFIRMATION}`);
    }

    const invoices = await ctx.db.query("invoices").collect();
    const contracts = await ctx.db.query("customerContracts").collect();
    const counts: ResetCounts = {
      invoices: invoices.length,
      invoicePayments: 0,
      invoiceEvents: 0,
      dailyUsageRowsToUnlock: 0,
      creditLedgerRefsToClear: 0,
      contracts: contracts.length,
      groupDiscounts: 0,
      lineItems: 0,
      amendments: 0,
      contractEvents: 0,
    };

    for (const invoice of invoices) {
      const payments = await ctx.db
        .query("invoicePayments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      const events = await ctx.db
        .query("invoiceEvents")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      const usageRows = await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      const creditRefs = await ctx.db
        .query("customerCreditLedger")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      counts.invoicePayments += payments.length;
      counts.invoiceEvents += events.length;
      counts.dailyUsageRowsToUnlock += usageRows.length;
      counts.creditLedgerRefsToClear += creditRefs.length;

      if (!args.dryRun) {
        for (const payment of payments) await ctx.db.delete(payment._id);
        for (const event of events) await ctx.db.delete(event._id);
        for (const row of usageRows) {
          await ctx.db.patch(row._id, { invoiceId: undefined, lockedAt: undefined });
        }
        for (const ledger of creditRefs) {
          await ctx.db.patch(ledger._id, { invoiceId: undefined });
        }
        await ctx.db.delete(invoice._id);
      }
    }

    for (const contract of contracts) {
      const groupDiscounts = await ctx.db
        .query("customerContractGroupDiscounts")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect();
      const lineItems = await ctx.db
        .query("customerContractLineItems")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect();
      const amendments = await ctx.db
        .query("customerContractAmendments")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect();
      const events = await ctx.db
        .query("customerContractEvents")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect();
      counts.groupDiscounts += groupDiscounts.length;
      counts.lineItems += lineItems.length;
      counts.amendments += amendments.length;
      counts.contractEvents += events.length;

      if (!args.dryRun) {
        for (const row of groupDiscounts) await ctx.db.delete(row._id);
        for (const row of lineItems) await ctx.db.delete(row._id);
        for (const row of amendments) await ctx.db.delete(row._id);
        for (const row of events) await ctx.db.delete(row._id);
        await ctx.db.delete(contract._id);
      }
    }

    return counts;
  },
});
