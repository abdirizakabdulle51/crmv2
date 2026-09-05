import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

type Seed = {
  countryA: Id<"countries">;
  countryB: Id<"countries">;
  companyA: Id<"companies">;
  companyB: Id<"companies">;
  catalogItem: Id<"serviceCatalog">;
  categoryTravel: Id<"expenseCategories">;
  categoryOps: Id<"expenseCategories">;
  ceo: Doc<"users">;
  hob: Doc<"users">;
  gmA: Doc<"users">;
  amA: Doc<"users">;
};

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  return await t.run(async (ctx) => {
    const countryA = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const countryB = await ctx.db.insert("countries", {
      name: "Kenya",
      region: "East Africa",
    });
    const sector = await ctx.db.insert("sectors", { name: "Banking" });
    const ceoId = await ctx.db.insert("users", {
      name: "CEO",
      email: "ceo@example.com",
      tokenIdentifier: "ceo-token",
      role: "ceo",
    });
    const hobId = await ctx.db.insert("users", {
      name: "HOB",
      email: "hob@example.com",
      tokenIdentifier: "hob-token",
      role: "head_of_business",
    });
    const gmAId = await ctx.db.insert("users", {
      name: "GM A",
      email: "gm@example.com",
      tokenIdentifier: "gm-a-token",
      role: "country_gm",
      countryId: countryA,
    });
    const amAId = await ctx.db.insert("users", {
      name: "AM A",
      email: "am@example.com",
      tokenIdentifier: "am-a-token",
      role: "account_manager",
      countryId: countryA,
    });
    const companyA = await ctx.db.insert("companies", {
      name: "Company A",
      sectorId: sector,
      countryId: countryA,
      accountManagerId: amAId,
      contractStatus: "active",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Company B",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amAId,
      contractStatus: "active",
    });
    const catalogItem = await ctx.db.insert("serviceCatalog", {
      serviceCategory: "Compute",
      itemName: "ECS",
      billingUnit: "VM",
      monthlyPrice: 1,
    });
    const categoryTravel = await ctx.db.insert("expenseCategories", {
      name: "Travel",
      isActive: true,
      createdBy: ceoId,
      createdAt: 1,
      updatedAt: 1,
    });
    const categoryOps = await ctx.db.insert("expenseCategories", {
      name: "Cloud Operations",
      isActive: true,
      createdBy: ceoId,
      createdAt: 1,
      updatedAt: 1,
    });

    return {
      countryA,
      countryB,
      companyA,
      companyB,
      catalogItem,
      categoryTravel,
      categoryOps,
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gmA: (await ctx.db.get(gmAId))!,
      amA: (await ctx.db.get(amAId))!,
    };
  });
}

async function insertInvoiceWithPayment(
  t: ReturnType<typeof convexTest>,
  args: {
    companyId: Id<"companies">;
    createdBy: Id<"users">;
    status?: Doc<"invoices">["status"];
    paymentAmount: number;
    paidAt: number;
    isTest?: boolean;
    hiddenAt?: number;
    invoiceNumber?: string;
    sourceReference?: string;
    method?: string;
    reference?: string;
    receivingBankName?: string;
    receivingAccountNumber?: string;
    receivingAccountName?: string;
    receivingBankLocation?: string;
    receivingCurrencyNote?: string;
    lineItems?: Doc<"invoices">["lineItems"];
  },
) {
  return await t.run(async (ctx) => {
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: args.companyId,
      createdBy: args.createdBy,
      invoiceNumber: args.invoiceNumber ?? "INV-2026-00001",
      sourceReference: args.sourceReference,
      status: args.status ?? "paid",
      isTest: args.isTest,
      hiddenAt: args.hiddenAt,
      companyName: "Company",
      lineItems: args.lineItems ?? [],
      subtotal: args.paymentAmount,
      monthlyTotal: args.paymentAmount,
      yearlyTotal: args.paymentAmount,
      grandTotal: args.paymentAmount,
      amountPaid: args.paymentAmount,
      balanceDue: 0,
      createdAt: args.paidAt,
      updatedAt: args.paidAt,
    });
    await ctx.db.insert("invoicePayments", {
      invoiceId,
      amount: args.paymentAmount,
      paidAt: args.paidAt,
      method: args.method ?? "Bank Transfer",
      reference: args.reference,
      receivingBankName: args.receivingBankName,
      receivingAccountNumber: args.receivingAccountNumber,
      receivingAccountName: args.receivingAccountName,
      receivingBankLocation: args.receivingBankLocation,
      receivingCurrencyNote: args.receivingCurrencyNote,
      recordedBy: args.createdBy,
      createdAt: args.paidAt,
    });
    return invoiceId;
  });
}

