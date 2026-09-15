import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

export type AccountingSystemKey =
  | "ACCOUNTS_RECEIVABLE"
  | "ACCOUNTS_PAYABLE"
  | "SERVICE_REVENUE"
  | "DEFERRED_REVENUE"
  | "CUSTOMER_ADVANCES"
  | "OPERATING_EXPENSE"
  | "CAPITAL_CONTRIBUTIONS"
  | "OPENING_BALANCE_EQUITY"
  | "OTHER_INCOME";

const SYSTEM_ACCOUNTS: Record<
  AccountingSystemKey,
  { code: string; name: string; type: Doc<"accountingAccounts">["type"] }
> = {
  ACCOUNTS_RECEIVABLE: {
    code: "1100",
    name: "Accounts Receivable",
    type: "asset",
  },
  ACCOUNTS_PAYABLE: {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
  },
  DEFERRED_REVENUE: {
    code: "2100",
    name: "Deferred Revenue",
    type: "liability",
  },
  CUSTOMER_ADVANCES: {
    code: "2200",
    name: "Customer Advances",
    type: "liability",
  },
  CAPITAL_CONTRIBUTIONS: {
    code: "3000",
    name: "Capital Contributions",
    type: "equity",
  },
  OPENING_BALANCE_EQUITY: {
    code: "3100",
    name: "Opening Balance Equity",
    type: "equity",
  },
  SERVICE_REVENUE: {
    code: "4000",
    name: "Cloud Service Revenue",
    type: "income",
  },
  OTHER_INCOME: {
    code: "4900",
    name: "Other Operating Income",
    type: "income",
  },
  OPERATING_EXPENSE: {
    code: "5000",
    name: "Operating Expenses",
    type: "expense",
  },
};

function monthKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

async function assertOpenPeriod(
  ctx: MutationCtx,
  countryId: Id<"countries">,
  accountingDate: number,
) {
  if (!Number.isFinite(accountingDate) || accountingDate > Date.now()) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Accounting date must be valid and cannot be in the future",
    });
  }
  const period = await ctx.db
    .query("accountingPeriods")
    .withIndex("by_country_month", (q) =>
      q.eq("countryId", countryId).eq("month", monthKey(accountingDate)),
    )
    .unique();
  if (period?.status === "closed") {
    throw new ConvexError({
      code: "ACCOUNTING_PERIOD_CLOSED",
      message: `Accounting period ${period.month} is closed`,
    });
  }
}

