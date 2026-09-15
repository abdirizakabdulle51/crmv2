import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring, isCeoOrHob } from "./authorization";
import {
  ensureSystemAccount,
  postCashTransaction,
  postExpenseApproved,
  postExpensePaid,
  postExpenseReturn,
  postInvoiceIssued,
  postInvoicePayment,
  postJournal,
  reverseJournal,
  type PostingLine,
} from "./accountingEngine";
import { calculateBalance, roundMoney, toCents } from "./money";

type Ctx = QueryCtx | MutationCtx;

async function currentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user)
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  assertNotMonitoring(user);
  return user;
}

function assertCanManage(user: Doc<"users">) {
  if (!isCeoOrHob(user))
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Only CEO or Head of Business can manage accounting",
    });
}

function canViewCountry(user: Doc<"users">, countryId: Id<"countries">) {
  return isCeoOrHob(user) && Boolean(countryId);
}

async function assertCountryAccess(
  ctx: Ctx,
  user: Doc<"users">,
  countryId: Id<"countries">,
) {
  const country = await ctx.db.get(countryId);
  if (!country || !canViewCountry(user, countryId))
    throw new ConvexError({ code: "NOT_FOUND", message: "Country not found" });
  return country;
}

const reportArgs = {
  countryId: v.id("countries"),
  currency: v.optional(v.string()),
};

async function recordException(
  ctx: MutationCtx,
  args: {
    countryId?: Id<"countries">;
    sourceType: string;
    sourceId: string;
    code: string;
    message: string;
  },
) {
  const existing = await ctx.db
    .query("accountingExceptions")
    .withIndex("by_source", (q) =>
      q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId),
    )
    .first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...args,
      status: "open",
      resolvedBy: undefined,
      resolvedAt: undefined,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("accountingExceptions", {
    ...args,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
}

async function resolveException(
  ctx: MutationCtx,
  userId: Id<"users">,
  sourceType: string,
  sourceId: string,
) {
  const rows = await ctx.db
    .query("accountingExceptions")
    .withIndex("by_source", (q) =>
      q.eq("sourceType", sourceType).eq("sourceId", sourceId),
    )
    .collect();
  const now = Date.now();
  for (const row of rows.filter((item) => item.status === "open")) {
    await ctx.db.patch(row._id, {
      status: "resolved",
      resolvedBy: userId,
      resolvedAt: now,
      updatedAt: now,
    });
  }
}

async function ledgerData(
  ctx: QueryCtx,
  countryId: Id<"countries">,
  currency = "USD",
  startDate?: number,
  endDate?: number,
) {
  const [accounts, journals, lines] = await Promise.all([
    ctx.db
      .query("accountingAccounts")
      .withIndex("by_country", (q) => q.eq("countryId", countryId))
      .collect(),
    ctx.db
      .query("journalEntries")
      .withIndex("by_country", (q) => q.eq("countryId", countryId))
      .collect(),
    ctx.db.query("journalLines").collect(),
  ]);
  const accountMap = new Map(accounts.map((account) => [account._id, account]));
  const journalMap = new Map(
    journals
      .filter(
        (journal) =>
          (startDate === undefined || journal.accountingDate >= startDate) &&
          (endDate === undefined || journal.accountingDate <= endDate),
      )
      .map((journal) => [journal._id, journal]),
  );
  return {
    accounts,
    accountMap,
    journals: [...journalMap.values()],
    lines: lines.filter(
      (line) =>
        line.currency === currency &&
        accountMap.has(line.accountId) &&
        journalMap.has(line.journalId),
    ),
    journalMap,
    currency,
  };
}

export const initialize = mutation({
  args: { countryId: v.id("countries") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    const keys = [
      "ACCOUNTS_RECEIVABLE",
      "ACCOUNTS_PAYABLE",
      "SERVICE_REVENUE",
      "DEFERRED_REVENUE",
      "CUSTOMER_ADVANCES",
      "OPERATING_EXPENSE",
      "CAPITAL_CONTRIBUTIONS",
      "OPENING_BALANCE_EQUITY",
      "OTHER_INCOME",
    ] as const;
    for (const key of keys) {
      await ensureSystemAccount(ctx, user._id, args.countryId, key);
    }
    return { created: keys.length };
  },
});

export const listAccounts = query({
  args: {
    countryId: v.id("countries"),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const rows = await ctx.db
      .query("accountingAccounts")
      .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
      .collect();
    return rows
      .filter((row) => args.includeInactive || row.isActive)
      .sort((a, b) => a.code.localeCompare(b.code));
  },
});

export const createAccount = mutation({
  args: {
    countryId: v.id("countries"),
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("equity"),
      v.literal("income"),
      v.literal("expense"),
    ),
    currency: v.optional(v.string()),
    allowManualPosting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    const code = args.code.trim().toUpperCase();
    const name = args.name.trim();
    if (!code || !name)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Account code and name are required",
      });
    const duplicate = await ctx.db
      .query("accountingAccounts")
      .withIndex("by_country_code", (q) =>
        q.eq("countryId", args.countryId).eq("code", code),
      )
      .unique();
    if (duplicate)
      throw new ConvexError({
        code: "CONFLICT",
        message: "Account code already exists in this country",
      });
    const now = Date.now();
    return await ctx.db.insert("accountingAccounts", {
      countryId: args.countryId,
      code,
      name,
      type: args.type,
      currency: args.currency?.trim().toUpperCase() || undefined,
      isActive: true,
      allowManualPosting: args.allowManualPosting ?? true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const postManualJournal = mutation({
  args: {
    countryId: v.id("countries"),
    accountingDate: v.number(),
    currency: v.string(),
    description: v.string(),
    reason: v.string(),
    lines: v.array(
      v.object({
        accountId: v.id("accountingAccounts"),
        debitCents: v.optional(v.number()),
        creditCents: v.optional(v.number()),
        memo: v.optional(v.string()),
        expenseId: v.optional(v.id("expenseRequests")),
        invoiceId: v.optional(v.id("invoices")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    if (!args.reason.trim())
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "An accounting correction reason is required",
      });
    for (const line of args.lines) {
      const account = await ctx.db.get(line.accountId);
      if (!account?.allowManualPosting)
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Manual posting is disabled for a selected control account",
        });
    }
    return await postJournal(ctx, {
      actorId: user._id,
      countryId: args.countryId,
      accountingDate: args.accountingDate,
      currency: args.currency.trim().toUpperCase(),
      description: args.description,
      sourceType: "manual_adjustment",
      idempotencyKey: `manual:${crypto.randomUUID()}`,
      correctionReason: args.reason,
      lines: args.lines as PostingLine[],
    });
  },
});

export const reverse = mutation({
  args: {
    journalId: v.id("journalEntries"),
    accountingDate: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    if (!args.reason.trim())
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Reversal reason is required",
      });
    return await reverseJournal(ctx, {
      journalId: args.journalId,
      actorId: user._id,
      accountingDate: args.accountingDate,
      reason: args.reason,
      idempotencyKey: `journal-reversal:${args.journalId}`,
    });
  },
});

export const setPeriodStatus = mutation({
  args: {
    countryId: v.id("countries"),
    month: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("soft_closed"),
      v.literal("closed"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month) || !args.reason.trim())
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Valid month and reason are required",
      });
    const existing = await ctx.db
      .query("accountingPeriods")
      .withIndex("by_country_month", (q) =>
        q.eq("countryId", args.countryId).eq("month", args.month),
      )
      .unique();
    const now = Date.now();
    const changes =
      args.status === "open"
        ? {
            status: args.status,
            reopenedBy: user._id,
            reopenedAt: now,
            reason: args.reason.trim(),
            updatedAt: now,
          }
        : {
            status: args.status,
            closedBy: user._id,
            closedAt: now,
            reason: args.reason.trim(),
            updatedAt: now,
          };
    if (existing) return await ctx.db.patch(existing._id, changes);
    return await ctx.db.insert("accountingPeriods", {
      countryId: args.countryId,
      month: args.month,
      ...changes,
    });
  },
});

