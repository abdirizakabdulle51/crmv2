import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import type { MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { correctHistoricalInvoiceDescriptions } from "./historicalInvoices";
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
  itemDescription?: string;
  paymentDate: string;
  paymentMethod?: string;
  receivingAccountId?: Id<"receivingAccounts">;
  paymentReference?: string;
  transactionId?: string;
  notes?: string;
};
type UnpaidArgs = Omit<Args, "paymentDate" | "paymentMethod" | "receivingAccountId" | "paymentReference" | "transactionId">;
type DescriptionCorrectionRow = {
  invoiceId: Id<"invoices">;
  invoiceNumber: string;
  companyName: string;
  originalReference: string;
  oldItemName: string;
  newItemName: string;
  serviceCategory: string;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  status: Doc<"invoices">["status"];
};
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
const correctOutstandingDueDates = (internal as unknown as {
  historicalInvoices: { correctOutstandingDueDates: FunctionReference<"mutation", "internal", { dryRun: boolean; confirm?: string }, unknown> };
}).historicalInvoices.correctOutstandingDueDates;

const DESCRIPTION_TARGETS = [
  {
    invoiceId: "ph7db1cvdarxkvxqcpqem93dqs8e23nt",
    invoiceNumber: "INV-2026-00037",
    companyName: "NationalCivilServiceCommission",
    originalReference: "INV/2026/JLY",
  },
  {
    invoiceId: "ph747dg07ccpthk0wvce4qbdbd8e2p11",
    invoiceNumber: "INV-2026-00038",
    companyName: "NationalCivilServiceCommission",
    originalReference: "INV/2026/00070",
  },
  {
    invoiceId: "ph77jmc4s0h0nt6p6v5ng3rfxn8e35sx",
    invoiceNumber: "INV-2026-00039",
    companyName: "NationalCivilServiceCommission",
    originalReference: "INV/2026/SEPT",
  },
  {
    invoiceId: "ph7aevwpxfw6785a4yn33kb71x8dzcjj",
    invoiceNumber: "INV-2026-00043",
    companyName: "SAB",
    originalReference: "SAB-AUG-2026",
  },
] as const;
const CORRECTED_ITEM_NAME = "Compute, Storage and Network Services";

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

type DescriptionInvoice = Pick<
  Doc<"invoices">,
  | "_id"
  | "invoiceNumber"
  | "companyName"
  | "originalReference"
  | "isHistorical"
  | "lineItems"
  | "grandTotal"
  | "amountPaid"
  | "balanceDue"
  | "status"
>;
type DescriptionLine = Doc<"invoices">["lineItems"][number];
type DescriptionCorrectionArgs = { dryRun: boolean; confirm?: string };
type DescriptionCorrectionHandler = (
  ctx: MutationCtx,
  args: DescriptionCorrectionArgs,
) => Promise<DescriptionCorrectionRow[]>;
type DescriptionPatch = {
  invoiceId: Id<"invoices">;
  lineItems: DescriptionInvoice["lineItems"];
};

const correctHistoricalInvoiceDescriptionsHandler = (
  correctHistoricalInvoiceDescriptions as unknown as {
    _handler: DescriptionCorrectionHandler;
  }
)._handler;

function makeDescriptionLine(itemName: string): DescriptionLine {
  return {
    itemName,
    serviceCategory: "Historical Invoice",
    billingUnit: "month",
    quantity: 1,
    monthlyUnitPrice: 100,
    monthlyTotal: 100,
    yearlyTotal: 100,
  };
}

function makeDescriptionInvoice(
  target: (typeof DESCRIPTION_TARGETS)[number],
  overrides: Partial<DescriptionInvoice> = {},
): DescriptionInvoice {
  return {
    _id: target.invoiceId as Id<"invoices">,
    invoiceNumber: target.invoiceNumber,
    companyName: target.companyName,
    originalReference: target.originalReference,
    isHistorical: true,
    lineItems: [
      makeDescriptionLine("Historical Odoo coverage (2026-07)"),
      makeDescriptionLine("Unrelated second line"),
    ],
    grandTotal: 100,
    amountPaid: 0,
    balanceDue: 100,
    status: "issued",
    ...overrides,
  };
}