export async function ensureSystemAccount(
  ctx: MutationCtx,
  actorId: Id<"users">,
  countryId: Id<"countries">,
  systemKey: AccountingSystemKey,
) {
  const existing = await ctx.db
    .query("accountingAccounts")
    .withIndex("by_country_system", (q) =>
      q.eq("countryId", countryId).eq("systemKey", systemKey),
    )
    .unique();
  if (existing) return existing;
  const definition = SYSTEM_ACCOUNTS[systemKey];
  const now = Date.now();
  const id = await ctx.db.insert("accountingAccounts", {
    countryId,
    ...definition,
    systemKey,
    isActive: true,
    allowManualPosting: ![
      "ACCOUNTS_RECEIVABLE",
      "ACCOUNTS_PAYABLE",
      "DEFERRED_REVENUE",
      "CUSTOMER_ADVANCES",
    ].includes(systemKey),
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

export async function ensureBankAccount(
  ctx: MutationCtx,
  actorId: Id<"users">,
  account: Doc<"receivingAccounts">,
) {
  if (!account.countryId) {
    throw new ConvexError({
      code: "ACCOUNTING_MAPPING_REQUIRED",
      message: "The physical account must have a country before posting",
    });
  }
  if (account.accountingAccountId) {
    const mapped = await ctx.db.get(account.accountingAccountId);
    if (mapped?.isActive) return mapped;
  }
  const systemKey = `BANK:${account._id}`;
  let ledgerAccount = await ctx.db
    .query("accountingAccounts")
    .withIndex("by_country_system", (q) =>
      q.eq("countryId", account.countryId!).eq("systemKey", systemKey),
    )
    .unique();
  if (!ledgerAccount) {
    const now = Date.now();
    const id = await ctx.db.insert("accountingAccounts", {
      countryId: account.countryId,
      code: `1000-${String(account._id).slice(-6).toUpperCase()}`,
      name: account.name,
      type: "asset",
      systemKey,
      currency: account.currency,
      isActive: true,
      allowManualPosting: false,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    ledgerAccount = (await ctx.db.get(id))!;
  }
  if (account.accountingAccountId !== ledgerAccount._id) {
    await ctx.db.patch(account._id, { accountingAccountId: ledgerAccount._id });
  }
  return ledgerAccount;
}

async function nextJournalNumber(
  ctx: MutationCtx,
  countryId: Id<"countries">,
  accountingDate: number,
) {
  const year = new Date(accountingDate).getUTCFullYear();
  const sequence = await ctx.db
    .query("accountingSequences")
    .withIndex("by_country_year", (q) =>
      q.eq("countryId", countryId).eq("year", year),
    )
    .unique();
  const number = sequence?.nextNumber ?? 1;
  if (sequence) {
    await ctx.db.patch(sequence._id, { nextNumber: number + 1 });
  } else {
    await ctx.db.insert("accountingSequences", {
      countryId,
      year,
      nextNumber: 2,
    });
  }
  return `JRN-${year}-${String(number).padStart(6, "0")}`;
}

export type PostingLine = {
  accountId: Id<"accountingAccounts">;
  debitCents?: number;
  creditCents?: number;
  memo?: string;
  companyId?: Id<"companies">;
  invoiceId?: Id<"invoices">;
  expenseId?: Id<"expenseRequests">;
  receivingAccountId?: Id<"receivingAccounts">;
};

export async function postJournal(
  ctx: MutationCtx,
  args: {
    actorId: Id<"users">;
    countryId: Id<"countries">;
    accountingDate: number;
    currency: string;
    description: string;
    sourceType: string;
    sourceId?: string;
    idempotencyKey: string;
    correctionReason?: string;
    lines: PostingLine[];
  },
) {
  const duplicate = await ctx.db
    .query("journalEntries")
    .withIndex("by_idempotency", (q) =>
      q.eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (duplicate) return duplicate._id;
  await assertOpenPeriod(ctx, args.countryId, args.accountingDate);
  if (args.lines.length < 2) {
    throw new ConvexError({
      code: "UNBALANCED_JOURNAL",
      message: "A journal requires at least two lines",
    });
  }
  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of args.lines) {
    const account = await ctx.db.get(line.accountId);
    if (!account?.isActive || account.countryId !== args.countryId) {
      throw new ConvexError({
        code: "ACCOUNTING_MAPPING_REQUIRED",
        message: "Every journal line requires an active account in its country",
      });
    }
    if (account.currency && account.currency !== args.currency) {
      throw new ConvexError({
        code: "ACCOUNTING_CURRENCY_MISMATCH",
        message: `${account.name} only accepts ${account.currency} postings, not ${args.currency}`,
      });
    }
    const debit = line.debitCents ?? 0;
    const credit = line.creditCents ?? 0;
    if (
      !Number.isSafeInteger(debit) ||
      !Number.isSafeInteger(credit) ||
      debit < 0 ||
      credit < 0 ||
      (debit === 0) === (credit === 0)
    ) {
      throw new ConvexError({
        code: "UNBALANCED_JOURNAL",
        message: "Each journal line must contain one positive debit or credit",
      });
    }
    debitTotal += debit;
    creditTotal += credit;
  }
  if (debitTotal !== creditTotal) {
    throw new ConvexError({
      code: "UNBALANCED_JOURNAL",
      message: `Journal debits (${debitTotal}) must equal credits (${creditTotal})`,
    });
  }
  const now = Date.now();
  const journalId = await ctx.db.insert("journalEntries", {
    journalNumber: await nextJournalNumber(
      ctx,
      args.countryId,
      args.accountingDate,
    ),
    countryId: args.countryId,
    accountingDate: args.accountingDate,
    description: args.description.trim(),
    sourceType: args.sourceType,
    sourceId: args.sourceId,
    idempotencyKey: args.idempotencyKey,
    status: "posted",
    correctionReason: args.correctionReason?.trim() || undefined,
    createdBy: args.actorId,
    createdAt: now,
    postedAt: now,
  });
  for (const line of args.lines) {
    await ctx.db.insert("journalLines", {
      journalId,
      accountId: line.accountId,
      debitCents: line.debitCents ?? 0,
      creditCents: line.creditCents ?? 0,
      currency: args.currency,
      memo: line.memo?.trim() || undefined,
      companyId: line.companyId,
      invoiceId: line.invoiceId,
      expenseId: line.expenseId,
      receivingAccountId: line.receivingAccountId,
      createdAt: now,
    });
  }
  return journalId;
}

export async function reverseJournal(
  ctx: MutationCtx,
  args: {
    journalId: Id<"journalEntries">;
    actorId: Id<"users">;
    accountingDate: number;
    reason: string;
    idempotencyKey: string;
  },
) {
  const journal = await ctx.db.get(args.journalId);
  if (!journal || journal.status !== "posted") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Only an unreversed posted journal can be reversed",
    });
  }
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_journal", (q) => q.eq("journalId", journal._id))
    .collect();
  const reversalId = await postJournal(ctx, {
    actorId: args.actorId,
    countryId: journal.countryId,
    accountingDate: args.accountingDate,
    currency: lines[0]?.currency ?? "USD",
    description: `Reversal of ${journal.journalNumber}: ${args.reason}`,
    sourceType: "journal_reversal",
    sourceId: String(journal._id),
    idempotencyKey: args.idempotencyKey,
    correctionReason: args.reason,
    lines: lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
      memo: line.memo,
      companyId: line.companyId,
      invoiceId: line.invoiceId,
      expenseId: line.expenseId,
      receivingAccountId: line.receivingAccountId,
    })),
  });
  await ctx.db.patch(journal._id, {
    status: "reversed",
    reversedById: reversalId,
  });
  await ctx.db.patch(reversalId, { reversalOfId: journal._id });
  return reversalId;
}