export const listPeriods = query({
  args: { countryId: v.id("countries") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    return (
      await ctx.db
        .query("accountingPeriods")
        .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
        .collect()
    ).sort((a, b) => b.month.localeCompare(a.month));
  },
});

export const listJournals = query({
  args: {
    countryId: v.id("countries"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
      .collect();
    return await Promise.all(
      journals
        .filter(
          (row) =>
            (args.startDate === undefined ||
              row.accountingDate >= args.startDate) &&
            (args.endDate === undefined || row.accountingDate <= args.endDate),
        )
        .sort((a, b) => b.accountingDate - a.accountingDate)
        .map(async (journal) => ({
          ...journal,
          lines: await ctx.db
            .query("journalLines")
            .withIndex("by_journal", (q) => q.eq("journalId", journal._id))
            .collect(),
        })),
    );
  },
});

export const trialBalance = query({
  args: { ...reportArgs, asOf: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const data = await ledgerData(
      ctx,
      args.countryId,
      args.currency,
      undefined,
      args.asOf,
    );
    const rows = data.accounts
      .map((account) => {
        const lines = data.lines.filter(
          (line) => line.accountId === account._id,
        );
        const debitCents = lines.reduce(
          (sum, line) => sum + line.debitCents,
          0,
        );
        const creditCents = lines.reduce(
          (sum, line) => sum + line.creditCents,
          0,
        );
        return {
          ...account,
          debitCents,
          creditCents,
          balanceCents: debitCents - creditCents,
        };
      })
      .filter((row) => row.debitCents || row.creditCents);
    const debitCents = rows.reduce((sum, row) => sum + row.debitCents, 0);
    const creditCents = rows.reduce((sum, row) => sum + row.creditCents, 0);
    return {
      currency: data.currency,
      rows,
      debitCents,
      creditCents,
      balanced: debitCents === creditCents,
    };
  },
});

export const incomeStatement = query({
  args: { ...reportArgs, startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const data = await ledgerData(
      ctx,
      args.countryId,
      args.currency,
      args.startDate,
      args.endDate,
    );
    const rows = data.accounts
      .filter(
        (account) => account.type === "income" || account.type === "expense",
      )
      .map((account) => {
        const lines = data.lines.filter(
          (line) => line.accountId === account._id,
        );
        const debit = lines.reduce((sum, line) => sum + line.debitCents, 0);
        const credit = lines.reduce((sum, line) => sum + line.creditCents, 0);
        const amountCents =
          account.type === "income" ? credit - debit : debit - credit;
        return { ...account, amountCents };
      })
      .filter((row) => row.amountCents !== 0);
    const incomeCents = rows
      .filter((row) => row.type === "income")
      .reduce((sum, row) => sum + row.amountCents, 0);
    const expenseCents = rows
      .filter((row) => row.type === "expense")
      .reduce((sum, row) => sum + row.amountCents, 0);
    return {
      currency: data.currency,
      rows,
      incomeCents,
      expenseCents,
      netIncomeCents: incomeCents - expenseCents,
    };
  },
});

export const balanceSheet = query({
  args: { ...reportArgs, asOf: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const data = await ledgerData(
      ctx,
      args.countryId,
      args.currency,
      undefined,
      args.asOf,
    );
    const amount = (account: Doc<"accountingAccounts">) => {
      const lines = data.lines.filter((line) => line.accountId === account._id);
      const debit = lines.reduce((sum, line) => sum + line.debitCents, 0);
      const credit = lines.reduce((sum, line) => sum + line.creditCents, 0);
      return account.type === "asset" ? debit - credit : credit - debit;
    };
    const assets = data.accounts
      .filter((row) => row.type === "asset")
      .map((row) => ({ ...row, amountCents: amount(row) }))
      .filter((row) => row.amountCents);
    const liabilities = data.accounts
      .filter((row) => row.type === "liability")
      .map((row) => ({ ...row, amountCents: amount(row) }))
      .filter((row) => row.amountCents);
    const equity = data.accounts
      .filter((row) => row.type === "equity")
      .map((row) => ({ ...row, amountCents: amount(row) }))
      .filter((row) => row.amountCents);
    const earningsCents = data.accounts
      .filter((row) => row.type === "income" || row.type === "expense")
      .reduce((sum, row) => sum + amount(row), 0);
    const assetCents = assets.reduce((sum, row) => sum + row.amountCents, 0);
    const liabilityCents = liabilities.reduce(
      (sum, row) => sum + row.amountCents,
      0,
    );
    const equityCents =
      equity.reduce((sum, row) => sum + row.amountCents, 0) + earningsCents;
    return {
      currency: data.currency,
      assets,
      liabilities,
      equity,
      earningsCents,
      assetCents,
      liabilityCents,
      equityCents,
      balanced: assetCents === liabilityCents + equityCents,
    };
  },
});

export const generalLedger = query({
  args: {
    countryId: v.id("countries"),
    accountId: v.id("accountingAccounts"),
    currency: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.countryId !== args.countryId)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Ledger account not found",
      });
    const opening = await ledgerData(
      ctx,
      args.countryId,
      args.currency,
      undefined,
      args.startDate - 1,
    );
    let runningBalanceCents = opening.lines
      .filter((line) => line.accountId === account._id)
      .reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
    const data = await ledgerData(
      ctx,
      args.countryId,
      args.currency,
      args.startDate,
      args.endDate,
    );
    const rows = data.lines
      .filter((line) => line.accountId === account._id)
      .map((line) => ({
        ...line,
        journal: data.journalMap.get(line.journalId)!,
      }))
      .sort((a, b) => a.journal.accountingDate - b.journal.accountingDate)
      .map((row) => {
        runningBalanceCents += row.debitCents - row.creditCents;
        return { ...row, runningBalanceCents };
      });
    return {
      account,
      currency: data.currency,
      openingBalanceCents: rows[0]
        ? rows[0].runningBalanceCents - rows[0].debitCents + rows[0].creditCents
        : runningBalanceCents,
      rows,
      closingBalanceCents: runningBalanceCents,
    };
  },
});

