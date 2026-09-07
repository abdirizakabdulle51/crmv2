import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";
import { calculatePaymentApplication } from "./invoices";

type Args = {
  companyId: Id<"companies">;
  originalReference: string;
  invoiceDate: string;
  coverageStartMonth: string;
  monthsCovered: number;
  monthlyAmount: number;
  paymentDate: string;
  paymentMethod?: string;
  receivingAccountId?: Id<"receivingAccounts">;
  paymentReference?: string;
  transactionId?: string;
  notes?: string;
};
type UnpaidArgs = Omit<Args, "paymentDate" | "paymentMethod" | "receivingAccountId" | "paymentReference" | "transactionId">;
const createHistorical = (api as unknown as {
  historicalInvoices: {
    create: FunctionReference<"mutation", "public", Args, Id<"invoices">>;
    createUnpaid: FunctionReference<"mutation", "public", UnpaidArgs, Id<"invoices">>;
  };
}).historicalInvoices.create;
const createHistoricalUnpaid = (api as unknown as {
  historicalInvoices: { createUnpaid: FunctionReference<"mutation", "public", UnpaidArgs, Id<"invoices">> };
}).historicalInvoices.createUnpaid;
const renumberOutstanding = (internal as unknown as {
  historicalInvoices: { renumberOutstanding: FunctionReference<"mutation", "internal", { dryRun: boolean; confirm?: string }, unknown> };
}).historicalInvoices.renumberOutstanding;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const countryId = await ctx.db.insert("countries", { name: "Somalia", region: "East Africa" });
    const sectorId = await ctx.db.insert("sectors", { name: "Banking" });
    const userId = await ctx.db.insert("users", { name: "Finance CEO", tokenIdentifier: "historical-test", role: "ceo" });
    const companyId = await ctx.db.insert("companies", { name: "Historical Customer", countryId, sectorId, accountManagerId: userId, contractStatus: "active" });
    const accountId = await ctx.db.insert("receivingAccounts", {
      countryId, name: "Main Bank", providerName: "Somali Bank", accountNumber: "001", accountHolderName: "HTG", type: "bank", usage: "incoming", currency: "USD", isActive: true, createdBy: userId, createdAt: 1, updatedAt: 1,
    });
    return { countryId, userId, companyId, accountId };
  });
}

