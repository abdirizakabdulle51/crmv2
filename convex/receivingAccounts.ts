import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
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

const normalizeAccountNumber = (value: string) =>
  required(value, "Account number")
    .replace(/[\s-]+/g, "")
    .toUpperCase();
const accountSearchText = (name: string, provider: string, number: string) =>
  `${name} ${provider} ${number}`.trim().toLowerCase();

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

export const listPage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    countryId: v.optional(v.id("countries")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only finance leadership can manage all accounts",
      });
    const term = args.search?.trim().toLowerCase();
    return term
      ? await ctx.db
          .query("receivingAccounts")
          .withSearchIndex("search_accounts", (q) => {
            const result = q.search("searchText", term);
            return args.countryId
              ? result.eq("countryId", args.countryId)
              : result;
          })
          .paginate(args.paginationOpts)
      : args.countryId
        ? await ctx.db
            .query("receivingAccounts")
            .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
            .paginate(args.paginationOpts)
        : await ctx.db.query("receivingAccounts").paginate(args.paginationOpts);
  },
});

export const create = mutation({
  args: {
    countryId: v.id("countries"),
    institutionId: v.optional(v.id("financialInstitutions")),
    name: v.string(),
    providerName: v.optional(v.string()),
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
    const accountNumber = required(args.accountNumber, "Account number");
    if (!(await ctx.db.get(args.countryId)))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Country not found",
      });
    const institution = args.institutionId
      ? await ctx.db.get(args.institutionId)
      : null;
    if (args.type !== "cash" && (!institution || !institution.isActive))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an active registered bank or provider",
      });
    if (
      institution &&
      (institution.countryId !== args.countryId ||
        institution.type !== args.type)
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Institution must match the account country and type",
      });
    const providerName =
      institution?.name ??
      required(args.providerName ?? "Cash", "Bank or provider");
    const uniquenessKey =
      args.type === "cash"
        ? undefined
        : `${args.institutionId}:${normalizeAccountNumber(accountNumber)}`;
    const indexedDuplicate = uniquenessKey
      ? await ctx.db
          .query("receivingAccounts")
          .withIndex("by_uniqueness_key", (q) =>
            q.eq("uniquenessKey", uniquenessKey),
          )
          .unique()
      : null;
    const legacyDuplicate = uniquenessKey
      ? (await ctx.db.query("receivingAccounts").collect()).find(
          (account) =>
            !account.uniquenessKey &&
            account.countryId === args.countryId &&
            account.providerName.trim().toLowerCase() ===
              providerName.toLowerCase() &&
            normalizeAccountNumber(account.accountNumber) ===
              normalizeAccountNumber(accountNumber),
        )
      : null;
    if (indexedDuplicate || legacyDuplicate)
      throw new ConvexError({
        code: "CONFLICT",
        message: "This receiving account already exists",
      });
    const now = Date.now();
    const name = required(args.name, "Account name");
    return ctx.db.insert("receivingAccounts", {
      name,
      countryId: args.countryId,
      institutionId: args.institutionId,
      providerName,
      accountNumber,
      uniquenessKey,
      searchText: accountSearchText(name, providerName, accountNumber),
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
    institutionId: v.optional(v.id("financialInstitutions")),
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
    let identityFields = {};
    if (
      !account.institutionId &&
      account.type !== "cash" &&
      args.institutionId
    ) {
      const institution = await ctx.db.get(args.institutionId);
      const countryId = account.countryId ?? args.countryId;
      if (
        !institution?.isActive ||
        institution.countryId !== countryId ||
        institution.type !== account.type
      )
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Institution must be active and match the account country and type",
        });
      const uniquenessKey = `${institution._id}:${normalizeAccountNumber(account.accountNumber)}`;
      const duplicate = await ctx.db
        .query("receivingAccounts")
        .withIndex("by_uniqueness_key", (q) =>
          q.eq("uniquenessKey", uniquenessKey),
        )
        .unique();
      if (duplicate && duplicate._id !== account._id)
        throw new ConvexError({
          code: "CONFLICT",
          message: "This finance account already exists",
        });
      identityFields = {
        institutionId: institution._id,
        providerName: institution.name,
        uniquenessKey,
      };
    }
    const name = required(args.name, "Account name");
    const providerName =
      "providerName" in identityFields
        ? (identityFields.providerName as string)
        : account.providerName;
    await ctx.db.patch(args.accountId, {
      ...identityFields,
      countryId: account.countryId ?? args.countryId,
      name,
      searchText: accountSearchText(name, providerName, account.accountNumber),
      accountHolderName: required(args.accountHolderName, "Account holder"),
      location: args.location?.trim() || undefined,
      usage: args.usage,
      updatedAt: Date.now(),
    });
  },
});

export const migrateLegacyInstitutions = mutation({
  args: {},
  handler: async (ctx) => {
    const current = await currentUser(ctx);
    if (!isCeoOrHob(current))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can migrate accounts",
      });
    const [accounts, institutionRows] = await Promise.all([
      ctx.db.query("receivingAccounts").collect(),
      ctx.db.query("financialInstitutions").collect(),
    ]);
    const institutions = [...institutionRows];
    const usedKeys = new Set(
      accounts.flatMap((account) =>
        account.uniquenessKey ? [account.uniquenessKey] : [],
      ),
    );
    let linked = 0,
      created = 0,
      unresolved = 0,
      conflicts = 0;
    for (const account of accounts.filter(
      (row) => row.type !== "cash" && !row.institutionId,
    )) {
      if (!account.countryId) {
        unresolved += 1;
        continue;
      }
      let match = institutions.find(
        (institution) =>
          institution.countryId === account.countryId &&
          institution.type === account.type &&
          institution.normalizedName ===
            account.providerName.trim().replace(/\s+/g, " ").toLowerCase(),
      );
      if (!match) {
        const now = Date.now();
        const institutionId = await ctx.db.insert("financialInstitutions", {
          countryId: account.countryId,
          name: account.providerName.trim(),
          normalizedName: account.providerName
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase(),
          type: account.type as "bank" | "mobile_money",
          isActive: true,
          createdBy: current._id,
          createdAt: now,
          updatedAt: now,
        });
        match = (await ctx.db.get(institutionId))!;
        institutions.push(match);
        created += 1;
      }
      const uniquenessKey = `${match._id}:${normalizeAccountNumber(account.accountNumber)}`;
      if (usedKeys.has(uniquenessKey)) {
        conflicts += 1;
        continue;
      }
      await ctx.db.patch(account._id, {
        institutionId: match._id,
        providerName: match.name,
        uniquenessKey,
        searchText: accountSearchText(
          account.name,
          match.name,
          account.accountNumber,
        ),
        updatedAt: Date.now(),
      });
      linked += 1;
      usedKeys.add(uniquenessKey);
    }
    return { linked, created, unresolved, conflicts };
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
