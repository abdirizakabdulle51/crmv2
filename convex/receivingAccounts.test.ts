import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel.d.ts";
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
  it("records expense returns without changing the approved amount and reconciles the ledger", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await asUser(t, s.ceo).mutation(api.receivingAccounts.create, {
      countryId: s.countryA,
      institutionId: s.institutionId,
      name: "Operations USD",
      accountNumber: "RET-100",
      accountHolderName: "HTG",
      type: "bank",
      usage: "both",
      currency: "USD",
    });
    const expenseId = await t.run(async (ctx) => {
      const categoryId = await ctx.db.insert("expenseCategories", {
        name: "Operations",
        isActive: true,
        createdBy: s.ceo._id,
        createdAt: 1,
        updatedAt: 1,
      });
      return await ctx.db.insert("expenseRequests", {
        title: "Field cash",
        categoryId,
        amount: 100,
        currency: "USD",
        expenseDate: Date.UTC(2026, 7, 1),
        requestedBy: s.ceo._id,
        countryId: s.countryA,
        status: "paid",
        fundingAccountId: accountId,
        fundingAccountName: "Operations USD",
        fundingProviderName: "Somalia Bank",
        fundingAccountNumber: "RET-100",
        paidAt: Date.UTC(2026, 7, 2),
        paidBy: s.ceo._id,
        paymentTransactionId: "PAY-100",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const returnId = await asUser(t, s.ceo).mutation(api.receivingAccounts.recordExpenseReturn, {
      expenseId,
      accountId,
      amount: 10,
      transactionDate: Date.UTC(2026, 7, 3),
      transactionId: "RETURN-10",
      reason: "Unused field cash",
    });
    const summary = await asUser(t, s.ceo).query(api.receivingAccounts.expenseReturns, { expenseId });
    expect(summary).toMatchObject({ originalAmount: 100, returnedAmount: 10, actualAmount: 90 });
    expect((await t.run((ctx) => ctx.db.get(expenseId)))?.amount).toBe(100);
    expect((await asUser(t, s.ceo).query(api.receivingAccounts.ledger, {
      accountId,
      startDate: Date.UTC(2026, 7, 1),
      endDate: Date.UTC(2026, 7, 31),
    })).accountBalance).toBe(-90);
    await expect(asUser(t, s.ceo).mutation(api.receivingAccounts.recordExpenseReturn, {
      expenseId,
      accountId,
      amount: 91,
      transactionDate: Date.UTC(2026, 7, 4),
      transactionId: "RETURN-TOO-MUCH",
      reason: "Invalid",
    })).rejects.toThrow("cannot exceed");

    await asUser(t, s.ceo).mutation(api.receivingAccounts.reverseAccountTransaction, {
      transactionId: returnId,
      reversalTransactionId: "RETURN-10-REV",
      transactionDate: Date.UTC(2026, 7, 4),
      reason: "Wrong bank entry",
    });
    expect(await asUser(t, s.ceo).query(api.receivingAccounts.expenseReturns, { expenseId }))
      .toMatchObject({ originalAmount: 100, returnedAmount: 0, actualAmount: 100 });
  });

  it("records opening capital separately from invoice collections", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await asUser(t, s.ceo).mutation(api.receivingAccounts.create, {
      countryId: s.countryA,
      institutionId: s.institutionId,
      name: "Capital USD",
      accountNumber: "CAP-100",
      accountHolderName: "HTG",
      type: "bank",
      usage: "incoming",
      currency: "USD",
    });
    await asUser(t, s.ceo).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
      accountId,
      type: "opening_balance",
      amount: 5000,
      transactionDate: Date.UTC(2026, 7, 1),
      transactionId: "OPEN-5000",
      source: "Shareholder investment",
      description: "Initial account funding",
    });
    const ledger = await asUser(t, s.ceo).query(api.receivingAccounts.ledger, {
      accountId,
      startDate: Date.UTC(2026, 7, 1),
      endDate: Date.UTC(2026, 7, 31),
    });
    expect(ledger.accountBalance).toBe(5000);
    expect((await asUser(t, s.ceo).query(api.receivingAccounts.collections, {
      startDate: Date.UTC(2026, 7, 1),
      endDate: Date.UTC(2026, 7, 31),
      accountId,
    })).rows).toHaveLength(0);
    await expect(asUser(t, s.ceo).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
      accountId,
      type: "opening_balance",
      amount: 1,
      transactionDate: Date.UTC(2026, 7, 2),
      transactionId: "OPEN-SECOND",
      description: "Duplicate opening",
    })).rejects.toThrow("already has an active opening balance");
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