describe("historical paid invoices", () => {
  it("records a paid multi-month invoice with exact existing money semantics", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const invoiceId = await user.mutation(createHistorical, {
      companyId: s.companyId, originalReference: "S00065", invoiceDate: "2026-05-14", coverageStartMonth: "2026-05", monthsCovered: 3, monthlyAmount: 5874.93, paymentDate: "2026-05-14", receivingAccountId: s.accountId, transactionId: "ODOO-S00065", paymentReference: "Paid in Odoo",
    });
    const result = await t.run(async (ctx) => ({
      invoice: await ctx.db.get(invoiceId),
      payments: await ctx.db.query("invoicePayments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
      events: await ctx.db.query("invoiceEvents").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
      contracts: await ctx.db.query("customerContracts").collect(),
      quotes: await ctx.db.query("quotes").collect(),
      leads: await ctx.db.query("leads").collect(),
    }));
    expect(result.invoice).toMatchObject({ isHistorical: true, sourceSystem: "odoo", originalReference: "S00065", issueDate: Date.UTC(2026, 4, 14), status: "paid", grandTotal: 17624.79, grandTotalCents: 1762479, amountPaid: 17624.79, amountPaidCents: 1762479, balanceDue: 0, balanceDueCents: 0, historicalCoverageStartMonth: "2026-05", historicalCoverageMonths: 3 });
    expect(result.invoice?.invoiceNumber).toBe(`INV-${new Date().getUTCFullYear()}-00001`);
    expect(result.invoice?.revenueAllocations).toEqual([{ month: "2026-05", amount: 5874.93 }, { month: "2026-06", amount: 5874.93 }, { month: "2026-07", amount: 5874.93 }]);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toMatchObject({ amount: 17624.79, amountCents: 1762479, appliedAmount: 17624.79, paidAt: Date.UTC(2026, 4, 14), method: "Bank Transfer", transactionId: "ODOO-S00065" });
    expect(result.payments[0].extraServiceRevenueAmount).toBeUndefined();
    expect(result.events.map((event) => event.type)).toEqual(["draft_created", "issued", "payment_recorded"]);
    expect(result.invoice?.createdAt).toBeGreaterThan(0);
    expect(result.payments[0].createdAt).toBeGreaterThan(0);
    expect(result.contracts).toHaveLength(0);
    expect(result.quotes).toHaveLength(0);
    expect(result.leads).toHaveLength(0);
  });

  it("uses the shared normal sequence for historical and subsequent CRM invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const paidId = await user.mutation(createHistorical, {
      companyId: s.companyId, originalReference: "SEQUENCE-PAID", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100, paymentDate: "2026-01-01",
    });
    const unpaidId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "SEQUENCE-UNPAID", invoiceDate: "2026-01-02", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    const normalDraftId = await t.run(async (ctx) => ctx.db.insert("invoices", {
      companyId: s.companyId,
      createdBy: s.userId,
      status: "draft",
      companyName: "Historical Customer",
      lineItems: [{ itemName: "Normal service", serviceCategory: "Compute", billingUnit: "month", quantity: 1, monthlyUnitPrice: 10, monthlyTotal: 10, yearlyTotal: 120 }],
      subtotal: 10,
      monthlyTotal: 10,
      yearlyTotal: 120,
      grandTotal: 10,
      amountPaid: 0,
      balanceDue: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    await user.mutation(api.invoices.issueInvoice, { invoiceId: normalDraftId });
    const result = await t.run(async (ctx) => ({
      paid: await ctx.db.get(paidId),
      unpaid: await ctx.db.get(unpaidId),
      normal: await ctx.db.get(normalDraftId),
    }));
    const year = new Date().getUTCFullYear();
    expect(result.paid?.invoiceNumber).toBe(`INV-${year}-00001`);
    expect(result.unpaid?.invoiceNumber).toBe(`INV-${year}-00002`);
    expect(result.normal?.invoiceNumber).toBe(`INV-${year}-00003`);
  });

  it("previews and executes only outstanding legacy historical renumbering", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const paidId = await user.mutation(createHistorical, {
      companyId: s.companyId, originalReference: "LEGACY-PAID", invoiceDate: "2026-01-03", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100, paymentDate: "2026-01-03",
    });
    const earlyId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "LEGACY-EARLY", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    const partialId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "LEGACY-PARTIAL", invoiceDate: "2026-01-02", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    await user.mutation(api.invoices.recordPayment, { invoiceId: partialId, amount: 20, paidAt: Date.UTC(2026, 0, 4), receivingAccountId: s.accountId, transactionId: "LEGACY-PARTIAL-1" });
    await t.run(async (ctx) => {
      await ctx.db.patch(paidId, { invoiceNumber: "HIST-ODOO-PAID", status: "paid" });
      await ctx.db.patch(earlyId, { invoiceNumber: "HIST-ODOO-EARLY" });
      await ctx.db.patch(partialId, { invoiceNumber: "HIST-ODOO-PARTIAL" });
    });
    const before = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
      payments: await ctx.db.query("invoicePayments").collect(),
      events: await ctx.db.query("invoiceEvents").collect(),
    }));
    await expect(t.mutation(renumberOutstanding, { dryRun: false })).rejects.toThrow("Exact confirmation required");
    const preview = await t.mutation(renumberOutstanding, { dryRun: true });
    const year = new Date().getUTCFullYear();
    expect(preview).toEqual([
      expect.objectContaining({ invoiceId: earlyId, oldInvoiceNumber: "HIST-ODOO-EARLY", newInvoiceNumber: `INV-${year}-00004`, status: "issued", grandTotal: 100, amountPaid: 0, balanceDue: 100, originalReference: "LEGACY-EARLY" }),
      expect.objectContaining({ invoiceId: partialId, oldInvoiceNumber: "HIST-ODOO-PARTIAL", newInvoiceNumber: `INV-${year}-00005`, status: "partially_paid", grandTotal: 100, amountPaid: 20, balanceDue: 80, originalReference: "LEGACY-PARTIAL" }),
    ]);
    const afterDryRun = await t.run(async (ctx) => ({ invoices: await ctx.db.query("invoices").collect(), payments: await ctx.db.query("invoicePayments").collect(), events: await ctx.db.query("invoiceEvents").collect() }));
    expect(afterDryRun).toEqual(before);
    await t.mutation(renumberOutstanding, { dryRun: false, confirm: "RENUMBER_OUTSTANDING_HISTORICAL_INVOICES" });
    const after = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
      payments: await ctx.db.query("invoicePayments").collect(),
      events: await ctx.db.query("invoiceEvents").collect(),
    }));
    expect(after.payments).toEqual(before.payments);
    expect(after.events).toEqual(before.events);
    expect(after.invoices.find((invoice) => invoice._id === paidId)).toEqual(before.invoices.find((invoice) => invoice._id === paidId));
    expect(after.invoices.find((invoice) => invoice._id === earlyId)).toEqual({ ...before.invoices.find((invoice) => invoice._id === earlyId), invoiceNumber: `INV-${year}-00004` });
    expect(after.invoices.find((invoice) => invoice._id === partialId)).toEqual({ ...before.invoices.find((invoice) => invoice._id === partialId), invoiceNumber: `INV-${year}-00005` });
  });

  it("fails the migration closed when a proposed number is already used", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const targetId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "COLLISION-TARGET", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    const occupiedId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "COLLISION-OCCUPIED", invoiceDate: "2026-01-02", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    const occupiedNumber = `INV-${new Date().getUTCFullYear()}-00003`;
    await t.run(async (ctx) => {
      await ctx.db.patch(targetId, { invoiceNumber: "HIST-ODOO-COLLISION-TARGET" });
      await ctx.db.patch(occupiedId, { invoiceNumber: occupiedNumber, status: "paid" });
    });
    await expect(t.mutation(renumberOutstanding, { dryRun: true })).rejects.toThrow(`Invoice number collision detected for ${occupiedNumber}`);
    const result = await t.run(async (ctx) => ({ target: await ctx.db.get(targetId), occupied: await ctx.db.get(occupiedId) }));
    expect(result.target?.invoiceNumber).toBe("HIST-ODOO-COLLISION-TARGET");
    expect(result.occupied?.invoiceNumber).toBe(occupiedNumber);
  });

  it("creates an unpaid historical invoice without payment rows", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const invoiceId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId,
      originalReference: " S00066 ",
      invoiceDate: "2026-02-02",
      coverageStartMonth: "2026-02",
      monthsCovered: 2,
      monthlyAmount: 100,
      notes: "Still outstanding",
    });
    const result = await t.run(async (ctx) => ({
      invoice: await ctx.db.get(invoiceId),
      payments: await ctx.db.query("invoicePayments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
      events: await ctx.db.query("invoiceEvents").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
    }));
    expect(result.invoice).toMatchObject({
      isHistorical: true,
      sourceSystem: "odoo",
      originalReference: "S00066",
      normalizedOriginalReference: "S00066",
      status: "issued",
      amountPaid: 0,
      amountPaidCents: 0,
      balanceDue: 200,
      balanceDueCents: 20000,
      historicalCoverageStartMonth: "2026-02",
      historicalCoverageMonths: 2,
      notes: "Still outstanding",
    });
    expect(result.invoice?.revenueAllocations).toEqual([{ month: "2026-02", amount: 100 }, { month: "2026-03", amount: 100 }]);
    expect(result.payments).toHaveLength(0);
    expect(result.events.map((event) => event.type)).toEqual(["draft_created", "issued"]);
  });

  it("allows the normal payment flow to partially and fully pay an unpaid historical invoice", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const invoiceId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "PAY-1", invoiceDate: "2026-02-02", coverageStartMonth: "2026-02", monthsCovered: 2, monthlyAmount: 100,
    });
    await user.mutation(api.invoices.recordPayment, { invoiceId, amount: 40, paidAt: Date.UTC(2026, 1, 5), method: "Bank Transfer", receivingAccountId: s.accountId, transactionId: "PAY-1-A" });
    let invoice = await user.query(api.invoices.getById, { invoiceId });
    expect(invoice).toMatchObject({ status: "partially_paid", amountPaid: 40, balanceDue: 160 });
    await user.mutation(api.invoices.recordPayment, { invoiceId, amount: 160, paidAt: Date.UTC(2026, 1, 6), method: "Bank Transfer", receivingAccountId: s.accountId, transactionId: "PAY-1-B" });
    invoice = await user.query(api.invoices.getById, { invoiceId });
    expect(invoice).toMatchObject({ status: "paid", amountPaid: 200, balanceDue: 0 });
    const result = await t.run(async (ctx) => ({
      payments: await ctx.db.query("invoicePayments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
      events: await ctx.db.query("invoiceEvents").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
    }));
    expect(result.payments).toHaveLength(2);
    expect(result.events.map((event) => event.type)).toEqual(["draft_created", "issued", "payment_recorded", "payment_recorded"]);
  });

  it("guards duplicates while allowing the same reference for another customer", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const args = { companyId: s.companyId, originalReference: "INV/2026/00045", invoiceDate: "2026-01-04", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100, paymentDate: "2026-01-04" };
    await user.mutation(createHistorical, args);
    await expect(user.mutation(createHistorical, args)).rejects.toThrow("already exists");
    await expect(user.mutation(createHistorical, { ...args, originalReference: "OTHER-1" })).resolves.toBeDefined();
  });

  it("keeps normal records and validates receiving accounts", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    await expect(user.mutation(createHistorical, { companyId: s.companyId, originalReference: "BAD-1", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 10, paymentDate: "2026-01-01", receivingAccountId: s.accountId })).rejects.toThrow("transaction ID is required");
    const before = await t.run(async (ctx) => ({ companies: await ctx.db.query("companies").collect(), accounts: await ctx.db.query("receivingAccounts").collect() }));
    await user.mutation(createHistorical, { companyId: s.companyId, originalReference: "SAFE-1", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 10, paymentDate: "2026-01-01" });
    const after = await t.run(async (ctx) => ({ companies: await ctx.db.query("companies").collect(), accounts: await ctx.db.query("receivingAccounts").collect() }));
    expect(after.companies).toEqual(before.companies);
    expect(after.accounts).toEqual(before.accounts);
  });

  it("matches the existing payment application calculation for the imported paid total", () => {
    const normalPath = calculatePaymentApplication(
      { grandTotal: 17624.79, balanceDue: 17624.79, amountPaid: 0 } as never,
      17624.79,
    );
    expect(normalPath).toEqual({
      amount: 17624.79,
      appliedAmount: 17624.79,
      extraServiceRevenueAmount: 0,
      nextAmountPaid: 17624.79,
      nextBalanceDue: 0,
      nextStatus: "paid",
    });
  });
});