function createDescriptionTestContext(invoices: DescriptionInvoice[]) {
  const records = new Map(
    invoices.map((invoice) => [String(invoice._id), invoice]),
  );
  const patches: DescriptionPatch[] = [];
  const ctx = {
    db: {
      get: async (invoiceId: Id<"invoices">) =>
        records.get(String(invoiceId)) ?? null,
      patch: async (
        invoiceId: Id<"invoices">,
        value: { lineItems: DescriptionInvoice["lineItems"] },
      ) => {
        const invoice = records.get(String(invoiceId));
        if (!invoice) throw new Error(`Missing test invoice ${invoiceId}`);
        patches.push({ invoiceId, lineItems: value.lineItems });
        records.set(String(invoiceId), { ...invoice, lineItems: value.lineItems });
      },
    },
  } as unknown as MutationCtx;

  return { ctx, records, patches };
}

describe("historical paid invoices", () => {
  it("uses exact IDs, ignores duplicate invoice numbers, and patches only itemName", async () => {
    const duplicateInvoices = DESCRIPTION_TARGETS.slice(0, 3).map(
      (target, index) =>
        makeDescriptionInvoice(target, {
          _id: `ebir-duplicate-${index}` as Id<"invoices">,
          companyName: "EBIR",
          originalReference: `EBIR-${index + 1}`,
        }),
    );
    const invoices = [
      ...DESCRIPTION_TARGETS.map((target) => makeDescriptionInvoice(target)),
      ...duplicateInvoices,
      makeDescriptionInvoice(DESCRIPTION_TARGETS[3], {
        _id: "unrelated-historical" as Id<"invoices">,
        companyName: "Other Customer",
        originalReference: "OTHER-REFERENCE",
      }),
    ];
    const testContext = createDescriptionTestContext(invoices);
    const before = Array.from(testContext.records.values()).map((invoice) => ({
      ...invoice,
      lineItems: invoice.lineItems.map((line) => ({ ...line })),
    }));

    const dryRun = await correctHistoricalInvoiceDescriptionsHandler(
      testContext.ctx,
      { dryRun: true },
    );
    expect(dryRun).toHaveLength(4);
    expect(dryRun.map((row) => row.invoiceId)).toEqual(
      DESCRIPTION_TARGETS.map((target) => target.invoiceId),
    );
    expect(dryRun).toEqual(
      DESCRIPTION_TARGETS.map((target) =>
        expect.objectContaining({
          invoiceId: target.invoiceId,
          invoiceNumber: target.invoiceNumber,
          companyName: target.companyName,
          originalReference: target.originalReference,
          oldItemName: "Historical Odoo coverage (2026-07)",
          newItemName: CORRECTED_ITEM_NAME,
          serviceCategory: "Historical Invoice",
          status: "issued",
        }),
      ),
    );
    expect(testContext.patches).toHaveLength(0);
    expect(Array.from(testContext.records.values())).toEqual(before);

    await expect(
      correctHistoricalInvoiceDescriptionsHandler(testContext.ctx, {
        dryRun: false,
        confirm: "WRONG_CONFIRMATION",
      }),
    ).rejects.toThrow("Exact confirmation required");
    expect(testContext.patches).toHaveLength(0);

    await correctHistoricalInvoiceDescriptionsHandler(testContext.ctx, {
      dryRun: false,
      confirm: "CORRECT_HISTORICAL_INVOICE_DESCRIPTIONS",
    });
    expect(testContext.patches.map((patch) => String(patch.invoiceId))).toEqual(
      DESCRIPTION_TARGETS.map((target) => target.invoiceId),
    );
    for (const target of DESCRIPTION_TARGETS) {
      const original = before.find(
        (invoice) => String(invoice._id) === target.invoiceId,
      );
      const updated = testContext.records.get(target.invoiceId);
      expect(updated).toEqual({
        ...original,
        lineItems: original?.lineItems.map((line, lineIndex) =>
          lineIndex === 0 ? { ...line, itemName: CORRECTED_ITEM_NAME } : line,
        ),
      });
    }
    for (const duplicate of duplicateInvoices) {
      expect(testContext.records.get(String(duplicate._id))).toEqual(duplicate);
    }
  });

  it("requires all four exact targets and fails closed on every target guard", async () => {
    const invalidCases: Array<{
      name: string;
      overrides: Partial<DescriptionInvoice>;
    }> = [
      { name: "wrong invoice number", overrides: { invoiceNumber: "INV-2026-99999" } },
      { name: "wrong company", overrides: { companyName: "Wrong Company" } },
      { name: "wrong reference", overrides: { originalReference: "WRONG-REFERENCE" } },
      { name: "non-historical", overrides: { isHistorical: false } },
      {
        name: "wrong old description",
        overrides: {
          lineItems: [makeDescriptionLine("Already corrected")],
        },
      },
    ];

    for (const invalidCase of invalidCases) {
      const invoices = DESCRIPTION_TARGETS.map((target, index) =>
        makeDescriptionInvoice(
          target,
          index === 0 ? invalidCase.overrides : undefined,
        ),
      );
      const testContext = createDescriptionTestContext(invoices);
      await expect(
        correctHistoricalInvoiceDescriptionsHandler(testContext.ctx, {
          dryRun: true,
        }),
      ).rejects.toThrow("not an eligible historical description correction target");
      expect(testContext.patches).toHaveLength(0);
    }

    const missingTargetContext = createDescriptionTestContext(
      DESCRIPTION_TARGETS.slice(1).map((target) => makeDescriptionInvoice(target)),
    );
    await expect(
      correctHistoricalInvoiceDescriptionsHandler(missingTargetContext.ctx, {
        dryRun: true,
      }),
    ).rejects.toThrow("not an eligible historical description correction target");
    expect(missingTargetContext.patches).toHaveLength(0);
  });

  it("records a paid multi-month invoice with exact existing money semantics", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const invoiceId = await user.mutation(createHistorical, {
      companyId: s.companyId, originalReference: "S00065", invoiceDate: "2026-05-14", coverageStartMonth: "2026-05", monthsCovered: 3, monthlyAmount: 5874.93, itemDescription: "Managed cloud services", paymentDate: "2026-05-14", receivingAccountId: s.accountId, transactionId: "ODOO-S00065", paymentReference: "Paid in Odoo",
    });
    const result = await t.run(async (ctx) => ({
      invoice: await ctx.db.get(invoiceId),
      payments: await ctx.db.query("invoicePayments").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
      events: await ctx.db.query("invoiceEvents").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect(),
      contracts: await ctx.db.query("customerContracts").collect(),
      quotes: await ctx.db.query("quotes").collect(),
      leads: await ctx.db.query("leads").collect(),
    }));
    expect(result.invoice).toMatchObject({ isHistorical: true, sourceSystem: "odoo", originalReference: "S00065", issueDate: Date.UTC(2026, 4, 14), dueDate: Date.UTC(2026, 4, 14), status: "paid", grandTotal: 17624.79, grandTotalCents: 1762479, amountPaid: 17624.79, amountPaidCents: 1762479, balanceDue: 0, balanceDueCents: 0, historicalCoverageStartMonth: "2026-05", historicalCoverageMonths: 3 });
    expect(result.invoice?.invoiceNumber).toBe(`INV-${new Date().getUTCFullYear()}-00001`);
    expect(result.invoice?.revenueAllocations).toEqual([{ month: "2026-05", amount: 5874.93 }, { month: "2026-06", amount: 5874.93 }, { month: "2026-07", amount: 5874.93 }]);
    expect(result.invoice?.lineItems[0]?.itemName).toBe("Managed cloud services");
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
      issueDate: Date.UTC(2026, 1, 2),
      dueDate: Date.UTC(2026, 1, 9),
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

  it.each([15, 30] as const)(
    "uses company Net %s terms for unpaid historical invoices",
    async (paymentTermDays) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      await t.run(async (ctx) => {
        await ctx.db.patch(s.companyId, { paymentTermDays });
      });
      const user = t.withIdentity({ tokenIdentifier: "historical-test" });
      const invoiceId = await user.mutation(createHistoricalUnpaid, {
        companyId: s.companyId,
        originalReference: `TERMS-${paymentTermDays}`,
        invoiceDate: "2026-02-02",
        coverageStartMonth: "2026-02",
        monthsCovered: 1,
        monthlyAmount: 100,
      });
      const invoice = await user.query(api.invoices.getById, { invoiceId });
      expect(invoice.issueDate).toBe(Date.UTC(2026, 1, 2));
      expect(invoice.dueDate).toBe(
        Date.UTC(2026, 1, 2) + paymentTermDays * 24 * 60 * 60 * 1000,
      );
    },
  );

  it("corrects only outstanding historical due dates in a dry run and execution", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const issuedId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "DUE-ISSUED", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    const paidId = await user.mutation(createHistorical, {
      companyId: s.companyId, originalReference: "DUE-PAID", invoiceDate: "2026-01-02", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100, paymentDate: "2026-01-02",
    });
    const zeroBalanceId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "DUE-ZERO", invoiceDate: "2026-01-03", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    const overdueId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "DUE-OVERDUE", invoiceDate: "2026-01-04", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(issuedId, { dueDate: Date.UTC(2026, 0, 1) });
      await ctx.db.patch(paidId, { dueDate: Date.UTC(2026, 0, 2) });
      await ctx.db.patch(zeroBalanceId, { dueDate: Date.UTC(2026, 0, 3), amountPaid: 100, balanceDue: 0, amountPaidCents: 10000, balanceDueCents: 0, status: "paid" });
      await ctx.db.patch(overdueId, { dueDate: Date.UTC(2026, 0, 4), status: "overdue" });
    });
    const before = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
    }));
    await expect(t.mutation(correctOutstandingDueDates, { dryRun: false })).rejects.toThrow("Exact confirmation required");
    const preview = await t.mutation(correctOutstandingDueDates, { dryRun: true });
    expect(preview).toEqual([
      expect.objectContaining({ invoiceId: issuedId, status: "issued", issueDate: Date.UTC(2026, 0, 1), oldDueDate: Date.UTC(2026, 0, 1), newDueDate: Date.UTC(2026, 0, 8), balanceDue: 100, companyId: s.companyId, paymentTermDays: 7 }),
      expect.objectContaining({ invoiceId: overdueId, status: "overdue", issueDate: Date.UTC(2026, 0, 4), oldDueDate: Date.UTC(2026, 0, 4), newDueDate: Date.UTC(2026, 0, 11), balanceDue: 100, companyId: s.companyId, paymentTermDays: 7 }),
    ]);
    expect(await t.run(async (ctx) => ({ invoices: await ctx.db.query("invoices").collect() }))).toEqual(before);
    await t.mutation(correctOutstandingDueDates, { dryRun: false, confirm: "CORRECT_OUTSTANDING_HISTORICAL_DUE_DATES" });
    const after = await t.run(async (ctx) => ({ invoices: await ctx.db.query("invoices").collect() }));
    expect(after.invoices.find((invoice) => invoice._id === paidId)).toEqual(before.invoices.find((invoice) => invoice._id === paidId));
    expect(after.invoices.find((invoice) => invoice._id === zeroBalanceId)).toEqual(before.invoices.find((invoice) => invoice._id === zeroBalanceId));
    expect(after.invoices.find((invoice) => invoice._id === issuedId)).toEqual({ ...before.invoices.find((invoice) => invoice._id === issuedId), dueDate: Date.UTC(2026, 0, 8) });
    expect(after.invoices.find((invoice) => invoice._id === overdueId)).toEqual({ ...before.invoices.find((invoice) => invoice._id === overdueId), dueDate: Date.UTC(2026, 0, 11) });
  });

  it("reuses the existing overdue marker and payment flow for historical invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const user = t.withIdentity({ tokenIdentifier: "historical-test" });
    const invoiceId = await user.mutation(createHistoricalUnpaid, {
      companyId: s.companyId, originalReference: "OVERDUE-PAY", invoiceDate: "2026-01-01", coverageStartMonth: "2026-01", monthsCovered: 1, monthlyAmount: 100,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(invoiceId, { dueDate: Date.UTC(2026, 0, 1) });
    });
    const correction = await t.mutation(correctOutstandingDueDates, {
      dryRun: false,
      confirm: "CORRECT_OUTSTANDING_HISTORICAL_DUE_DATES",
    });
    expect(correction).toEqual([
      expect.objectContaining({
        invoiceId,
        oldDueDate: Date.UTC(2026, 0, 1),
        newDueDate: Date.UTC(2026, 0, 8),
      }),
    ]);
    const overdueResult = await t.mutation(internal.invoices.markOverdueInvoices, {
      now: Date.UTC(2026, 0, 20, 12),
    });
    expect(overdueResult).toEqual({ updated: 1 });
    await user.mutation(api.invoices.recordPayment, {
      invoiceId, amount: 100, receivingAccountId: s.accountId, transactionId: "OVERDUE-HIST-1",
    });
    const invoice = await user.query(api.invoices.getById, { invoiceId });
    expect(invoice).toMatchObject({ status: "paid", amountPaid: 100, balanceDue: 0 });
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