export const listAdvances = query({
  args: { companyId: v.optional(v.id("companies")) },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const rows = args.companyId
      ? await ctx.db
          .query("customerAdvances")
          .withIndex("by_company", (q) => q.eq("companyId", args.companyId!))
          .collect()
      : await ctx.db.query("customerAdvances").collect();
    const companies = new Map(
      (await ctx.db.query("companies").collect()).map((row) => [row._id, row]),
    );
    return rows
      .filter((row) => {
        const company = companies.get(row.companyId);
        return company && canViewCountry(user, company.countryId);
      })
      .map((row) => ({
        ...row,
        companyName: companies.get(row.companyId)!.name,
      }));
  },
});

export const applyAdvance = mutation({
  args: {
    advanceId: v.id("customerAdvances"),
    invoiceId: v.id("invoices"),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    const [advance, invoice] = await Promise.all([
      ctx.db.get(args.advanceId),
      ctx.db.get(args.invoiceId),
    ]);
    if (!advance || !invoice || advance.companyId !== invoice.companyId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Advance and invoice must belong to the same customer",
      });
    if (
      !["issued", "sent", "overdue", "partially_paid"].includes(invoice.status)
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Advance can only be applied to a payable invoice",
      });
    const requested =
      args.amount === undefined
        ? advance.remainingAmountCents
        : toCents(args.amount);
    const amountCents = Math.min(
      requested,
      advance.remainingAmountCents,
      invoice.balanceDueCents ?? toCents(invoice.balanceDue),
    );
    if (amountCents <= 0)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "No advance balance can be applied",
      });
    const company = await ctx.db.get(invoice.companyId);
    if (!company?.countryId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Customer country is required",
      });
    const [advancesGl, receivable] = await Promise.all([
      ensureSystemAccount(
        ctx,
        user._id,
        company.countryId,
        "CUSTOMER_ADVANCES",
      ),
      ensureSystemAccount(
        ctx,
        user._id,
        company.countryId,
        "ACCOUNTS_RECEIVABLE",
      ),
    ]);
    const applicationId = await ctx.db.insert("customerAdvanceApplications", {
      advanceId: advance._id,
      invoiceId: invoice._id,
      amountCents,
      appliedBy: user._id,
      appliedAt: Date.now(),
    });
    await postJournal(ctx, {
      actorId: user._id,
      countryId: company.countryId,
      accountingDate: Date.now(),
      currency: advance.currency,
      description: `Customer advance applied to ${invoice.invoiceNumber ?? invoice._id}`,
      sourceType: "customer_advance_application",
      sourceId: String(applicationId),
      idempotencyKey: `advance-application:${applicationId}`,
      lines: [
        {
          accountId: advancesGl._id,
          debitCents: amountCents,
          companyId: company._id,
          invoiceId: invoice._id,
        },
        {
          accountId: receivable._id,
          creditCents: amountCents,
          companyId: company._id,
          invoiceId: invoice._id,
        },
      ],
    });
    const amount = roundMoney(amountCents / 100);
    const nextPaid = roundMoney(invoice.amountPaid + amount);
    const nextBalance = calculateBalance(invoice.grandTotal, nextPaid);
    await ctx.db.patch(invoice._id, {
      amountPaid: nextPaid,
      amountPaidCents: toCents(nextPaid),
      balanceDue: nextBalance,
      balanceDueCents: toCents(nextBalance),
      status: nextBalance === 0 ? "paid" : "partially_paid",
      updatedAt: Date.now(),
    });
    const remainingAmountCents = advance.remainingAmountCents - amountCents;
    await ctx.db.patch(advance._id, {
      remainingAmountCents,
      status: remainingAmountCents === 0 ? "applied" : "available",
      updatedAt: Date.now(),
    });
    return applicationId;
  },
});

