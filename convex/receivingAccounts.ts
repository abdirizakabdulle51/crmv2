import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";
import { assertSupportedCurrency, sumMoney } from "./money";

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

function required(value: string, label: string) {
  const result = value.trim();
  if (!result)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} is required`,
    });
  return result;
}

function canViewAccount(user: Doc<"users">, account: Doc<"receivingAccounts">) {
  return (
    isCeoOrHob(user) ||
    (!!user.countryId && account.countryId === user.countryId)
  );
}

export const list = query({
  args: {
    includeInactive: v.optional(v.boolean()),
    purpose: v.optional(v.union(v.literal("incoming"), v.literal("outgoing"))),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const accounts = args.includeInactive
      ? await ctx.db.query("receivingAccounts").collect()
      : await ctx.db
          .query("receivingAccounts")
          .withIndex("by_active", (q) => q.eq("isActive", true))
          .collect();
    return accounts
      .filter(
        (account) =>
          canViewAccount(user, account) &&
          (!args.purpose ||
            !account.usage ||
            account.usage === "both" ||
            account.usage === args.purpose),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    countryId: v.id("countries"),
    name: v.string(),
    providerName: v.string(),
    accountNumber: v.string(),
    accountHolderName: v.string(),
    type: v.union(
      v.literal("bank"),
      v.literal("mobile_money"),
      v.literal("cash"),
    ),
    usage: v.union(
      v.literal("incoming"),
      v.literal("outgoing"),
      v.literal("both"),
    ),
    currency: v.string(),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can manage receiving accounts",
      });
    const providerName = required(args.providerName, "Bank or provider");
    const accountNumber = required(args.accountNumber, "Account number");
    if (!(await ctx.db.get(args.countryId)))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Country not found",
      });
    const duplicate = (await ctx.db.query("receivingAccounts").collect()).find(
      (account) =>
        account.countryId === args.countryId &&
        account.providerName.toLowerCase() === providerName.toLowerCase() &&
        account.accountNumber.toLowerCase() === accountNumber.toLowerCase(),
    );
    if (duplicate)
      throw new ConvexError({
        code: "CONFLICT",
        message: "This receiving account already exists",
      });
    const now = Date.now();
    return ctx.db.insert("receivingAccounts", {
      name: required(args.name, "Account name"),
      countryId: args.countryId,
      providerName,
      accountNumber,
      accountHolderName: required(args.accountHolderName, "Account holder"),
      type: args.type,
      usage: args.usage,
      currency: assertSupportedCurrency(args.currency.trim().toUpperCase()),
      location: args.location?.trim() || undefined,
      isActive: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    accountId: v.id("receivingAccounts"),
    countryId: v.optional(v.id("countries")),
    name: v.string(),
    accountHolderName: v.string(),
    location: v.optional(v.string()),
    usage: v.union(
      v.literal("incoming"),
      v.literal("outgoing"),
      v.literal("both"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can manage finance accounts",
      });
    const account = await ctx.db.get(args.accountId);
    if (!account)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Finance account not found",
      });
    if (!account.countryId && !args.countryId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Country is required",
      });
    if (args.countryId && !(await ctx.db.get(args.countryId)))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Country not found",
      });
    await ctx.db.patch(args.accountId, {
      countryId: account.countryId ?? args.countryId,
      name: required(args.name, "Account name"),
      accountHolderName: required(args.accountHolderName, "Account holder"),
      location: args.location?.trim() || undefined,
      usage: args.usage,
      updatedAt: Date.now(),
    });
  },
});

export const setActive = mutation({
  args: { accountId: v.id("receivingAccounts"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can manage receiving accounts",
      });
    const account = await ctx.db.get(args.accountId);
    if (!account)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Receiving account not found",
      });
    await ctx.db.patch(args.accountId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
  },
});

export const collections = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
    accountId: v.optional(v.id("receivingAccounts")),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const payments = args.accountId
      ? await ctx.db
          .query("invoicePayments")
          .withIndex("by_receiving_account", (q) =>
            q.eq("receivingAccountId", args.accountId),
          )
          .collect()
      : await ctx.db.query("invoicePayments").collect();
    const rows = [];
    for (const payment of payments) {
      if (payment.paidAt < args.startDate || payment.paidAt > args.endDate)
        continue;
      const invoice = await ctx.db.get(payment.invoiceId);
      if (!invoice) continue;
      const company = await ctx.db.get(invoice.companyId);
      if (!company || !canViewCompany(user, company)) continue;
      const account = payment.receivingAccountId
        ? await ctx.db.get(payment.receivingAccountId)
        : null;
      rows.push({
        ...payment,
        transactionId: payment.transactionId ?? payment.reference,
        invoiceNumber: invoice.invoiceNumber ?? "Draft",
        companyName: company.name,
        currency: account?.currency ?? invoice.sellerCurrency ?? "USD",
        accountName:
          account?.name ?? payment.receivingBankName ?? "Legacy / unassigned",
        providerName:
          account?.providerName ?? payment.receivingBankName ?? "Unassigned",
      });
    }
    rows.sort((a, b) => b.paidAt - a.paidAt);
    const byAccount = new Map<
      string,
      {
        accountName: string;
        providerName: string;
        currency: string;
        amount: number;
        payments: number;
      }
    >();
    for (const row of rows) {
      const key = `${row.receivingAccountId ?? "legacy"}:${row.currency}`;
      const total = byAccount.get(key) ?? {
        accountName: row.accountName,
        providerName: row.providerName,
        currency: row.currency,
        amount: 0,
        payments: 0,
      };
      total.amount = sumMoney([total.amount, row.amount]);
      total.payments += 1;
      byAccount.set(key, total);
    }
    const totalsByCurrency = new Map<string, number>();
    for (const row of rows)
      totalsByCurrency.set(
        row.currency,
        sumMoney([totalsByCurrency.get(row.currency) ?? 0, row.amount]),
      );
    return {
      rows,
      byAccount: [...byAccount.values()],
      totalsByCurrency: [...totalsByCurrency].map(([currency, amount]) => ({
        currency,
        amount,
      })),
    };
  },
});

export const ledger = query({
  args: {
    accountId: v.id("receivingAccounts"),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const account = await ctx.db.get(args.accountId);
    if (!account || !canViewAccount(user, account))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Finance account not found",
      });
    const [payments, expenses] = await Promise.all([
      ctx.db
        .query("invoicePayments")
        .withIndex("by_receiving_account", (q) =>
          q.eq("receivingAccountId", account._id),
        )
        .collect(),
      ctx.db
        .query("expenseRequests")
        .withIndex("by_funding_account", (q) =>
          q.eq("fundingAccountId", account._id),
        )
        .collect(),
    ]);
    const rows: Array<{
      key: string;
      date: number;
      direction: "incoming" | "outgoing";
      description: string;
      reference: string;
      amount: number;
    }> = [];
    for (const payment of payments) {
      if (payment.paidAt < args.startDate || payment.paidAt > args.endDate)
        continue;
      const invoice = await ctx.db.get(payment.invoiceId);
      if (!invoice) continue;
      rows.push({
        key: payment._id,
        date: payment.paidAt,
        direction: "incoming",
        description: `${invoice.invoiceNumber ?? "Invoice"} · ${invoice.companyName}`,
        reference: payment.transactionId ?? payment.reference ?? "",
        amount: payment.amount,
      });
    }
    for (const expense of expenses) {
      if (
        expense.status !== "paid" ||
        !expense.paidAt ||
        expense.paidAt < args.startDate ||
        expense.paidAt > args.endDate
      )
        continue;
      rows.push({
        key: expense._id,
        date: expense.paidAt,
        direction: "outgoing",
        description: expense.title,
        reference:
          expense.paymentTransactionId ?? expense.paymentReference ?? "",
        amount: -expense.amount,
      });
    }
    rows.sort((a, b) => b.date - a.date);
    return {
      account,
      rows,
      netMovement: sumMoney(rows.map((row) => row.amount)),
    };
  },
});
