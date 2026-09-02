import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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

const QUOTE_RESET_CONFIRMATION = "RESET_QUOTES_AND_COMBINED_QUOTES";

type QuoteResetCounts = {
  quotes: number;
  combinedQuotes: number;
  taskQuoteRefsToClear: number;
  quoteNotificationsToDelete: number;
  invoiceQuoteRefs: number;
  leadsPreserved: number;
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

export const resetQuotesAndCombinedQuotes = internalMutation({
  args: {
    dryRun: v.boolean(),
    confirm: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<QuoteResetCounts> => {
    if (!args.dryRun && args.confirm !== QUOTE_RESET_CONFIRMATION) {
      throw new Error(
        `Exact confirmation required: ${QUOTE_RESET_CONFIRMATION}`,
      );
    }

    const quotes = await ctx.db.query("quotes").collect();
    const quoteIds = new Set(quotes.map((quote) => quote._id));
    const tasks = await ctx.db.query("tasks").collect();
    const taskQuoteRefs = tasks.filter(
      (task) => task.quoteId !== undefined && quoteIds.has(task.quoteId),
    );
    const invoices = await ctx.db.query("invoices").collect();
    const invoiceQuoteRefs = invoices.filter(
      (invoice) => invoice.sourceQuoteId !== undefined,
    );
    const quoteNotifications: Array<{ _id: Id<"notifications"> }> = [];
    for (const quote of quotes) {
      const notifications = await ctx.db
        .query("notifications")
        .withIndex("by_entity", (q) =>
          q.eq("entityType", "quote").eq("entityId", quote._id),
        )
        .collect();
      quoteNotifications.push(...notifications);
    }
    const leads = await ctx.db.query("leads").collect();
    const combinedQuotes = await ctx.db.query("combinedQuotes").collect();
    const counts: QuoteResetCounts = {
      quotes: quotes.length,
      combinedQuotes: combinedQuotes.length,
      taskQuoteRefsToClear: taskQuoteRefs.length,
      quoteNotificationsToDelete: quoteNotifications.length,
      invoiceQuoteRefs: invoiceQuoteRefs.length,
      leadsPreserved: leads.length,
    };

    if (!args.dryRun) {
      if (counts.invoiceQuoteRefs > 0) {
        throw new Error(
          `Refusing quote reset: ${counts.invoiceQuoteRefs} invoice(s) reference quotes being deleted`,
        );
      }
      for (const task of taskQuoteRefs) {
        await ctx.db.patch(task._id, { quoteId: undefined });
      }
      for (const notification of quoteNotifications) {
        await ctx.db.delete(notification._id);
      }
      for (const quote of quotes) {
        await ctx.db.delete(quote._id);
      }
      for (const quote of combinedQuotes) {
        await ctx.db.delete(quote._id);
      }
    }

    return counts;
  },
});