export const listInvoiceAdvanceApplications = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const invoice = await ctx.db.get(args.invoiceId);
    const company = invoice ? await ctx.db.get(invoice.companyId) : null;
    if (!invoice || !company || !canViewCountry(user, company.countryId))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invoice not found",
      });
    return await ctx.db
      .query("customerAdvanceApplications")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .collect();
  },
});

export const reverseAdvanceApplication = mutation({
  args: {
    applicationId: v.id("customerAdvanceApplications"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    const application = await ctx.db.get(args.applicationId);
    if (!application || application.reversedAt)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an active advance application",
      });
    const [advance, invoice] = await Promise.all([
      ctx.db.get(application.advanceId),
      ctx.db.get(application.invoiceId),
    ]);
    if (!advance || !invoice)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Advance application source is missing",
      });
    const reason = args.reason.trim();
    if (!reason)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Reversal reason is required",
      });
    const journal = await ctx.db
      .query("journalEntries")
      .withIndex("by_source", (q) =>
        q
          .eq("sourceType", "customer_advance_application")
          .eq("sourceId", String(application._id)),
      )
      .unique();
    if (journal?.status === "posted") {
      await reverseJournal(ctx, {
        journalId: journal._id,
        actorId: user._id,
        accountingDate: Date.now(),
        reason,
        idempotencyKey: `advance-application-reversal:${application._id}`,
      });
    }
    const now = Date.now();
    await ctx.db.patch(application._id, {
      reversedAt: now,
      reversedBy: user._id,
      reversalReason: reason,
    });
    await ctx.db.patch(advance._id, {
      remainingAmountCents:
        advance.remainingAmountCents + application.amountCents,
      status: "available",
      updatedAt: now,
    });
    const nextPaidCents = Math.max(
      0,
      (invoice.amountPaidCents ?? toCents(invoice.amountPaid)) -
        application.amountCents,
    );
    const totalCents = invoice.grandTotalCents ?? toCents(invoice.grandTotal);
    const nextBalanceCents = Math.max(0, totalCents - nextPaidCents);
    await ctx.db.patch(invoice._id, {
      amountPaid: nextPaidCents / 100,
      amountPaidCents: nextPaidCents,
      balanceDue: nextBalanceCents / 100,
      balanceDueCents: nextBalanceCents,
      status:
        nextPaidCents > 0
          ? "partially_paid"
          : invoice.sentAt
            ? "sent"
            : "issued",
      updatedAt: now,
    });
  },
});

export const recognizeDeferredRevenue = mutation({
  args: { countryId: v.id("countries"), throughMonth: v.string() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.throughMonth))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Valid through month is required",
      });
    const companies = new Map(
      (await ctx.db.query("companies").collect()).map((row) => [row._id, row]),
    );
    const invoices = (await ctx.db.query("invoices").collect()).filter(
      (invoice) =>
        companies.get(invoice.companyId)?.countryId === args.countryId &&
        invoice.billingTiming === "prepaid" &&
        invoice.status !== "draft" &&
        invoice.status !== "cancelled" &&
        invoice.status !== "void",
    );
    const [deferred, revenue] = await Promise.all([
      ensureSystemAccount(ctx, user._id, args.countryId, "DEFERRED_REVENUE"),
      ensureSystemAccount(ctx, user._id, args.countryId, "SERVICE_REVENUE"),
    ]);
    let recognized = 0;
    for (const invoice of invoices) {
      for (const allocation of invoice.revenueAllocations ?? []) {
        if (allocation.month > args.throughMonth || allocation.amount <= 0)
          continue;
        const [year, month] = allocation.month.split("-").map(Number);
        const accountingDate = Math.min(
          Date.now(),
          Date.UTC(year, month, 0, 23, 59, 59, 999),
        );
        await postJournal(ctx, {
          actorId: user._id,
          countryId: args.countryId,
          accountingDate,
          currency: invoice.sellerCurrency ?? "USD",
          description: `Revenue recognition for ${invoice.invoiceNumber ?? invoice._id} · ${allocation.month}`,
          sourceType: "deferred_revenue_recognition",
          sourceId: `${invoice._id}:${allocation.month}`,
          idempotencyKey: `revenue-recognition:${invoice._id}:${allocation.month}`,
          lines: [
            {
              accountId: deferred._id,
              debitCents: toCents(allocation.amount),
              companyId: invoice.companyId,
              invoiceId: invoice._id,
            },
            {
              accountId: revenue._id,
              creditCents: toCents(allocation.amount),
              companyId: invoice.companyId,
              invoiceId: invoice._id,
            },
          ],
        });
        recognized++;
      }
    }
    return { recognized };
  },
});