export async function postInvoiceIssued(
  ctx: MutationCtx,
  actorId: Id<"users">,
  invoice: Doc<"invoices">,
) {
  const company = await ctx.db.get(invoice.companyId);
  if (!company?.countryId) return;
  const amount =
    invoice.grandTotalCents ?? Math.round(invoice.grandTotal * 100);
  const grossAmount = Math.round(
    (invoice.grossBeforeCredit ?? invoice.grandTotal) * 100,
  );
  const creditAmount = Math.max(0, grossAmount - amount);
  if (grossAmount <= 0) return;
  const [receivable, income] = await Promise.all([
    ensureSystemAccount(ctx, actorId, company.countryId, "ACCOUNTS_RECEIVABLE"),
    ensureSystemAccount(
      ctx,
      actorId,
      company.countryId,
      invoice.billingTiming === "prepaid"
        ? "DEFERRED_REVENUE"
        : "SERVICE_REVENUE",
    ),
  ]);
  const lines: PostingLine[] = [
    ...(amount > 0
      ? [
          {
            accountId: receivable._id,
            debitCents: amount,
            companyId: invoice.companyId,
            invoiceId: invoice._id,
          },
        ]
      : []),
    {
      accountId: income._id,
      creditCents: grossAmount,
      companyId: invoice.companyId,
      invoiceId: invoice._id,
    },
  ];
  if (creditAmount > 0) {
    const creditExpense = await ensureSystemAccount(
      ctx,
      actorId,
      company.countryId,
      "OPERATING_EXPENSE",
    );
    lines.push({
      accountId: creditExpense._id,
      debitCents: creditAmount,
      companyId: invoice.companyId,
      invoiceId: invoice._id,
      memo: "Onboarding credit",
    });
  }
  await postJournal(ctx, {
    actorId,
    countryId: company.countryId,
    accountingDate: invoice.issueDate ?? Date.now(),
    currency: invoice.sellerCurrency ?? "USD",
    description: `Invoice ${invoice.invoiceNumber ?? invoice._id} issued`,
    sourceType: "invoice_issued",
    sourceId: String(invoice._id),
    idempotencyKey: `invoice-issued:${invoice._id}`,
    lines,
  });
}