function invoiceLineItem(
  catalogItemId: Id<"serviceCatalog">,
  args: {
    monthlyTotal: number;
    regionId?: string;
    regionName?: string;
    dataCenterName?: string;
  },
): Doc<"invoices">["lineItems"][number] {
  return {
    catalogItemId,
    itemName: "ECS",
    serviceCategory: "Compute",
    billingUnit: "VM",
    quantity: args.monthlyTotal,
    monthlyUnitPrice: 1,
    monthlyTotal: args.monthlyTotal,
    yearlyTotal: args.monthlyTotal * 12,
    regionId: args.regionId,
    regionName: args.regionName,
    dataCenterName: args.dataCenterName,
  };
}

async function insertExpense(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  args: {
    status: Doc<"expenseRequests">["status"];
    amount: number;
    categoryId?: Id<"expenseCategories">;
    companyId?: Id<"companies">;
    countryId?: Id<"countries">;
    expenseDate?: number;
    paidAt?: number;
    vendor?: string;
    paymentMethod?: string;
    paymentReference?: string;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("expenseRequests", {
      title: "Expense",
      categoryId: args.categoryId ?? s.categoryTravel,
      amount: args.amount,
      currency: "USD",
      expenseDate: args.expenseDate ?? Date.UTC(2026, 7, 1),
      vendor: args.vendor,
      requestedBy: s.amA._id,
      companyId: args.companyId ?? s.companyA,
      countryId: args.countryId ?? s.countryA,
      status: args.status,
      approvedBy: args.paidAt ? s.hob._id : undefined,
      paidAt: args.paidAt,
      paidBy: args.paidAt ? s.ceo._id : undefined,
      paymentMethod: args.paymentMethod,
      paymentReference: args.paymentReference,
      createdAt: args.expenseDate ?? Date.UTC(2026, 7, 1),
      updatedAt: args.paidAt ?? args.expenseDate ?? Date.UTC(2026, 7, 1),
    });
  });
}