export const recognizeDeferredRevenueScheduled = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const actor = (await ctx.db.query("users").collect()).find(isCeoOrHob);
    if (!actor) return;
    const page = await ctx.db.query("invoices").paginate({
      cursor: args.cursor ?? null,
      numItems: 25,
    });
    const throughMonth = new Date().toISOString().slice(0, 7);
    for (const invoice of page.page) {
      if (
        invoice.billingTiming !== "prepaid" ||
        ["draft", "cancelled", "void"].includes(invoice.status)
      )
        continue;
      const company = await ctx.db.get(invoice.companyId);
      if (!company?.countryId) continue;
      const [deferred, revenue] = await Promise.all([
        ensureSystemAccount(
          ctx,
          actor._id,
          company.countryId,
          "DEFERRED_REVENUE",
        ),
        ensureSystemAccount(
          ctx,
          actor._id,
          company.countryId,
          "SERVICE_REVENUE",
        ),
      ]);
      let blocked = false;
      for (const allocation of invoice.revenueAllocations ?? []) {
        if (allocation.month > throughMonth || allocation.amount <= 0) continue;
        const period = await ctx.db
          .query("accountingPeriods")
          .withIndex("by_country_month", (q) =>
            q.eq("countryId", company.countryId!).eq("month", allocation.month),
          )
          .unique();
        if (period?.status === "closed") {
          blocked = true;
          await recordException(ctx, {
            countryId: company.countryId,
            sourceType: "invoice",
            sourceId: String(invoice._id),
            code: "CLOSED_REVENUE_PERIOD",
            message: `${allocation.month} must be reopened to recognize ${invoice.invoiceNumber ?? invoice._id}`,
          });
          continue;
        }
        const [year, month] = allocation.month.split("-").map(Number);
        await postJournal(ctx, {
          actorId: actor._id,
          countryId: company.countryId,
          accountingDate: Math.min(
            Date.now(),
            Date.UTC(year, month, 0, 23, 59, 59, 999),
          ),
          currency: invoice.sellerCurrency ?? "USD",
          description: `Revenue recognition for ${invoice.invoiceNumber ?? invoice._id} · ${allocation.month}`,
          sourceType: "deferred_revenue_recognition",
          sourceId: `${invoice._id}:${allocation.month}`,
          idempotencyKey: `revenue-recognition:${invoice._id}:${allocation.month}`,
          lines: [
            {
              accountId: deferred._id,
              debitCents: toCents(allocation.amount),
              companyId: invoice.companyId,
              invoiceId: invoice._id,
            },
            {
              accountId: revenue._id,
              creditCents: toCents(allocation.amount),
              companyId: invoice.companyId,
              invoiceId: invoice._id,
            },
          ],
        });
      }
      if (!blocked)
        await resolveException(ctx, actor._id, "invoice", String(invoice._id));
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.accounting.recognizeDeferredRevenueScheduled,
        { cursor: page.continueCursor },
      );
    }
  },
});

export const migrationStatus = query({
  args: { countryId: v.id("countries") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const [journals, exceptions] = await Promise.all([
      ctx.db
        .query("journalEntries")
        .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
        .collect(),
      ctx.db.query("accountingExceptions").collect(),
    ]);
    const countryExceptions = exceptions.filter(
      (row) => !row.countryId || row.countryId === args.countryId,
    );
    return {
      posted: journals.filter((row) => row.status === "posted").length,
      reversed: journals.filter((row) => row.status === "reversed").length,
      openExceptions: countryExceptions.filter((row) => row.status === "open")
        .length,
      resolvedExceptions: countryExceptions.filter(
        (row) => row.status === "resolved",
      ).length,
    };
  },
});

