import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { api } from "./_generated/api";
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
const createHistorical = (api as unknown as {
  historicalInvoices: { create: FunctionReference<"mutation", "public", Args, Id<"invoices">> };
}).historicalInvoices.create;

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