export async function postInvoicePayment(
  ctx: MutationCtx,
  actorId: Id<"users">,
  invoice: Doc<"invoices">,
  payment: Doc<"invoicePayments">,
) {
  if (!payment.receivingAccountId || payment.amount <= 0) return;
  const [company, physicalAccount] = await Promise.all([
    ctx.db.get(invoice.companyId),
    ctx.db.get(payment.receivingAccountId),
  ]);
  if (!company?.countryId || !physicalAccount) return;
  const bank = await ensureBankAccount(ctx, actorId, physicalAccount);
  const receivable = await ensureSystemAccount(
    ctx,
    actorId,
    company.countryId,
    "ACCOUNTS_RECEIVABLE",
  );
  const total = payment.amountCents ?? Math.round(payment.amount * 100);
  const applied = Math.min(
    total,
    Math.round((payment.appliedAmount ?? payment.amount) * 100),
  );
  const unapplied = total - applied;
  const lines: PostingLine[] = [
    {
      accountId: bank._id,
      debitCents: total,
      companyId: invoice.companyId,
      invoiceId: invoice._id,
      receivingAccountId: physicalAccount._id,
    },
    {
      accountId: receivable._id,
      creditCents: applied,
      companyId: invoice.companyId,
      invoiceId: invoice._id,
    },
  ];
  if (unapplied > 0) {
    const advances = await ensureSystemAccount(
      ctx,
      actorId,
      company.countryId,
      "CUSTOMER_ADVANCES",
    );
    lines.push({
      accountId: advances._id,
      creditCents: unapplied,
      companyId: invoice.companyId,
    });
  }
  await postJournal(ctx, {
    actorId,
    countryId: company.countryId,
    accountingDate: payment.paidAt,
    currency: physicalAccount.currency,
    description: `Payment received for ${invoice.invoiceNumber ?? invoice._id}`,
    sourceType: "invoice_payment",
    sourceId: String(payment._id),
    idempotencyKey: `invoice-payment:${payment._id}`,
    lines,
  });
}

async function expenseAccount(
  ctx: MutationCtx,
  actorId: Id<"users">,
  expense: Doc<"expenseRequests">,
) {
  const category = await ctx.db.get(expense.categoryId);
  if (category?.accountingAccountId) {
    const account = await ctx.db.get(category.accountingAccountId);
    if (account?.isActive && account.countryId === expense.countryId)
      return account;
  }
  const account = await ensureSystemAccount(
    ctx,
    actorId,
    expense.countryId!,
    "OPERATING_EXPENSE",
  );
  return account;
}