export const reconciliation = query({
  args: { countryId: v.id("countries"), currency: v.string() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    const currency = args.currency.trim().toUpperCase();
    const [
      data,
      companies,
      invoices,
      expenses,
      advances,
      physicalAccounts,
      payments,
      transactions,
    ] = await Promise.all([
      ledgerData(ctx, args.countryId, currency, undefined, Date.now()),
      ctx.db.query("companies").collect(),
      ctx.db.query("invoices").collect(),
      ctx.db.query("expenseRequests").collect(),
      ctx.db.query("customerAdvances").collect(),
      ctx.db
        .query("receivingAccounts")
        .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
        .collect(),
      ctx.db.query("invoicePayments").collect(),
      ctx.db.query("accountTransactions").collect(),
    ]);
    const companyIds = new Set(
      companies
        .filter((row) => row.countryId === args.countryId)
        .map((row) => row._id),
    );
    const gl = (systemKey: string, normal: "debit" | "credit") => {
      const account = data.accounts.find((row) => row.systemKey === systemKey);
      if (!account) return 0;
      return data.lines
        .filter((line) => line.accountId === account._id)
        .reduce(
          (sum, line) =>
            sum +
            (normal === "debit"
              ? line.debitCents - line.creditCents
              : line.creditCents - line.debitCents),
          0,
        );
    };
    const arSource = invoices
      .filter(
        (row) =>
          companyIds.has(row.companyId) &&
          (row.sellerCurrency ?? "USD") === currency &&
          !["draft", "cancelled", "void"].includes(row.status),
      )
      .reduce(
        (sum, row) => sum + (row.balanceDueCents ?? toCents(row.balanceDue)),
        0,
      );
    const apSource = expenses
      .filter(
        (row) =>
          row.countryId === args.countryId &&
          row.currency === currency &&
          row.status === "approved" &&
          !row.onboardingCreditId,
      )
      .reduce((sum, row) => sum + toCents(row.amount), 0);
    const advanceSource = advances
      .filter(
        (row) => companyIds.has(row.companyId) && row.currency === currency,
      )
      .reduce((sum, row) => sum + row.remainingAmountCents, 0);
    const banks = physicalAccounts
      .filter((account) => account.currency === currency)
      .map((account) => {
        const paymentCents = payments
          .filter((row) => row.receivingAccountId === account._id)
          .reduce(
            (sum, row) => sum + (row.amountCents ?? toCents(row.amount)),
            0,
          );
        const expenseCents = expenses
          .filter(
            (row) =>
              row.fundingAccountId === account._id && row.status === "paid",
          )
          .reduce((sum, row) => sum + toCents(row.amount), 0);
        const transactionCents = transactions
          .filter((row) => row.accountId === account._id)
          .reduce(
            (sum, row) =>
              sum +
              (row.direction === "incoming"
                ? row.amountCents
                : -row.amountCents),
            0,
          );
        const ledgerCents = data.lines
          .filter((line) => line.receivingAccountId === account._id)
          .reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
        const sourceCents = paymentCents - expenseCents + transactionCents;
        return {
          _id: account._id,
          name: account.name,
          sourceCents,
          ledgerCents,
          differenceCents: sourceCents - ledgerCents,
        };
      });
    const controls = [
      {
        name: "Accounts Receivable",
        sourceCents: arSource,
        ledgerCents: gl("ACCOUNTS_RECEIVABLE", "debit"),
      },
      {
        name: "Accounts Payable",
        sourceCents: apSource,
        ledgerCents: gl("ACCOUNTS_PAYABLE", "credit"),
      },
      {
        name: "Customer Advances",
        sourceCents: advanceSource,
        ledgerCents: gl("CUSTOMER_ADVANCES", "credit"),
      },
    ].map((row) => ({
      ...row,
      differenceCents: row.sourceCents - row.ledgerCents,
    }));
    return {
      controls,
      banks,
      reconciled: [...controls, ...banks].every(
        (row) => row.differenceCents === 0,
      ),
    };
  },
});