describe("finance reports", () => {
  it("reports non-invoice funding separately from collections and revenue", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("receivingAccounts", {
        countryId: s.countryA,
        name: "Capital account",
        providerName: "Somalia Bank",
        accountNumber: "CAP-REPORT-1",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        usage: "both",
        currency: "USD",
        isActive: true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("accountTransactions", {
        accountId,
        countryId: s.countryA,
        currency: "USD",
        direction: "incoming",
        type: "capital_contribution",
        amount: 5000,
        amountCents: 500000,
        transactionDate: Date.UTC(2026, 7, 5),
        transactionId: "CAPITAL-REPORT-1",
        description: "Initial investment",
        createdBy: s.ceo._id,
        createdAt: Date.UTC(2026, 7, 5),
      });
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });
    expect(report.totals).toMatchObject({
      income: 0,
      recognizedRevenue: 0,
      capitalContributions: 5000,
      otherCashInflows: 5000,
      totalCashInflows: 5000,
    });
  });

  it("keeps returns separate and nets reversals against their original category", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await insertExpense(t, s, {
      status: "paid",
      amount: 100,
      paidAt: Date.UTC(2026, 7, 5),
    });
    await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("receivingAccounts", {
        countryId: s.countryA,
        name: "Operations account",
        providerName: "Somalia Bank",
        accountNumber: "REV-REPORT-1",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        usage: "both",
        currency: "USD",
        isActive: true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      });
      const capitalId = await ctx.db.insert("accountTransactions", {
        accountId,
        countryId: s.countryA,
        currency: "USD",
        direction: "incoming",
        type: "capital_contribution",
        amount: 5000,
        amountCents: 500000,
        transactionDate: Date.UTC(2026, 7, 1),
        transactionId: "CAPITAL-REVERSAL-1",
        description: "Capital contribution",
        createdBy: s.ceo._id,
        createdAt: Date.UTC(2026, 7, 1),
      });
      const returnId = await ctx.db.insert("accountTransactions", {
        accountId,
        countryId: s.countryA,
        currency: "USD",
        direction: "incoming",
        type: "expense_return",
        amount: 40,
        amountCents: 4000,
        transactionDate: Date.UTC(2026, 7, 10),
        transactionId: "EXPENSE-RETURN-1",
        expenseId,
        description: "Returned funds",
        createdBy: s.ceo._id,
        createdAt: Date.UTC(2026, 7, 10),
      });
      await ctx.db.insert("accountTransactions", {
        accountId,
        countryId: s.countryA,
        currency: "USD",
        direction: "outgoing",
        type: "reversal",
        amount: 5000,
        amountCents: 500000,
        transactionDate: Date.UTC(2026, 7, 11),
        transactionId: "CAPITAL-REVERSAL-1-R",
        relatedTransactionId: capitalId,
        description: "Reverse capital contribution",
        createdBy: s.ceo._id,
        createdAt: Date.UTC(2026, 7, 11),
      });
      await ctx.db.insert("accountTransactions", {
        accountId,
        countryId: s.countryA,
        currency: "USD",
        direction: "outgoing",
        type: "reversal",
        amount: 40,
        amountCents: 4000,
        transactionDate: Date.UTC(2026, 7, 12),
        transactionId: "EXPENSE-RETURN-1-R",
        expenseId,
        relatedTransactionId: returnId,
        description: "Reverse expense return",
        createdBy: s.ceo._id,
        createdAt: Date.UTC(2026, 7, 12),
      });
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });
    expect(report.totals.capitalContributions).toBe(0);
    expect(report.totals.otherCashInflows).toBe(0);
    expect(report.totals.expenseReturns).toBe(0);
    expect(report.totals.totalCashInflows).toBe(0);
    expect(report.totals.recognizedRevenue).toBe(0);
  });

  it("groups income by invoice payment paidAt and expenses by paidAt", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 300,
      paidAt: Date.UTC(2026, 7, 5),
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 125,
      paidAt: Date.UTC(2026, 7, 10),
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(report.monthly).toEqual([
      {
        month: "2026-08",
        income: 300,
        recognizedRevenue: 0,
        preCollected: 0,
        expectedCollections: 0,
        expenses: 125,
        incurredExpenses: 125,
        expenseReturns: 0,
        openingBalances: 0,
        capitalContributions: 0,
        otherNonInvoiceInflows: 0,
        otherCashInflows: 0,
        totalCashInflows: 300,
        netExpenses: 125,
        net: 175,
        operatingNet: -125,
        paymentCount: 1,
        paidExpenseCount: 1,
      },
    ]);
    expect(report.totals).toMatchObject({
      income: 300,
      recognizedRevenue: 0,
      expenses: 125,
      incurredExpenses: 125,
      net: 175,
      operatingNet: -125,
      paymentCount: 1,
    });
  });

  it("uses expenseDate for incurred expenses while cash remains on paidAt", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertExpense(t, s, {
      status: "paid",
      amount: 125,
      expenseDate: Date.UTC(2026, 6, 31),
      paidAt: Date.UTC(2026, 7, 2),
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-07",
      endMonth: "2026-08",
    });

    expect(report.monthly).toEqual([
      expect.objectContaining({
        month: "2026-07",
        incurredExpenses: 125,
        expenses: 0,
        operatingNet: -125,
      }),
      expect.objectContaining({
        month: "2026-08",
        incurredExpenses: 0,
        expenses: 125,
        operatingNet: 0,
      }),
    ]);
  });

  it("reports single region payment income fully to that region", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 300,
      paidAt: Date.UTC(2026, 7, 5),
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 300,
          regionId: "hoa-mog-2",
          regionName: "Hoa-Mogadishu-2",
        }),
      ],
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(report.incomeByRegion).toEqual([
      {
        region: "Hoa-Mogadishu-2",
        income: 300,
        paymentCount: 1,
        invoiceCount: 1,
      },
    ]);
    expect(report.totals.income).toBe(300);
  });

  it("splits payment income proportionally across invoice regions", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 50,
      paidAt: Date.UTC(2026, 7, 5),
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 70,
          regionName: "Hoa-Mogadishu-2",
        }),
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 30,
          regionName: "Mogadishu-region-hq3",
        }),
      ],
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(report.incomeByRegion).toEqual([
      {
        region: "Hoa-Mogadishu-2",
        income: 35,
        paymentCount: 1,
        invoiceCount: 1,
      },
      {
        region: "Mogadishu-region-hq3",
        income: 15,
        paymentCount: 1,
        invoiceCount: 1,
      },
    ]);
    expect(report.totals.income).toBe(50);
  });

  it("excludes Unassigned from region income while keeping it in totals", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 80,
      paidAt: Date.UTC(2026, 7, 5),
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 80,
        }),
      ],
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 20,
      paidAt: Date.UTC(2026, 7, 6),
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(report.incomeByRegion).toEqual([]);
    expect(report.totals.income).toBe(100);
  });

  it("excludes test hidden void and cancelled invoices from income", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      isTest: true,
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      hiddenAt: Date.UTC(2026, 7, 6),
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      status: "void",
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      status: "cancelled",
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(report.totals.income).toBe(0);
    expect(report.totals.paymentCount).toBe(0);
    expect(report.incomeByRegion).toEqual([]);
  });

  it("groups paid expenses by top category and summarizes statuses", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertExpense(t, s, {
      status: "paid",
      amount: 75,
      categoryId: s.categoryTravel,
      paidAt: Date.UTC(2026, 7, 1),
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 50,
      categoryId: s.categoryTravel,
      paidAt: Date.UTC(2026, 7, 2),
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 25,
      categoryId: s.categoryOps,
      paidAt: Date.UTC(2026, 7, 3),
    });
    await insertExpense(t, s, {
      status: "submitted",
      amount: 40,
      categoryId: s.categoryOps,
    });

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(report.topExpenseCategories[0]).toMatchObject({
      categoryName: "Travel",
      total: 125,
      count: 2,
    });
    expect(
      report.expenseStatusSummary.find((row) => row.status === "paid"),
    ).toMatchObject({ count: 3, total: 150 });
    expect(
      report.expenseStatusSummary.find((row) => row.status === "submitted"),
    ).toMatchObject({ count: 1, total: 40 });
  });

  it("scopes reports for CEO HOB and Country GM and blocks Account Managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 100,
          regionName: "Hoa-Mogadishu-2",
        }),
      ],
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyB,
      createdBy: s.ceo._id,
      paymentAmount: 300,
      paidAt: Date.UTC(2026, 7, 5),
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 300,
          regionName: "Nairobi-region",
        }),
      ],
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 25,
      companyId: s.companyA,
      countryId: s.countryA,
      paidAt: Date.UTC(2026, 7, 5),
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 75,
      companyId: s.companyB,
      countryId: s.countryB,
      paidAt: Date.UTC(2026, 7, 5),
    });

    const ceoReport = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });
    const hobReport = await asUser(t, s.hob).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
      countryId: s.countryA,
    });
    const gmReport = await asUser(t, s.gmA).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });

    expect(ceoReport.totals).toMatchObject({
      income: 400,
      expenses: 100,
      net: 300,
    });
    expect(hobReport.totals).toMatchObject({
      income: 100,
      expenses: 25,
      net: 75,
    });
    expect(gmReport.totals).toMatchObject({
      income: 100,
      expenses: 25,
      net: 75,
    });
    expect(gmReport.incomeByRegion).toEqual([
      {
        region: "Hoa-Mogadishu-2",
        income: 100,
        paymentCount: 1,
        invoiceCount: 1,
      },
    ]);
    await expect(
      asUser(t, s.amA).query(api.financeReports.summary, {
        startMonth: "2026-08",
        endMonth: "2026-08",
      }),
    ).rejects.toThrow("You do not have permission to view finance reports");
    await expect(
      asUser(t, s.gmA).query(api.financeReports.summary, {
        startMonth: "2026-08",
        endMonth: "2026-08",
        countryId: s.countryB,
      }),
    ).rejects.toThrow();
  });

  it("exports invoice payment rows by paidAt with joined accounting fields", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 300,
      paidAt: Date.UTC(2026, 7, 5),
      invoiceNumber: "INV-2026-00010",
      sourceReference: "Q-2026-00004",
      reference: "BANK-7788",
      receivingBankName: "Salaam Somali Bank",
      receivingAccountNumber: "33111777",
      receivingAccountName: "HTG CLOUDS LIMITED",
      receivingBankLocation: "MOGADISHU - SOMALIA",
      receivingCurrencyNote: "All fees are listed in USD",
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 99,
      paidAt: Date.UTC(2026, 6, 31),
    });

    const rows = await asUser(t, s.ceo).query(
      api.financeReports.invoicePaymentsExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNumber: "INV-2026-00010",
      customerCompany: "Company",
      country: "Somalia",
      amount: 300,
      currency: "USD",
      paymentMethod: "Bank Transfer",
      customerReference: "BANK-7788",
      receivingBankName: "Salaam Somali Bank",
      receivingAccountNumber: "33111777",
      receivingAccountName: "HTG CLOUDS LIMITED",
      receivingBankLocation: "MOGADISHU - SOMALIA",
      receivingCurrencyNote: "All fees are listed in USD",
      recordedByName: "CEO",
      recordedByEmail: "ceo@example.com",
      invoiceStatus: "paid",
      sourceReference: "Q-2026-00004",
    });
  });

  it("exports region income rows by payment allocation", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 50,
      paidAt: Date.UTC(2026, 7, 5),
      invoiceNumber: "INV-2026-00020",
      sourceReference: "Q-2026-00005",
      reference: "BANK-REGION",
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 70,
          regionName: "Hoa-Mogadishu-2",
        }),
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 30,
          regionName: "Mogadishu-region-hq3",
        }),
      ],
    });

    const rows = await asUser(t, s.ceo).query(
      api.financeReports.invoicePaymentsByRegionExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({
        invoiceNumber: "INV-2026-00020",
        customerCompany: "Company",
        country: "Somalia",
        region: "Hoa-Mogadishu-2",
        allocatedAmount: 35,
        originalPaymentAmount: 50,
        paymentMethod: "Bank Transfer",
        customerReference: "BANK-REGION",
        recordedByName: "CEO",
        recordedByEmail: "ceo@example.com",
        invoiceStatus: "paid",
        sourceReference: "Q-2026-00005",
      }),
      expect.objectContaining({
        region: "Mogadishu-region-hq3",
        allocatedAmount: 15,
        originalPaymentAmount: 50,
      }),
    ]);
  });

  it("exports one region income row for single region invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 300,
      paidAt: Date.UTC(2026, 7, 5),
      lineItems: [
        invoiceLineItem(s.catalogItem, {
          monthlyTotal: 300,
          regionId: "hoa-mog-2",
          regionName: "Hoa-Mogadishu-2",
        }),
      ],
    });

    const rows = await asUser(t, s.ceo).query(
      api.financeReports.invoicePaymentsByRegionExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      region: "Hoa-Mogadishu-2",
      allocatedAmount: 300,
      originalPaymentAmount: 300,
    });
  });

  it("excludes Unassigned from legacy invoice region income export", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 80,
      paidAt: Date.UTC(2026, 7, 5),
    });

    const rows = await asUser(t, s.ceo).query(
      api.financeReports.invoicePaymentsByRegionExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(rows).toEqual([]);
  });

  it("excludes test hidden void and cancelled invoices from payment export", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      isTest: true,
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      hiddenAt: Date.UTC(2026, 7, 6),
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      status: "void",
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
      status: "cancelled",
    });

    const rows = await asUser(t, s.ceo).query(
      api.financeReports.invoicePaymentsExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(rows).toEqual([]);
  });

  it("exports paid expenses by paidAt with joined finance fields", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertExpense(t, s, {
      status: "paid",
      amount: 125,
      paidAt: Date.UTC(2026, 7, 10),
      vendor: "Hotel",
      paymentMethod: "Bank Transfer",
      paymentReference: "EXP-REF",
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 75,
      paidAt: Date.UTC(2026, 6, 30),
    });
    await insertExpense(t, s, {
      status: "approved",
      amount: 50,
      paidAt: Date.UTC(2026, 7, 10),
    });

    const rows = await asUser(t, s.ceo).query(
      api.financeReports.paidExpensesExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Expense",
      category: "Travel",
      requesterName: "AM A",
      requesterEmail: "am@example.com",
      company: "Company A",
      country: "Somalia",
      vendor: "Hotel",
      amount: 125,
      currency: "USD",
      paymentMethod: "Bank Transfer",
      paymentReference: "EXP-REF",
      approvedByName: "HOB",
      approvedByEmail: "hob@example.com",
      paidByName: "CEO",
      paidByEmail: "ceo@example.com",
      status: "paid",
    });
  });

  it("scopes export rows for Country GM and blocks Account Managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await insertInvoiceWithPayment(t, {
      companyId: s.companyA,
      createdBy: s.ceo._id,
      paymentAmount: 100,
      paidAt: Date.UTC(2026, 7, 5),
    });
    await insertInvoiceWithPayment(t, {
      companyId: s.companyB,
      createdBy: s.ceo._id,
      paymentAmount: 300,
      paidAt: Date.UTC(2026, 7, 5),
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 25,
      companyId: s.companyA,
      countryId: s.countryA,
      paidAt: Date.UTC(2026, 7, 5),
    });
    await insertExpense(t, s, {
      status: "paid",
      amount: 75,
      companyId: s.companyB,
      countryId: s.countryB,
      paidAt: Date.UTC(2026, 7, 5),
    });

    const gmPayments = await asUser(t, s.gmA).query(
      api.financeReports.invoicePaymentsExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );
    const gmExpenses = await asUser(t, s.gmA).query(
      api.financeReports.paidExpensesExport,
      {
        startMonth: "2026-08",
        endMonth: "2026-08",
      },
    );

    expect(gmPayments).toHaveLength(1);
    expect(gmPayments[0].amount).toBe(100);
    expect(gmExpenses).toHaveLength(1);
    expect(gmExpenses[0].amount).toBe(25);
    await expect(
      asUser(t, s.amA).query(api.financeReports.invoicePaymentsExport, {
        startMonth: "2026-08",
        endMonth: "2026-08",
      }),
    ).rejects.toThrow("You do not have permission to view finance reports");
    await expect(
      asUser(t, s.amA).query(api.financeReports.paidExpensesExport, {
        startMonth: "2026-08",
        endMonth: "2026-08",
      }),
    ).rejects.toThrow("You do not have permission to view finance reports");
  });

  it("reports expense returns without changing cash or incurred-date semantics", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await insertExpense(t, s, {
      status: "paid",
      amount: 100,
      companyId: s.companyA,
      countryId: s.countryA,
      expenseDate: Date.UTC(2026, 7, 5),
      paidAt: Date.UTC(2026, 7, 10),
    });
    const accountId = await t.run((ctx) =>
      ctx.db.insert("receivingAccounts", {
        countryId: s.countryA,
        name: "Somalia Collections",
        providerName: "Somalia Bank",
        accountNumber: "SO-REPORT-1",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        usage: "both",
        currency: "USD",
        isActive: true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("accountTransactions", {
        accountId,
        countryId: s.countryA,
        currency: "USD",
        direction: "incoming",
        type: "expense_return",
        amount: 40,
        amountCents: 4000,
        transactionDate: Date.UTC(2026, 7, 15),
        transactionId: "RETURN-REPORT-40",
        expenseId,
        description: "Unused funds returned",
        createdBy: s.ceo._id,
        createdAt: Date.UTC(2026, 7, 15),
      }),
    );

    const report = await asUser(t, s.ceo).query(api.financeReports.summary, {
      startMonth: "2026-08",
      endMonth: "2026-08",
    });
    expect(report.totals.expenses).toBe(100);
    expect(report.totals.expenseReturns).toBe(40);
    expect(report.totals.netExpenses).toBe(60);
    expect(report.totals.net).toBe(-60);
    expect(report.totals.incurredExpenses).toBe(60);
    expect(report.totals.operatingNet).toBe(-60);
  });
});