export async function postExpenseApproved(
  ctx: MutationCtx,
  actorId: Id<"users">,
  expense: Doc<"expenseRequests">,
) {
  if (!expense.countryId) return;
  const amount = Math.round(expense.amount * 100);
  if (amount <= 0) return;
  const [expenseGl, payable] = await Promise.all([
    expenseAccount(ctx, actorId, expense),
    ensureSystemAccount(ctx, actorId, expense.countryId, "ACCOUNTS_PAYABLE"),
  ]);
  await postJournal(ctx, {
    actorId,
    countryId: expense.countryId,
    accountingDate: expense.expenseDate,
    currency: expense.currency,
    description: `Expense approved: ${expense.title}`,
    sourceType: "expense_approved",
    sourceId: String(expense._id),
    idempotencyKey: `expense-approved:${expense._id}`,
    lines: [
      {
        accountId: expenseGl._id,
        debitCents: amount,
        expenseId: expense._id,
        companyId: expense.companyId,
      },
      {
        accountId: payable._id,
        creditCents: amount,
        expenseId: expense._id,
        companyId: expense.companyId,
      },
    ],
  });
}

export async function postExpensePaid(
  ctx: MutationCtx,
  actorId: Id<"users">,
  expense: Doc<"expenseRequests">,
) {
  if (!expense.countryId || !expense.fundingAccountId || !expense.paidAt)
    return;
  const physicalAccount = await ctx.db.get(expense.fundingAccountId);
  if (!physicalAccount) return;
  const [bank, payable] = await Promise.all([
    ensureBankAccount(ctx, actorId, physicalAccount),
    ensureSystemAccount(ctx, actorId, expense.countryId, "ACCOUNTS_PAYABLE"),
  ]);
  const amount = Math.round(expense.amount * 100);
  await postJournal(ctx, {
    actorId,
    countryId: expense.countryId,
    accountingDate: expense.paidAt,
    currency: expense.currency,
    description: `Expense paid: ${expense.title}`,
    sourceType: "expense_payment",
    sourceId: String(expense._id),
    idempotencyKey: `expense-payment:${expense._id}`,
    lines: [
      { accountId: payable._id, debitCents: amount, expenseId: expense._id },
      {
        accountId: bank._id,
        creditCents: amount,
        expenseId: expense._id,
        receivingAccountId: physicalAccount._id,
      },
    ],
  });
}

export async function postCashTransaction(
  ctx: MutationCtx,
  actorId: Id<"users">,
  transaction: Doc<"accountTransactions">,
) {
  if (transaction.type === "expense_return" || transaction.type === "reversal")
    return;
  const physicalAccount = await ctx.db.get(transaction.accountId);
  if (!physicalAccount) return;
  const bank = await ensureBankAccount(ctx, actorId, physicalAccount);
  const counterKey: AccountingSystemKey =
    transaction.type === "capital_contribution"
      ? "CAPITAL_CONTRIBUTIONS"
      : transaction.type === "opening_balance"
        ? "OPENING_BALANCE_EQUITY"
        : "OTHER_INCOME";
  const counter = await ensureSystemAccount(
    ctx,
    actorId,
    transaction.countryId,
    counterKey,
  );
  const amount = transaction.amountCents;
  await postJournal(ctx, {
    actorId,
    countryId: transaction.countryId,
    accountingDate: transaction.transactionDate,
    currency: transaction.currency,
    description: transaction.description,
    sourceType: "cash_transaction",
    sourceId: String(transaction._id),
    idempotencyKey: `cash-transaction:${transaction._id}`,
    lines:
      transaction.direction === "incoming"
        ? [
            {
              accountId: bank._id,
              debitCents: amount,
              receivingAccountId: physicalAccount._id,
            },
            { accountId: counter._id, creditCents: amount },
          ]
        : [
            { accountId: counter._id, debitCents: amount },
            {
              accountId: bank._id,
              creditCents: amount,
              receivingAccountId: physicalAccount._id,
            },
          ],
  });
}

