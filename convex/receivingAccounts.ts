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
import { assertSupportedCurrency, roundMoney, sumMoney, toCents } from "./money";

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

function signedTransactionAmount(transaction: Doc<"accountTransactions">) {
  return transaction.direction === "incoming"
    ? transaction.amount
    : -transaction.amount;
}

async function assertUniqueTransaction(
  ctx: MutationCtx,
  accountId: Doc<"receivingAccounts">["_id"],
  transactionId: string,
) {
  const [accountTransaction, invoicePayment, expense] = await Promise.all([
    ctx.db
      .query("accountTransactions")
      .withIndex("by_account_transaction", (q) =>
        q.eq("accountId", accountId).eq("transactionId", transactionId),
      )
      .first(),
    ctx.db
      .query("invoicePayments")
      .withIndex("by_account_transaction", (q) =>
        q.eq("receivingAccountId", accountId).eq("transactionId", transactionId),
      )
      .first(),
    ctx.db
      .query("expenseRequests")
      .withIndex("by_account_transaction", (q) =>
        q.eq("fundingAccountId", accountId).eq("paymentTransactionId", transactionId),
      )
      .first(),
  ]);
  if (accountTransaction || invoicePayment || expense)
    throw new ConvexError({
      code: "CONFLICT",
      message: "This transaction ID is already recorded for the account",
    });
}

async function insertAccountTransaction(
  ctx: MutationCtx,
  args: {
    account: Doc<"receivingAccounts">;
    user: Doc<"users">;
    direction: "incoming" | "outgoing";
    type:
      | "expense_return"
      | "opening_balance"
      | "capital_contribution"
      | "other_non_invoice_inflow"
      | "reversal";
    amount: number;
    transactionDate: number;
    transactionId: string;
    description: string;
    source?: string;
    expenseId?: Doc<"expenseRequests">["_id"];
    relatedTransactionId?: Doc<"accountTransactions">["_id"];
  },
) {
  const amount = roundMoney(args.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Transaction amount must be positive",
    });
  if (args.transactionDate > Date.now())
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Transaction date cannot be in the future",
    });
  const transactionId = required(args.transactionId, "Transaction ID");
  await assertUniqueTransaction(ctx, args.account._id, transactionId);
  return await ctx.db.insert("accountTransactions", {
    accountId: args.account._id,
    countryId: args.account.countryId!,
    currency: args.account.currency,
    direction: args.direction,
    type: args.type,
    amount,
    amountCents: toCents(amount),
    transactionDate: args.transactionDate,
    transactionId,
    expenseId: args.expenseId,
    relatedTransactionId: args.relatedTransactionId,
    source: args.source?.trim() || undefined,
    description: required(args.description, "Description"),
    createdBy: args.user._id,
    createdAt: Date.now(),
  });
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

export const recordNonInvoiceInflow = mutation({
  args: {
    accountId: v.id("receivingAccounts"),
    type: v.union(
      v.literal("opening_balance"),
      v.literal("capital_contribution"),
      v.literal("other_non_invoice_inflow"),
    ),
    amount: v.number(),
    transactionDate: v.number(),
    transactionId: v.string(),
    source: v.optional(v.string()),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can record non-invoice inflows",
      });
    const account = await ctx.db.get(args.accountId);
    if (!account?.isActive || !account.countryId || account.usage === "outgoing")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an active account enabled for incoming funds",
      });
    assertSupportedCurrency(account.currency);
    if (args.type === "opening_balance") {
      const openings = await ctx.db
        .query("accountTransactions")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect();
      if (openings.some((entry) => entry.type === "opening_balance" && !entry.reversedAt))
        throw new ConvexError({
          code: "CONFLICT",
          message: "This account already has an active opening balance",
        });
    }
    return await insertAccountTransaction(ctx, {
      account,
      user,
      direction: "incoming",
      type: args.type,
      amount: args.amount,
      transactionDate: args.transactionDate,
      transactionId: args.transactionId,
      source: args.source,
      description: args.description,
    });
  },
});

