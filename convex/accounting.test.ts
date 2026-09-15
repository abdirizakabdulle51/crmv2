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
  return await t.run(async (ctx) => {
    const countryId = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const userId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "accounting-ceo",
      role: "ceo",
    });
    const accountId = await ctx.db.insert("receivingAccounts", {
      countryId,
      name: "Operating Bank",
      providerName: "Islamic Bank",
      accountNumber: "ACC-1",
      accountHolderName: "HTG",
      type: "bank",
      usage: "both",
      currency: "USD",
      isActive: true,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { countryId, accountId, user: (await ctx.db.get(userId))! };
  });
}

describe("accounting", () => {
  it("posts capital as a balanced double-entry journal", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.user).mutation(
      api.receivingAccounts.recordNonInvoiceInflow,
      {
        accountId: s.accountId,
        type: "capital_contribution",
        amount: 1000,
        transactionDate: 1000,
        transactionId: "CAP-1",
        description: "Initial capital",
      },
    );

    const trial = await asUser(t, s.user).query(api.accounting.trialBalance, {
      countryId: s.countryId,
      currency: "USD",
      asOf: 2000,
    });
    expect(trial).toMatchObject({
      balanced: true,
      debitCents: 100000,
      creditCents: 100000,
    });
    const balance = await asUser(t, s.user).query(api.accounting.balanceSheet, {
      countryId: s.countryId,
      currency: "USD",
      asOf: 2000,
    });
    expect(balance).toMatchObject({
      balanced: true,
      assetCents: 100000,
      equityCents: 100000,
    });
  });

  it("rejects unbalanced manual journals", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const debitAccount = await asUser(t, s.user).mutation(
      api.accounting.createAccount,
      {
        countryId: s.countryId,
        code: "5001",
        name: "Travel",
        type: "expense",
      },
    );
    const creditAccount = await asUser(t, s.user).mutation(
      api.accounting.createAccount,
      {
        countryId: s.countryId,
        code: "2001",
        name: "Other Payables",
        type: "liability",
      },
    );
    await expect(
      asUser(t, s.user).mutation(api.accounting.postManualJournal, {
        countryId: s.countryId,
        accountingDate: 1000,
        currency: "USD",
        description: "Incorrect adjustment",
        reason: "Regression test",
        lines: [
          { accountId: debitAccount, debitCents: 10000 },
          { accountId: creditAccount, creditCents: 9000 },
        ],
      }),
    ).rejects.toThrow("must equal");
  });

  it("prevents postings to a closed period", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.user).mutation(api.accounting.setPeriodStatus, {
      countryId: s.countryId,
      month: "1970-01",
      status: "closed",
      reason: "Period approved",
    });
    await expect(
      asUser(t, s.user).mutation(api.receivingAccounts.recordNonInvoiceInflow, {
        accountId: s.accountId,
        type: "capital_contribution",
        amount: 100,
        transactionDate: 1000,
        transactionId: "CAP-CLOSED",
        description: "Late capital",
      }),
    ).rejects.toThrow("period 1970-01 is closed");
  });

  it("rejects a journal in the wrong account currency", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const kesAccount = await asUser(t, s.user).mutation(
      api.accounting.createAccount,
      {
        countryId: s.countryId,
        code: "1010",
        name: "KES cash",
        type: "asset",
        currency: "KES",
      },
    );
    const equity = await asUser(t, s.user).mutation(
      api.accounting.createAccount,
      {
        countryId: s.countryId,
        code: "3010",
        name: "Equity",
        type: "equity",
        currency: "USD",
      },
    );
    await expect(
      asUser(t, s.user).mutation(api.accounting.postManualJournal, {
        countryId: s.countryId,
        accountingDate: 1000,
        currency: "USD",
        description: "Invalid currency",
        reason: "Regression test",
        lines: [
          { accountId: kesAccount, debitCents: 10000 },
          { accountId: equity, creditCents: 10000 },
        ],
      }),
    ).rejects.toThrow("only accepts KES postings");
  });

  it("migrates historical transactions idempotently in batches", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("accountTransactions", {
        accountId: s.accountId,
        countryId: s.countryId,
        currency: "USD",
        direction: "incoming",
        type: "opening_balance",
        amount: 250,
        amountCents: 25000,
        transactionDate: 1000,
        transactionId: "OPEN-1",
        description: "Historical opening balance",
        createdBy: s.user._id,
        createdAt: 1000,
      });
    });
    await asUser(t, s.user).mutation(api.accounting.migrateBatch, {
      countryId: s.countryId,
      phase: "transactions",
      dryRun: true,
      paginationOpts: { cursor: null, numItems: 25 },
    });
    expect(
      await t.run((ctx) => ctx.db.query("journalEntries").collect()),
    ).toHaveLength(0);
    for (let run = 0; run < 2; run++) {
      await asUser(t, s.user).mutation(api.accounting.migrateBatch, {
        countryId: s.countryId,
        phase: "transactions",
        paginationOpts: { cursor: null, numItems: 25 },
      });
    }
    const journals = await t.run((ctx) =>
      ctx.db
        .query("journalEntries")
        .withIndex("by_country", (q) => q.eq("countryId", s.countryId))
        .collect(),
    );
    expect(journals).toHaveLength(1);
  });
});
