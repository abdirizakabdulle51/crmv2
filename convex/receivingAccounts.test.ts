import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const countryA = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const countryB = await ctx.db.insert("countries", {
      name: "Kenya",
      region: "East Africa",
    });
    const ceoId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "ceo-accounts",
      role: "ceo",
    });
    const gmAId = await ctx.db.insert("users", {
      name: "GM A",
      tokenIdentifier: "gm-a-accounts",
      role: "country_gm",
      countryId: countryA,
    });
    const gmBId = await ctx.db.insert("users", {
      name: "GM B",
      tokenIdentifier: "gm-b-accounts",
      role: "country_gm",
      countryId: countryB,
    });
    const institutionId = await ctx.db.insert("financialInstitutions", {
      countryId: countryA,
      name: "Somalia Bank",
      normalizedName: "somalia bank",
      type: "bank",
      isActive: true,
      createdBy: ceoId,
      createdAt: 1,
      updatedAt: 1,
    });
    return {
      countryA,
      countryB,
      institutionId,
      ceo: (await ctx.db.get(ceoId))!,
      gmA: (await ctx.db.get(gmAId))!,
      gmB: (await ctx.db.get(gmBId))!,
    };
  });
}

describe("finance accounts", () => {
  async function createAccount(
    t: ReturnType<typeof convexTest>,
    s: Awaited<ReturnType<typeof seed>>,
    overrides: Partial<{
      usage: "incoming" | "outgoing" | "both";
      currency: string;
      isActive: boolean;
    }> = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("receivingAccounts", {
        countryId: s.countryA,
        name: "Operations USD",
        providerName: "Somalia Bank",
        accountNumber: "SO-100",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        usage: overrides.usage ?? "both",
        currency: overrides.currency ?? "USD",
        isActive: overrides.isActive ?? true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
  }

  it("keeps non-invoice inflows in the account ledger, not collections", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await createAccount(t, s);

    await asUser(t, s.ceo).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
      accountId,
      type: "opening_balance",
      amount: 500,
      transactionDate: 1000,
      transactionId: "OPEN-500",
      description: "Opening balance",
    });
    await asUser(t, s.ceo).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
      accountId,
      type: "capital_contribution",
      amount: 250,
      transactionDate: 1000,
      transactionId: "CAP-250",
      description: "Capital contribution",
    });

    const ledger = await asUser(t, s.ceo).query(api.receivingAccounts.ledger, {
      accountId,
      startDate: 0,
      endDate: Date.now(),
    });
    expect(ledger.accountBalance).toBe(750);
    expect(ledger.rows).toHaveLength(2);

    const collections = await asUser(t, s.ceo).query(api.receivingAccounts.collections, {
      startDate: 0,
      endDate: Date.now(),
      accountId,
    });
    expect(collections.rows).toHaveLength(0);
    expect(collections.totalsByCurrency).toHaveLength(0);

    await expect(
      asUser(t, s.ceo).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
        accountId,
        type: "opening_balance",
        amount: 1,
        transactionDate: 1000,
        transactionId: "OPEN-SECOND",
        description: "Duplicate opening balance",
      }),
    ).rejects.toThrow("active opening balance");
  });

  it("rejects a new account transaction that reuses a historical bank transaction ID", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await createAccount(t, s);
    const invoiceId = await t.run(async (ctx) => {
      const sectorId = await ctx.db.insert("sectors", { name: "Banking" });
      const companyId = await ctx.db.insert("companies", {
        name: "Historical Company",
        sectorId,
        countryId: s.countryA,
        contractStatus: "active",
      });
      return await ctx.db.insert("invoices", {
        companyId,
        createdBy: s.ceo._id,
        status: "paid",
        companyName: "Historical Company",
        lineItems: [],
        subtotal: 100,
        monthlyTotal: 100,
        yearlyTotal: 100,
        grandTotal: 100,
        amountPaid: 100,
        balanceDue: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await t.run((ctx) =>
      ctx.db.insert("invoicePayments", {
        invoiceId,
        receivingAccountId: accountId,
        amount: 100,
        paidAt: 1000,
        transactionId: "BANK-TRAN-001",
        recordedBy: s.ceo._id,
        createdAt: 1000,
      }),
    );

    await expect(
      asUser(t, s.ceo).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
        accountId,
        type: "other_non_invoice_inflow",
        amount: 25,
        transactionDate: 1000,
        transactionId: "BANK-TRAN-001",
        description: "Duplicate bank transaction",
      }),
    ).rejects.toThrow("already recorded");
  });

  it("records, limits, and reverses expense returns without changing the expense", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await createAccount(t, s);
    const expenseId = await t.run(async (ctx) => {
      const categoryId = await ctx.db.insert("expenseCategories", {
        name: "Operations",
        isActive: true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("expenseRequests", {
        title: "Paid expense",
        categoryId,
        amount: 100,
        currency: "USD",
        expenseDate: 1000,
        requestedBy: s.ceo._id,
        countryId: s.countryA,
        status: "paid",
        paidAt: 1000,
        paidBy: s.ceo._id,
        fundingAccountId: accountId,
        paymentTransactionId: "EXPENSE-100",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const returnId = await asUser(t, s.ceo).mutation(
      api.receivingAccounts.recordExpenseReturn,
      {
        expenseId,
        accountId,
        amount: 40,
        transactionDate: 2000,
        transactionId: "RETURN-40",
        reason: "Unused funds returned",
      },
    );
    const summary = await asUser(t, s.ceo).query(
      api.receivingAccounts.expenseReturns,
      { expenseId },
    );
    expect(summary.returnedAmount).toBe(40);
    expect(summary.actualAmount).toBe(60);
    expect(summary.entries).toHaveLength(1);

    const original = await t.run((ctx) => ctx.db.get(expenseId));
    expect(original).toMatchObject({ amount: 100, status: "paid" });

    await expect(
      asUser(t, s.ceo).mutation(api.receivingAccounts.recordExpenseReturn, {
        expenseId,
        accountId,
        amount: 61,
        transactionDate: 2000,
        transactionId: "RETURN-61",
        reason: "Too much",
      }),
    ).rejects.toThrow("cannot exceed");

    await asUser(t, s.ceo).mutation(
      api.receivingAccounts.reverseAccountTransaction,
      {
        transactionId: returnId,
        reversalTransactionId: "RETURN-40-REVERSAL",
        transactionDate: 3000,
        reason: "Return corrected",
      },
    );
    const reversedSummary = await asUser(t, s.ceo).query(
      api.receivingAccounts.expenseReturns,
      { expenseId },
    );
    expect(reversedSummary.returnedAmount).toBe(0);
    expect(reversedSummary.entries).toHaveLength(2);
  });

  it("registers country banks once and blocks country managers from managing them", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(api.financialInstitutions.create, {
      countryId: s.countryB,
      name: " Kenya  Commercial Bank ",
      type: "bank",
      swiftCode: "kcbkenx",
    });
    await expect(
      asUser(t, s.ceo).mutation(api.financialInstitutions.create, {
        countryId: s.countryB,
        name: "kenya commercial bank",
        type: "bank",
      }),
    ).rejects.toThrow("already registered");
    await expect(
      asUser(t, s.gmB).mutation(api.financialInstitutions.create, {
        countryId: s.countryB,
        name: "Another Bank",
        type: "bank",
      }),
    ).rejects.toThrow("Only CEO or Head of Business");
  });
  it("normalizes account numbers and rejects duplicates within a registered bank", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const values = {
      countryId: s.countryA,
      institutionId: s.institutionId,
      name: "Operations USD",
      accountNumber: "SO-10 01",
      accountHolderName: "HTG",
      type: "bank" as const,
      usage: "both" as const,
      currency: "USD",
    };
    await asUser(t, s.ceo).mutation(api.receivingAccounts.create, values);
    await expect(
      asUser(t, s.ceo).mutation(api.receivingAccounts.create, {
        ...values,
        name: "Duplicate",
        accountNumber: "so1001",
      }),
    ).rejects.toThrow("already exists");
  });
  it("requires country ownership and scopes account visibility by country", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await asUser(t, s.ceo).mutation(
      api.receivingAccounts.create,
      {
        countryId: s.countryA,
        institutionId: s.institutionId,
        name: "Somalia Bank USD",
        providerName: "Somalia Bank",
        accountNumber: "SO-100",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        usage: "both",
        currency: "USD",
      },
    );
    expect(
      (await asUser(t, s.gmA).query(api.receivingAccounts.list, {})).map(
        (row) => row._id,
      ),
    ).toContain(accountId);
    expect(
      await asUser(t, s.gmB).query(api.receivingAccounts.list, {}),
    ).toHaveLength(0);
  });

  it("allows controlled descriptive edits while preserving account identity", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await asUser(t, s.ceo).mutation(
      api.receivingAccounts.create,
      {
        countryId: s.countryA,
        institutionId: s.institutionId,
        name: "Original",
        providerName: "Somalia Bank",
        accountNumber: "SO-200",
        accountHolderName: "HTG",
        type: "bank",
        usage: "incoming",
        currency: "USD",
      },
    );
    await asUser(t, s.ceo).mutation(api.receivingAccounts.update, {
      accountId,
      countryId: s.countryA,
      name: "Operations USD",
      accountHolderName: "HTG CLOUDS LIMITED",
      usage: "both",
    });
    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account).toMatchObject({
      name: "Operations USD",
      providerName: "Somalia Bank",
      accountNumber: "SO-200",
      usage: "both",
    });
  });

  it("reconciles legacy accounts and prevents disabling a bank in active use", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("receivingAccounts", {
        countryId: s.countryB,
        name: "Legacy collections",
        providerName: "Kenya Bank",
        accountNumber: "KE 001",
        accountHolderName: "HTG",
        type: "bank",
        usage: "both",
        currency: "USD",
        isActive: true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    expect(
      await asUser(t, s.ceo).mutation(
        api.receivingAccounts.migrateLegacyInstitutions,
        {},
      ),
    ).toEqual({ linked: 1, created: 1, unresolved: 0, conflicts: 0 });
    const migrated = await t.run((ctx) => ctx.db.get(legacyId));
    expect(migrated).toMatchObject({
      providerName: "Kenya Bank",
      uniquenessKey: expect.any(String),
      searchText: "legacy collections kenya bank ke 001",
    });
    await expect(
      asUser(t, s.ceo).mutation(api.financialInstitutions.setActive, {
        institutionId: migrated!.institutionId!,
        isActive: false,
      }),
    ).rejects.toThrow("Deactivate linked finance accounts");
  });
});