export const listMigrationExceptions = query({
  args: {
    countryId: v.id("countries"),
    includeResolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    await assertCountryAccess(ctx, user, args.countryId);
    return (await ctx.db.query("accountingExceptions").collect())
      .filter(
        (row) =>
          (!row.countryId || row.countryId === args.countryId) &&
          (args.includeResolved || row.status === "open"),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const migrateBatch = mutation({
  args: {
    countryId: v.id("countries"),
    phase: v.union(
      v.literal("invoices"),
      v.literal("deferred"),
      v.literal("payments"),
      v.literal("expenses"),
      v.literal("transactions"),
    ),
    dryRun: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    let posted = 0;
    let skipped = 0;
    let exceptions = 0;
    const flag = async (
      sourceType: string,
      sourceId: string,
      code: string,
      message: string,
      countryId: Id<"countries"> | undefined = args.countryId,
    ) => {
      await recordException(ctx, {
        countryId,
        sourceType,
        sourceId,
        code,
        message,
      });
      exceptions++;
    };

    if (args.phase === "invoices") {
      const page = await ctx.db.query("invoices").paginate(args.paginationOpts);
      for (const invoice of page.page) {
        const company = await ctx.db.get(invoice.companyId);
        if (!company?.countryId) {
          await flag(
            "invoice",
            String(invoice._id),
            "MISSING_COUNTRY",
            `Invoice ${invoice.invoiceNumber ?? invoice._id} has no customer country`,
            undefined,
          );
          continue;
        }
        if (company.countryId !== args.countryId) continue;
        if (["draft", "cancelled", "void"].includes(invoice.status)) {
          skipped++;
          continue;
        }
        if (!invoice.issueDate) {
          await flag(
            "invoice",
            String(invoice._id),
            "MISSING_ISSUE_DATE",
            `Invoice ${invoice.invoiceNumber ?? invoice._id} requires an issue date`,
          );
          continue;
        }
        if (!args.dryRun) {
          await postInvoiceIssued(ctx, user._id, invoice);
        }
        await resolveException(ctx, user._id, "invoice", String(invoice._id));
        posted++;
        const payments = await ctx.db
          .query("invoicePayments")
          .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
          .collect();
        const recordedCents = payments
          .filter((row) => !row.reversesPaymentId)
          .reduce(
            (sum, row) => sum + toCents(row.appliedAmount ?? row.amount),
            0,
          );
        const paidCents =
          invoice.amountPaidCents ?? toCents(invoice.amountPaid);
        if (paidCents > recordedCents) {
          await flag(
            "invoice",
            String(invoice._id),
            "MISSING_PAYMENT_RECORD",
            `${(paidCents - recordedCents) / 100} ${invoice.sellerCurrency ?? "USD"} of historical collections requires payment reconciliation`,
          );
        }
      }
      return { ...page, posted, skipped, exceptions };
    }

    if (args.phase === "payments") {
      const page = await ctx.db
        .query("invoicePayments")
        .paginate(args.paginationOpts);
      for (const payment of page.page) {
        if (payment.amount <= 0 || payment.reversesPaymentId) {
          skipped++;
          continue;
        }
        const invoice = await ctx.db.get(payment.invoiceId);
        const company = invoice ? await ctx.db.get(invoice.companyId) : null;
        if (!invoice || company?.countryId !== args.countryId) continue;
        if (!payment.receivingAccountId) {
          await flag(
            "invoice_payment",
            String(payment._id),
            "MISSING_RECEIVING_ACCOUNT",
            `Payment for ${invoice.invoiceNumber ?? invoice._id} requires a receiving account`,
          );
          continue;
        }
        if (!args.dryRun) {
          await postInvoicePayment(ctx, user._id, invoice, payment);
        }
        await resolveException(
          ctx,
          user._id,
          "invoice_payment",
          String(payment._id),
        );
        posted++;
        if (args.dryRun) continue;
        if (payment.reversedByPaymentId) {
          const reversal = await ctx.db.get(payment.reversedByPaymentId);
          const journal = await ctx.db
            .query("journalEntries")
            .withIndex("by_source", (q) =>
              q
                .eq("sourceType", "invoice_payment")
                .eq("sourceId", String(payment._id)),
            )
            .unique();
          if (reversal && journal?.status === "posted") {
            await reverseJournal(ctx, {
              journalId: journal._id,
              actorId: user._id,
              accountingDate: reversal.paidAt,
              reason: payment.reversalReason ?? "Historical payment reversal",
              idempotencyKey: `invoice-payment-reversal:${payment._id}`,
            });
          }
          continue;
        }
        const unappliedAmount = roundMoney(
          payment.amount - (payment.appliedAmount ?? payment.amount),
        );
        if (unappliedAmount > 0) {
          const existing = await ctx.db
            .query("customerAdvances")
            .withIndex("by_payment", (q) =>
              q.eq("originatingPaymentId", payment._id),
            )
            .unique();
          if (!existing) {
            const amountCents = toCents(unappliedAmount);
            await ctx.db.insert("customerAdvances", {
              companyId: invoice.companyId,
              originatingPaymentId: payment._id,
              currency:
                payment.receivingCurrencyNote ??
                invoice.sellerCurrency ??
                "USD",
              originalAmountCents: amountCents,
              remainingAmountCents: amountCents,
              status: "available",
              createdBy: user._id,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            await ctx.db.patch(payment._id, {
              unappliedAmount,
              extraServiceRevenueAmount: undefined,
            });
          }
        }
      }
      return { ...page, posted, skipped, exceptions };
    }

    if (args.phase === "deferred") {
      const page = await ctx.db.query("invoices").paginate(args.paginationOpts);
      const [deferred, revenue] = await Promise.all([
        ensureSystemAccount(ctx, user._id, args.countryId, "DEFERRED_REVENUE"),
        ensureSystemAccount(ctx, user._id, args.countryId, "SERVICE_REVENUE"),
      ]);
      const currentMonth = new Date().toISOString().slice(0, 7);
      for (const invoice of page.page) {
        const company = await ctx.db.get(invoice.companyId);
        if (
          company?.countryId !== args.countryId ||
          invoice.billingTiming !== "prepaid" ||
          ["draft", "cancelled", "void"].includes(invoice.status)
        ) {
          skipped++;
          continue;
        }
        if (!invoice.revenueAllocations?.length) {
          await flag(
            "invoice",
            String(invoice._id),
            "MISSING_REVENUE_ALLOCATION",
            `Prepaid invoice ${invoice.invoiceNumber ?? invoice._id} has no monthly revenue allocation`,
          );
          continue;
        }
        for (const allocation of invoice.revenueAllocations) {
          if (allocation.month > currentMonth || allocation.amount <= 0)
            continue;
          const [year, month] = allocation.month.split("-").map(Number);
          if (!args.dryRun)
            await postJournal(ctx, {
              actorId: user._id,
              countryId: args.countryId,
              accountingDate: Math.min(
                Date.now(),
                Date.UTC(year, month, 0, 23, 59, 59, 999),
              ),
              currency: invoice.sellerCurrency ?? "USD",
              description: `Revenue recognition for ${invoice.invoiceNumber ?? invoice._id} · ${allocation.month}`,
              sourceType: "deferred_revenue_recognition",
              sourceId: `${invoice._id}:${allocation.month}`,
              idempotencyKey: `revenue-recognition:${invoice._id}:${allocation.month}`,
              lines: [
                {
                  accountId: deferred._id,
                  debitCents: toCents(allocation.amount),
                  companyId: invoice.companyId,
                  invoiceId: invoice._id,
                },
                {
                  accountId: revenue._id,
                  creditCents: toCents(allocation.amount),
                  companyId: invoice.companyId,
                  invoiceId: invoice._id,
                },
              ],
            });
          posted++;
        }
      }
      return { ...page, posted, skipped, exceptions };
    }

    if (args.phase === "expenses") {
      const page = await ctx.db
        .query("expenseRequests")
        .paginate(args.paginationOpts);
      for (const expense of page.page) {
        if (expense.countryId !== args.countryId) continue;
        if (
          !["approved", "paid"].includes(expense.status) ||
          expense.onboardingCreditId
        ) {
          skipped++;
          continue;
        }
        if (!args.dryRun) await postExpenseApproved(ctx, user._id, expense);
        posted++;
        if (expense.status === "paid") {
          if (!expense.fundingAccountId || !expense.paidAt) {
            await flag(
              "expense",
              String(expense._id),
              "MISSING_PAYMENT_DETAILS",
              `Paid expense ${expense.title} requires a funding account and payment date`,
            );
            continue;
          }
          if (!args.dryRun) await postExpensePaid(ctx, user._id, expense);
          posted++;
        }
        await resolveException(ctx, user._id, "expense", String(expense._id));
      }
      return { ...page, posted, skipped, exceptions };
    }

    const page = await ctx.db
      .query("accountTransactions")
      .paginate(args.paginationOpts);
    for (const transaction of page.page) {
      if (transaction.countryId !== args.countryId) continue;
      if (transaction.type === "reversal") {
        skipped++;
        continue;
      }
      if (transaction.type === "expense_return") {
        const expense = transaction.expenseId
          ? await ctx.db.get(transaction.expenseId)
          : null;
        if (!expense) {
          await flag(
            "account_transaction",
            String(transaction._id),
            "MISSING_EXPENSE",
            `Expense return ${transaction.transactionId} has no source expense`,
          );
          continue;
        }
        if (!args.dryRun)
          await postExpenseReturn(ctx, user._id, transaction, expense);
      } else {
        if (!args.dryRun) await postCashTransaction(ctx, user._id, transaction);
      }
      await resolveException(
        ctx,
        user._id,
        "account_transaction",
        String(transaction._id),
      );
      posted++;
      if (transaction.reversedAt && !args.dryRun) {
        const related = await ctx.db
          .query("accountTransactions")
          .withIndex("by_account", (q) =>
            q.eq("accountId", transaction.accountId),
          )
          .filter((q) => q.eq(q.field("relatedTransactionId"), transaction._id))
          .first();
        const sourceType =
          transaction.type === "expense_return"
            ? "expense_return"
            : "cash_transaction";
        const journal = await ctx.db
          .query("journalEntries")
          .withIndex("by_source", (q) =>
            q
              .eq("sourceType", sourceType)
              .eq("sourceId", String(transaction._id)),
          )
          .unique();
        if (journal?.status === "posted") {
          await reverseJournal(ctx, {
            journalId: journal._id,
            actorId: user._id,
            accountingDate: related?.transactionDate ?? transaction.reversedAt,
            reason:
              transaction.reversalReason ?? "Historical transaction reversal",
            idempotencyKey: `account-transaction-reversal:${transaction._id}`,
          });
        }
      }
    }
    return { ...page, posted, skipped, exceptions };
  },
});

export const backfill = internalMutation({
  args: { countryId: v.id("countries") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    assertCanManage(user);
    await assertCountryAccess(ctx, user, args.countryId);
    for (const key of [
      "ACCOUNTS_RECEIVABLE",
      "ACCOUNTS_PAYABLE",
      "SERVICE_REVENUE",
      "DEFERRED_REVENUE",
      "CUSTOMER_ADVANCES",
      "OPERATING_EXPENSE",
      "CAPITAL_CONTRIBUTIONS",
      "OPENING_BALANCE_EQUITY",
      "OTHER_INCOME",
    ] as const) {
      await ensureSystemAccount(ctx, user._id, args.countryId, key);
    }
    const companies = new Map(
      (await ctx.db.query("companies").collect()).map((row) => [row._id, row]),
    );
    const invoices = (await ctx.db.query("invoices").collect()).filter(
      (row) => companies.get(row.companyId)?.countryId === args.countryId,
    );
    let posted = 0;
    let advances = 0;
    for (const invoice of invoices) {
      if (
        invoice.issueDate &&
        !["draft", "cancelled", "void"].includes(invoice.status)
      ) {
        await postInvoiceIssued(ctx, user._id, invoice);
        posted++;
      }
      const payments = await ctx.db
        .query("invoicePayments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      for (const payment of payments.filter(
        (row) => row.amount > 0 && !row.reversedByPaymentId,
      )) {
        await postInvoicePayment(ctx, user._id, invoice, payment);
        posted++;
        const unappliedAmount = roundMoney(
          payment.amount - (payment.appliedAmount ?? payment.amount),
        );
        if (unappliedAmount > 0) {
          const existing = await ctx.db
            .query("customerAdvances")
            .withIndex("by_payment", (q) =>
              q.eq("originatingPaymentId", payment._id),
            )
            .unique();
          if (!existing) {
            const amountCents = toCents(unappliedAmount);
            await ctx.db.insert("customerAdvances", {
              companyId: invoice.companyId,
              originatingPaymentId: payment._id,
              currency:
                payment.receivingCurrencyNote ??
                invoice.sellerCurrency ??
                "USD",
              originalAmountCents: amountCents,
              remainingAmountCents: amountCents,
              status: "available",
              createdBy: user._id,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            await ctx.db.patch(payment._id, {
              unappliedAmount,
              extraServiceRevenueAmount: undefined,
            });
            advances++;
          }
        }
      }
    }
    const expenses = (await ctx.db.query("expenseRequests").collect()).filter(
      (row) =>
        row.countryId === args.countryId &&
        ["approved", "paid"].includes(row.status) &&
        !row.onboardingCreditId,
    );
    for (const expense of expenses) {
      await postExpenseApproved(ctx, user._id, expense);
      posted++;
      if (expense.status === "paid") {
        await postExpensePaid(ctx, user._id, expense);
        posted++;
      }
    }
    const transactions = (
      await ctx.db.query("accountTransactions").collect()
    ).filter((row) => row.countryId === args.countryId);
    for (const transaction of transactions) {
      if (transaction.type === "expense_return" && transaction.expenseId) {
        const expense = await ctx.db.get(transaction.expenseId);
        if (expense)
          await postExpenseReturn(ctx, user._id, transaction, expense);
      } else {
        await postCashTransaction(ctx, user._id, transaction);
      }
      posted++;
    }
    return { posted, customerAdvancesCreated: advances };
  },
});