export const recordExpenseReturn = mutation({
  args: {
    expenseId: v.id("expenseRequests"),
    accountId: v.id("receivingAccounts"),
    amount: v.number(),
    transactionDate: v.number(),
    transactionId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can record expense returns",
      });
    const [expense, account] = await Promise.all([
      ctx.db.get(args.expenseId),
      ctx.db.get(args.accountId),
    ]);
    if (!expense || expense.status !== "paid")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only a paid expense can receive a return",
      });
    if (!account?.isActive || !account.countryId || account.usage === "outgoing")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an active account enabled for incoming funds",
      });
    const expenseCompany = expense.companyId ? await ctx.db.get(expense.companyId) : null;
    const expenseCountryId = expense.countryId ?? expenseCompany?.countryId;
    if (!expenseCountryId || account.countryId !== expenseCountryId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Return account must belong to the expense country",
      });
    if (account.currency !== expense.currency)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Return account currency must be ${expense.currency}`,
      });
    const entries = await ctx.db
      .query("accountTransactions")
      .withIndex("by_expense", (q) => q.eq("expenseId", expense._id))
      .collect();
    const returned = sumMoney(
      entries.map((entry) =>
        entry.direction === "incoming" ? entry.amount : -entry.amount,
      ),
    );
    const amount = roundMoney(args.amount);
    if (amount > roundMoney(expense.amount - returned))
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Total returns cannot exceed the original paid expense",
      });
    const transactionId = await insertAccountTransaction(ctx, {
      account,
      user,
      direction: "incoming",
      type: "expense_return",
      amount,
      transactionDate: args.transactionDate,
      transactionId: args.transactionId,
      expenseId: expense._id,
      description: `Return for ${expense.title}: ${required(args.reason, "Return reason")}`,
    });
    await ctx.db.insert("expenseEvents", {
      expenseId: expense._id,
      type: "return_recorded",
      message: `${account.currency} ${amount.toFixed(2)} returned to ${account.name} (${required(args.transactionId, "Transaction ID")})`,
      actorId: user._id,
      createdAt: Date.now(),
    });
    return transactionId;
  },
});

export const expenseReturns = query({
  args: { expenseId: v.id("expenseRequests") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const expense = await ctx.db.get(args.expenseId);
    if (!expense)
      throw new ConvexError({ code: "NOT_FOUND", message: "Expense not found" });
    const company = expense.companyId ? await ctx.db.get(expense.companyId) : null;
    if (
      !isCeoOrHob(user) &&
      expense.requestedBy !== user._id &&
      (!user.countryId || expense.countryId !== user.countryId) &&
      (!company || !canViewCompany(user, company))
    )
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot view this expense",
      });
    const entries = await ctx.db
      .query("accountTransactions")
      .withIndex("by_expense", (q) => q.eq("expenseId", expense._id))
      .collect();
    const returnedAmount = sumMoney(
      entries.map((entry) =>
        entry.direction === "incoming" ? entry.amount : -entry.amount,
      ),
    );
    return {
      originalAmount: expense.amount,
      returnedAmount,
      actualAmount: roundMoney(expense.amount - returnedAmount),
      entries: entries.sort((a, b) => b.transactionDate - a.transactionDate),
    };
  },
});

export const reverseAccountTransaction = mutation({
  args: {
    transactionId: v.id("accountTransactions"),
    reversalTransactionId: v.string(),
    transactionDate: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can reverse account transactions",
      });
    const original = await ctx.db.get(args.transactionId);
    if (!original || original.type === "reversal" || original.reversedAt)
      throw new ConvexError({ code: "BAD_REQUEST", message: "Transaction cannot be reversed" });
    const account = await ctx.db.get(original.accountId);
    if (!account)
      throw new ConvexError({ code: "NOT_FOUND", message: "Finance account not found" });
    const reason = required(args.reason, "Reversal reason");
    const reversalId = await insertAccountTransaction(ctx, {
      account,
      user,
      direction: original.direction === "incoming" ? "outgoing" : "incoming",
      type: "reversal",
      amount: original.amount,
      transactionDate: args.transactionDate,
      transactionId: args.reversalTransactionId,
      expenseId: original.expenseId,
      relatedTransactionId: original._id,
      description: `Reversal of ${original.transactionId}: ${reason}`,
    });
    const now = Date.now();
    await ctx.db.patch(original._id, {
      reversedAt: now,
      reversedBy: user._id,
      reversalReason: reason,
    });
    if (original.expenseId) {
      await ctx.db.insert("expenseEvents", {
        expenseId: original.expenseId,
        type: "return_reversed",
        message: `Return ${original.transactionId} reversed: ${reason}`,
        actorId: user._id,
        createdAt: now,
      });
    }
    return reversalId;
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
    const [payments, accountTransactions] = await Promise.all([
      args.accountId
        ? ctx.db
            .query("invoicePayments")
            .withIndex("by_receiving_account", (q) =>
              q.eq("receivingAccountId", args.accountId),
            )
            .collect()
        : ctx.db.query("invoicePayments").collect(),
      args.accountId
        ? ctx.db
            .query("accountTransactions")
            .withIndex("by_account", (q) =>
              q.eq("accountId", args.accountId!),
            )
            .collect()
        : ctx.db.query("accountTransactions").collect(),
    ]);
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
    const transactionMap = new Map(
      accountTransactions.map((transaction) => [transaction._id, transaction]),
    );
    const otherRows = [];
    for (const transaction of accountTransactions) {
      if (
        transaction.transactionDate < args.startDate ||
        transaction.transactionDate > args.endDate
      )
        continue;
      const account = await ctx.db.get(transaction.accountId);
      if (!account || !canViewAccount(user, account)) continue;
      const original = transaction.relatedTransactionId
        ? transactionMap.get(transaction.relatedTransactionId)
        : undefined;
      otherRows.push({
        ...transaction,
        category: original?.type ?? transaction.type,
        isReversal: transaction.type === "reversal",
        accountName: account.name,
        providerName: account.providerName,
        signedAmount: signedTransactionAmount(transaction),
      });
    }
    otherRows.sort(
      (a, b) =>
        b.transactionDate - a.transactionDate || b.createdAt - a.createdAt,
    );
    const otherTotalsByCurrency = new Map<string, number>();
    for (const row of otherRows) {
      otherTotalsByCurrency.set(
        row.currency,
        sumMoney([
          otherTotalsByCurrency.get(row.currency) ?? 0,
          row.signedAmount,
        ]),
      );
    }
    return {
      rows,
      otherRows,
      byAccount: [...byAccount.values()],
      totalsByCurrency: [...totalsByCurrency].map(([currency, amount]) => ({
        currency,
        amount,
      })),
      otherTotalsByCurrency: [...otherTotalsByCurrency].map(
        ([currency, amount]) => ({ currency, amount }),
      ),
    };
  },
});

export const balances = query({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const [allAccounts, allPayments, allExpenses, allTransactions] =
      await Promise.all([
        ctx.db.query("receivingAccounts").collect(),
        ctx.db.query("invoicePayments").collect(),
        ctx.db.query("expenseRequests").collect(),
        ctx.db.query("accountTransactions").collect(),
      ]);
    const accounts = allAccounts.filter((account) => canViewAccount(user, account));
    const rows = accounts.map((account) => {
      const payments = allPayments.filter(
        (payment) =>
          payment.receivingAccountId === account._id &&
          payment.paidAt <= args.asOf,
      );
      const expenses = allExpenses.filter(
        (expense) =>
          expense.fundingAccountId === account._id &&
          expense.status === "paid" &&
          expense.paidAt !== undefined &&
          expense.paidAt <= args.asOf,
      );
      const transactions = allTransactions.filter(
        (transaction) =>
          transaction.accountId === account._id &&
          transaction.transactionDate <= args.asOf,
      );
      const moneyIn = sumMoney([
        ...payments.map((payment) => payment.amount),
        ...transactions
          .filter((transaction) => transaction.direction === "incoming")
          .map((transaction) => transaction.amount),
      ]);
      const moneyOut = sumMoney([
        ...expenses.map((expense) => expense.amount),
        ...transactions
          .filter((transaction) => transaction.direction === "outgoing")
          .map((transaction) => transaction.amount),
      ]);
      const dates = [
        ...payments.map((payment) => payment.paidAt),
        ...expenses.map((expense) => expense.paidAt!),
        ...transactions.map((transaction) => transaction.transactionDate),
      ];
      return {
        account,
        moneyIn,
        moneyOut,
        balance: sumMoney([moneyIn, -moneyOut]),
        lastTransactionDate: dates.length ? Math.max(...dates) : undefined,
      };
    });
    rows.sort(
      (a, b) =>
        a.account.currency.localeCompare(b.account.currency) ||
        a.account.name.localeCompare(b.account.name),
    );
    const totals = new Map<string, number>();
    for (const row of rows) {
      totals.set(
        row.account.currency,
        sumMoney([totals.get(row.account.currency) ?? 0, row.balance]),
      );
    }
    return {
      rows,
      totalsByCurrency: [...totals].map(([currency, balance]) => ({
        currency,
        balance,
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
    const [payments, expenses, accountTransactions] = await Promise.all([
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
      ctx.db
        .query("accountTransactions")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .collect(),
    ]);
    const rows: Array<{
      key: string;
      date: number;
      direction: "incoming" | "outgoing";
      description: string;
      reference: string;
      amount: number;
      createdAt: number;
      runningBalance?: number;
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
        createdAt: payment.createdAt,
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
        createdAt: expense.updatedAt,
      });
    }
    for (const transaction of accountTransactions) {
      if (
        transaction.transactionDate < args.startDate ||
        transaction.transactionDate > args.endDate
      )
        continue;
      rows.push({
        key: transaction._id,
        date: transaction.transactionDate,
        direction: transaction.direction,
        description: transaction.description,
        reference: transaction.transactionId,
        amount:
          transaction.direction === "incoming"
            ? transaction.amount
            : -transaction.amount,
        createdAt: transaction.createdAt,
      });
    }
    rows.sort(
      (a, b) =>
        a.date - b.date ||
        a.createdAt - b.createdAt ||
        a.key.localeCompare(b.key),
    );
    let runningBalance = sumMoney([
      ...payments
        .filter((payment) => payment.paidAt < args.startDate)
        .map((payment) => payment.amount),
      ...expenses
        .filter(
          (expense) =>
            expense.status === "paid" &&
            expense.paidAt !== undefined &&
            expense.paidAt < args.startDate,
        )
        .map((expense) => -expense.amount),
      ...accountTransactions
        .filter((transaction) => transaction.transactionDate < args.startDate)
        .map(signedTransactionAmount),
    ]);
    for (const row of rows) {
      runningBalance = sumMoney([runningBalance, row.amount]);
      row.runningBalance = runningBalance;
    }
    return {
      account,
      rows,
      netMovement: sumMoney(rows.map((row) => row.amount)),
      accountBalance: runningBalance,
    };
  },
});
