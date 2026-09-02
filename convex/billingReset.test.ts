import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

type ResetArgs = { dryRun: boolean; confirm?: string };
type ResetResult = {
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
type QuoteResetResult = {
  quotes: number;
  combinedQuotes: number;
  taskQuoteRefsToClear: number;
  quoteNotificationsToDelete: number;
  invoiceQuoteRefs: number;
  leadsPreserved: number;
};

const reset = (internal as unknown as {
  billingReset: {
    resetContractsAndInvoices: FunctionReference<
      "mutation",
      "internal",
      ResetArgs,
      ResetResult
    >;
  };
}).billingReset.resetContractsAndInvoices;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const countryId = await ctx.db.insert("countries", { name: "Somalia", region: "East Africa" });
    const sectorId = await ctx.db.insert("sectors", { name: "Banking" });
    const userId = await ctx.db.insert("users", {
      name: "CEO", tokenIdentifier: "reset-test-user", role: "ceo",
    });
    const companyId = await ctx.db.insert("companies", {
      name: "Reset Test Company", countryId, sectorId, accountManagerId: userId,
      contractStatus: "active",
    });
    const tenantId = await ctx.db.insert("manageOneTenants", {
      name: "Reset Tenant", vdcId: "vdc-reset", domainId: "domain-reset",
      regionName: "Mogadishu", lastSyncedAt: 1,
    });
    const catalogItemId = await ctx.db.insert("serviceCatalog", {
      itemName: "Compute", serviceCategory: "Compute", billingUnit: "instance/month",
      monthlyPrice: 10,
    });
    const leadId = await ctx.db.insert("leads", {
      title: "Reset opportunity", companyId, countryId, accountManagerId: userId,
      stage: "won", potentialValue: 20, expectedCloseDate: "2026-08-31",
      lossReason: "Not lost",
    });
    const quoteId = await ctx.db.insert("quotes", {
      companyId, leadId, createdBy: userId, date: "2026-08-01", status: "accepted",
      lineItems: [{ catalogItemId, itemName: "Compute", serviceCategory: "Compute", billingUnit: "instance/month", quantity: 2, monthlyUnitPrice: 10, monthlyTotal: 20, yearlyTotal: 240 }],
      monthlyGrandTotal: 20, yearlyGrandTotal: 240,
    });
    const taskId = await ctx.db.insert("tasks", {
      title: "Quote task", status: "todo", priority: "medium", createdBy: userId,
      companyId, leadId, quoteId, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("notifications", {
      recipientId: userId, type: "quote_discount_approval_requested",
      title: "Quote notification", entityType: "quote", entityId: quoteId,
      href: `/quotes/${quoteId}`, createdAt: 1,
    });
    await ctx.db.insert("notifications", {
      recipientId: userId, type: "task_assigned", title: "Task notification",
      entityType: "task", entityId: taskId, href: `/tasks/${taskId}`, createdAt: 1,
    });
    await ctx.db.insert("combinedQuotes", {
      parentCompanyName: "Reset Test Company", createdBy: userId, date: "2026-08-01",
      status: "draft", lineItems: [], subtotal: 0, taxTotal: 0, discountTotal: 0,
      grandTotal: 0, createdAt: 1, updatedAt: 1,
    });
    const invoiceId = await ctx.db.insert("invoices", {
      companyId, createdBy: userId, companyName: "Reset Test Company", status: "draft",
      lineItems: [{ catalogItemId, itemName: "Compute", serviceCategory: "Compute", billingUnit: "instance/month", quantity: 2, monthlyUnitPrice: 10, monthlyTotal: 20, yearlyTotal: 240 }],
      subtotal: 20, monthlyTotal: 20, yearlyTotal: 240, grandTotal: 20,
      amountPaid: 0, balanceDue: 20, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("invoicePayments", { invoiceId, amount: 5, paidAt: 1, recordedBy: userId, createdAt: 1 });
    await ctx.db.insert("invoiceEvents", { invoiceId, type: "draft_created", createdAt: 1 });
    await ctx.db.insert("dailyUsageSnapshots", {
      companyId, tenantId, tenantName: "Reset Tenant", tenantVdcId: "vdc-reset",
      usageDate: "2026-08-01", month: "2026-08", serviceType: "compute", itemName: "Compute",
      serviceCategory: "Compute", quantity: 2, unit: "instance", source: "manageone",
      sourceKey: "reset-test-row", capturedAt: 1, invoiceId, lockedAt: 2,
    });
    const creditId = await ctx.db.insert("customerCredits", {
      companyId, originalAmount: 10, remainingAmount: 10, reservedAmount: 0,
      currency: "USD", policy: "carry_forward", appliesTo: "all", status: "available",
      createdBy: userId, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("customerCreditLedger", {
      creditId, companyId, invoiceId, type: "reserved", amount: 5, balanceAfter: 5, createdAt: 1,
    });
    const contractId = await ctx.db.insert("customerContracts", {
      companyId, contractNumber: "CTR-RESET-1", title: "Reset Contract", status: "draft",
      startDate: 1, endDate: 2, currency: "USD", billingFrequency: "monthly",
      createdBy: userId, createdAt: 1, updatedAt: 1,
    });
    await ctx.db.insert("customerContractGroupDiscounts", { contractId, productGroup: "compute", discountPercent: 10, createdBy: userId, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("customerContractLineItems", { contractId, catalogItemId, itemName: "Compute", serviceCategory: "Compute", includedQuantity: 1, unit: "instance", contractUnitPrice: 10, billingUnit: "instance/month", createdBy: userId, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("customerContractAmendments", { contractId, amendmentNumber: "A-1", type: "correction", effectiveDate: 1, summary: "Reset test", status: "draft", createdBy: userId, createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("customerContractEvents", { contractId, actorId: userId, type: "created", message: "Reset test", createdAt: 1 });
    return { companyId, tenantId, catalogItemId, invoiceId, contractId, creditId, leadId, quoteId, taskId };
  });
}

async function counts(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    invoices: (await ctx.db.query("invoices").collect()).length,
    invoicePayments: (await ctx.db.query("invoicePayments").collect()).length,
    invoiceEvents: (await ctx.db.query("invoiceEvents").collect()).length,
    dailyUsage: await ctx.db.query("dailyUsageSnapshots").collect(),
    ledger: await ctx.db.query("customerCreditLedger").collect(),
    credits: await ctx.db.query("customerCredits").collect(),
    contracts: (await ctx.db.query("customerContracts").collect()).length,
    groupDiscounts: (await ctx.db.query("customerContractGroupDiscounts").collect()).length,
    lineItems: (await ctx.db.query("customerContractLineItems").collect()).length,
    amendments: (await ctx.db.query("customerContractAmendments").collect()).length,
    contractEvents: (await ctx.db.query("customerContractEvents").collect()).length,
    companies: (await ctx.db.query("companies").collect()).length,
    catalog: await ctx.db.query("serviceCatalog").collect(),
    tenants: await ctx.db.query("manageOneTenants").collect(),
    hourlySnapshots: (await ctx.db.query("manageOneHourlySnapshots").collect()).length,
    cloudCapacitySnapshots: (await ctx.db.query("cloudCapacitySnapshots").collect()).length,
    quotes: (await ctx.db.query("quotes").collect()).length,
    combinedQuotes: (await ctx.db.query("combinedQuotes").collect()).length,
    tasks: await ctx.db.query("tasks").collect(),
    leads: await ctx.db.query("leads").collect(),
    notifications: await ctx.db.query("notifications").collect(),
  }));
}

describe("billing reset maintenance mutation", () => {
  it("is dry-run safe, guarded, and clears only owned billing links", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const before = await counts(t);
    const dryRun = await t.mutation(reset, { dryRun: true });
    expect(dryRun).toMatchObject({ invoices: 1, invoicePayments: 1, invoiceEvents: 1, dailyUsageRowsToUnlock: 1, creditLedgerRefsToClear: 1, contracts: 1, groupDiscounts: 1, lineItems: 1, amendments: 1, contractEvents: 1 });
    expect(await counts(t)).toEqual(before);
    await expect(t.mutation(reset, { dryRun: false, confirm: "WRONG" })).rejects.toThrow("Exact confirmation required");

    await t.mutation(reset, { dryRun: false, confirm: "RESET_CONTRACTS_AND_INVOICES" });
    const after = await counts(t);
    expect(after.invoices).toBe(0);
    expect(after.invoicePayments).toBe(0);
    expect(after.invoiceEvents).toBe(0);
    expect(after.contracts).toBe(0);
    expect(after.groupDiscounts).toBe(0);
    expect(after.lineItems).toBe(0);
    expect(after.amendments).toBe(0);
    expect(after.contractEvents).toBe(0);
    expect(after.dailyUsage).toHaveLength(before.dailyUsage.length);
    expect(after.dailyUsage[0].quantity).toBe(2);
    expect(after.dailyUsage[0].invoiceId).toBeUndefined();
    expect(after.dailyUsage[0].lockedAt).toBeUndefined();
    expect(after.credits).toEqual(before.credits);
    expect(after.ledger).toHaveLength(before.ledger.length);
    expect(after.ledger[0].creditId).toBe(before.ledger[0].creditId);
    expect(after.ledger[0].invoiceId).toBeUndefined();
    expect(after.ledger[0].amount).toBe(5);
    expect(after.companies).toBe(before.companies);
    expect(after.catalog).toEqual(before.catalog);
    expect(after.tenants).toEqual(before.tenants);
    expect(after.hourlySnapshots).toBe(before.hourlySnapshots);
    expect(after.cloudCapacitySnapshots).toBe(before.cloudCapacitySnapshots);
  });

  it("resets quotes without deleting preserved workflow records", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const before = await counts(t);
    const dryRun = await t.mutation(
      (internal as unknown as { billingReset: { resetQuotesAndCombinedQuotes: FunctionReference<"mutation", "internal", ResetArgs, QuoteResetResult> } }).billingReset.resetQuotesAndCombinedQuotes,
      { dryRun: true },
    );
    expect(dryRun).toMatchObject({ quotes: 1, combinedQuotes: 1, taskQuoteRefsToClear: 1, quoteNotificationsToDelete: 1, invoiceQuoteRefs: 0, leadsPreserved: 1 });
    expect(await counts(t)).toEqual(before);
    const resetQuotes = (internal as unknown as { billingReset: { resetQuotesAndCombinedQuotes: FunctionReference<"mutation", "internal", ResetArgs, QuoteResetResult> } }).billingReset.resetQuotesAndCombinedQuotes;
    await expect(t.mutation(resetQuotes, { dryRun: false, confirm: "WRONG" })).rejects.toThrow("Exact confirmation required");
    await t.mutation(resetQuotes, { dryRun: false, confirm: "RESET_QUOTES_AND_COMBINED_QUOTES" });
    const after = await counts(t);
    expect(after.quotes).toBe(0);
    expect(after.combinedQuotes).toBe(0);
    expect(after.tasks).toHaveLength(before.tasks.length);
    expect(after.tasks[0].quoteId).toBeUndefined();
    expect(after.tasks[0].title).toBe(before.tasks[0].title);
    expect(after.leads).toEqual(before.leads);
    expect(after.notifications).toHaveLength(1);
    expect(after.notifications[0].entityType).toBe("task");
    expect(after.companies).toBe(before.companies);
    expect(after.catalog).toEqual(before.catalog);
    expect(after.tenants).toEqual(before.tenants);
    expect(after.invoices).toBe(1);
    expect(after.contracts).toBe(1);
    expect(seeded.quoteId).toBeDefined();
  });

  it("fails closed when an invoice references a quote", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      const quote = (await ctx.db.query("quotes").collect())[0];
      const invoice = (await ctx.db.query("invoices").collect())[0];
      await ctx.db.patch(invoice._id, { sourceQuoteId: quote._id });
    });
    const resetQuotes = (internal as unknown as { billingReset: { resetQuotesAndCombinedQuotes: FunctionReference<"mutation", "internal", ResetArgs, QuoteResetResult> } }).billingReset.resetQuotesAndCombinedQuotes;
    await expect(t.mutation(resetQuotes, { dryRun: false, confirm: "RESET_QUOTES_AND_COMBINED_QUOTES" })).rejects.toThrow("invoice(s) reference quotes");
    expect(await counts(t)).toMatchObject({ quotes: 1, combinedQuotes: 1, invoices: 1 });
  });
});