export async function postExpenseReturn(
  ctx: MutationCtx,
  actorId: Id<"users">,
  transaction: Doc<"accountTransactions">,
  expense: Doc<"expenseRequests">,
) {
  if (!expense.countryId) return;
  const physicalAccount = await ctx.db.get(transaction.accountId);
  if (!physicalAccount) return;
  const [bank, expenseGl] = await Promise.all([
    ensureBankAccount(ctx, actorId, physicalAccount),
    expenseAccount(ctx, actorId, expense),
  ]);
  await postJournal(ctx, {
    actorId,
    countryId: expense.countryId,
    accountingDate: transaction.transactionDate,
    currency: transaction.currency,
    description: `Expense return: ${expense.title}`,
    sourceType: "expense_return",
    sourceId: String(transaction._id),
    idempotencyKey: `expense-return:${transaction._id}`,
    lines: [
      {
        accountId: bank._id,
        debitCents: transaction.amountCents,
        expenseId: expense._id,
        receivingAccountId: physicalAccount._id,
      },
      {
        accountId: expenseGl._id,
        creditCents: transaction.amountCents,
        expenseId: expense._id,
      },
    ],
  });
}

export async function applyAvailableCustomerAdvances(
  ctx: MutationCtx,
  actorId: Id<"users">,
  invoice: Doc<"invoices">,
) {
  const company = await ctx.db.get(invoice.companyId);
  if (!company?.countryId) return 0;
  let remainingDueCents =
    invoice.balanceDueCents ?? Math.round(invoice.balanceDue * 100);
  if (remainingDueCents <= 0) return 0;
  const currency = invoice.sellerCurrency ?? "USD";
  const advances = (
    await ctx.db
      .query("customerAdvances")
      .withIndex("by_company", (q) => q.eq("companyId", invoice.companyId))
      .collect()
  )
    .filter(
      (advance) =>
        advance.status === "available" &&
        advance.currency === currency &&
        advance.remainingAmountCents > 0,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!advances.length) return 0;
  const [advanceGl, receivable] = await Promise.all([
    ensureSystemAccount(ctx, actorId, company.countryId, "CUSTOMER_ADVANCES"),
    ensureSystemAccount(ctx, actorId, company.countryId, "ACCOUNTS_RECEIVABLE"),
  ]);
  let appliedCents = 0;
  for (const advance of advances) {
    const amountCents = Math.min(
      advance.remainingAmountCents,
      remainingDueCents,
    );
    if (amountCents <= 0) break;
    const appliedAt = Date.now();
    const applicationId = await ctx.db.insert("customerAdvanceApplications", {
      advanceId: advance._id,
      invoiceId: invoice._id,
      amountCents,
      appliedBy: actorId,
      appliedAt,
    });
    await postJournal(ctx, {
      actorId,
      countryId: company.countryId,
      accountingDate: appliedAt,
      currency,
      description: `Customer advance applied to ${invoice.invoiceNumber ?? invoice._id}`,
      sourceType: "customer_advance_application",
      sourceId: String(applicationId),
      idempotencyKey: `advance-application:${applicationId}`,
      lines: [
        {
          accountId: advanceGl._id,
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
    const remainingAmountCents = advance.remainingAmountCents - amountCents;
    await ctx.db.patch(advance._id, {
      remainingAmountCents,
      status: remainingAmountCents === 0 ? "applied" : "available",
      updatedAt: appliedAt,
    });
    appliedCents += amountCents;
    remainingDueCents -= amountCents;
  }
  if (appliedCents > 0) {
    const nextAmountPaidCents =
      (invoice.amountPaidCents ?? Math.round(invoice.amountPaid * 100)) +
      appliedCents;
    await ctx.db.patch(invoice._id, {
      amountPaid: nextAmountPaidCents / 100,
      amountPaidCents: nextAmountPaidCents,
      balanceDue: remainingDueCents / 100,
      balanceDueCents: remainingDueCents,
      status: remainingDueCents === 0 ? "paid" : "partially_paid",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("invoiceEvents", {
      invoiceId: invoice._id,
      type: "payment_recorded",
      actorId,
      message: `Customer advance of ${(appliedCents / 100).toFixed(2)} applied automatically.`,
      createdAt: Date.now(),
    });
  }
  return appliedCents;
}
