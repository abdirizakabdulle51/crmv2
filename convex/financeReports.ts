import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";
import {
  assertSupportedCurrency,
  allocateMoney,
  roundMoney,
  sumMoney,
  toCents,
} from "./money";
import {
  financialMonth,
  financialMonthStart,
  financialYear,
  historicalDateMonth,
} from "./financialDates";

type ExpenseStatus = Doc<"expenseRequests">["status"];
type FinanceReportScope = {
  startMonth: string;
  endMonth: string;
  countryScope?: Id<"countries">;
  visibleCompanyIds: Set<Id<"companies">>;
  companies: Doc<"companies">[];
  companyMap: Map<Id<"companies">, Doc<"companies">>;
  countryMap: Map<Id<"countries">, Doc<"countries">>;
  userMap: Map<Id<"users">, Doc<"users">>;
  categoryMap: Map<Id<"expenseCategories">, Doc<"expenseCategories">>;
};

const EXPENSE_STATUSES: ExpenseStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "paid",
  "cancelled",
];
const REPORT_CURRENCY = "USD";

async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  }
  assertNotMonitoring(user);
  return user;
}

function monthFromTimestamp(timestamp: number) {
  return financialMonth(timestamp);
}

function reportMonth(timestamp: number, invoice?: Doc<"invoices">) {
  return invoice?.isHistorical
    ? historicalDateMonth(timestamp)
    : monthFromTimestamp(timestamp);
}

function currentMonth() {
  return monthFromTimestamp(Date.now());
}

function currentYearStartMonth() {
  return `${financialYear(Date.now())}-01`;
}

function isValidMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function normalizeMonthRange(args: { startMonth?: string; endMonth?: string }) {
  const startMonth = args.startMonth || currentYearStartMonth();
  const endMonth = args.endMonth || currentMonth();
  if (!isValidMonth(startMonth) || !isValidMonth(endMonth)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Report month filters must use YYYY-MM format",
    });
  }
  if (startMonth > endMonth) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Start month must be before or equal to end month",
    });
  }
  return { startMonth, endMonth };
}

function monthInRange(month: string, startMonth: string, endMonth: string) {
  return month >= startMonth && month <= endMonth;
}

function monthsBetween(startMonth: string, endMonth: string) {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const months: string[] = [];
  let year = startYear;
  let month = startMonthNumber;
  while (year < endYear || (year === endYear && month <= endMonthNumber)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function lineItemRegionLabel(item: Doc<"invoices">["lineItems"][number]) {
  return (
    item.regionName || item.dataCenterName || item.regionId || "Unassigned"
  );
}

function paymentRegionAllocations(
  invoice: Doc<"invoices">,
  paymentAmount: number,
) {
  const regionBases = new Map<string, number>();
  for (const lineItem of invoice.lineItems) {
    const label = lineItemRegionLabel(lineItem);
    regionBases.set(
      label,
      (regionBases.get(label) ?? 0) + toCents(lineItem.monthlyTotal),
    );
  }

  const totalBasis = [...regionBases.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  if (totalBasis <= 0) {
    return [{ region: "Unassigned", amount: roundMoney(paymentAmount) }];
  }

  const entries = [...regionBases.entries()].filter(([, basis]) => basis > 0);
  return allocateMoney(
    paymentAmount,
    entries.map(([region, weight]) => ({ region, weight })),
  ).map(({ region, amount }) => ({ region, amount }));
}

function displayUserName(user: Doc<"users"> | undefined) {
  return user?.name ?? user?.email ?? "";
}

function displayUserEmail(user: Doc<"users"> | undefined) {
  return user?.email ?? "";
}

function assertCanViewFinanceReports(user: Doc<"users">) {
  if (isCeoOrHob(user) || user.role === "country_gm") {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to view finance reports",
  });
}

async function getReportScope(
  ctx: QueryCtx,
  user: Doc<"users">,
  args: {
    startMonth?: string;
    endMonth?: string;
    countryId?: Id<"countries">;
  },
): Promise<FinanceReportScope> {
  if (args.countryId && !isCeoOrHob(user)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message:
        "Only CEO or Head of Business can filter finance reports by country",
    });
  }

  const { startMonth, endMonth } = normalizeMonthRange(args);
  const companies = await ctx.db.query("companies").collect();
  const countryScope = isCeoOrHob(user) ? args.countryId : user.countryId;
  const visibleCompanyIds = new Set(
    companies
      .filter((company) => canViewCompany(user, company))
      .filter((company) => !countryScope || company.countryId === countryScope)
      .map((company) => company._id),
  );

  return {
    startMonth,
    endMonth,
    countryScope,
    visibleCompanyIds,
    companies,
    companyMap: new Map(companies.map((company) => [company._id, company])),
    countryMap: new Map(
      (await ctx.db.query("countries").collect()).map((country) => [
        country._id,
        country,
      ]),
    ),
    userMap: new Map(
      (await ctx.db.query("users").collect()).map((crmUser) => [
        crmUser._id,
        crmUser,
      ]),
    ),
    categoryMap: new Map(
      (await ctx.db.query("expenseCategories").collect()).map((category) => [
        category._id,
        category,
      ]),
    ),
  };
}

function isVisibleExpenseForReport(
  expense: Doc<"expenseRequests">,
  user: Doc<"users">,
  scope: FinanceReportScope,
) {
  if (expense.archivedAt !== undefined) return false;
  const expenseCompany = expense.companyId
    ? scope.companyMap.get(expense.companyId)
    : undefined;
  const expenseCountryId = expense.countryId ?? expenseCompany?.countryId;
  if (scope.countryScope && expenseCountryId !== scope.countryScope) {
    return false;
  }
  if (expense.companyId && !scope.visibleCompanyIds.has(expense.companyId)) {
    return false;
  }
  if (
    !expense.companyId &&
    !isCeoOrHob(user) &&
    expenseCountryId !== user.countryId
  ) {
    return false;
  }
  return true;
}

export const summary = query({
  args: {
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewFinanceReports(user);
    const scope = await getReportScope(ctx, user, args);
    const { startMonth, endMonth } = scope;
    const reportMonths = monthsBetween(startMonth, endMonth);

    const monthly = new Map(
      reportMonths.map((month) => [
        month,
        {
          month,
          income: 0,
          expenses: 0,
          incurredExpenses: 0,
          expenseReturns: 0,
          openingBalances: 0,
          capitalContributions: 0,
          otherNonInvoiceInflows: 0,
          otherCashInflows: 0,
          totalCashInflows: 0,
          cashOutflows: 0,
          netCashMovement: 0,
          netExpenses: 0,
          paymentCount: 0,
          paidExpenseCount: 0,
        },
      ]),
    );
    const countryPerformance = new Map<
      Id<"countries">,
      {
        countryId: Id<"countries">;
        countryName: string;
        collections: number;
        expenses: number;
        otherCashInflows: number;
        cashOutflows: number;
      }
    >();
    const countryRow = (countryId: Id<"countries">) => {
      const row = countryPerformance.get(countryId) ?? {
        countryId,
        countryName: scope.countryMap.get(countryId)?.name ?? "Unknown",
        collections: 0,
        expenses: 0,
        otherCashInflows: 0,
        cashOutflows: 0,
      };
      countryPerformance.set(countryId, row);
      return row;
    };

    const invoices = await ctx.db.query("invoices").collect();
    const invoiceMap = new Map(
      invoices.map((invoice) => [invoice._id, invoice]),
    );
    const payments = await ctx.db.query("invoicePayments").collect();
    const accounts = await ctx.db.query("receivingAccounts").collect();
    const accountMap = new Map(
      accounts.map((account) => [account._id, account]),
    );
    const accountIsVisible = (
      accountId: Id<"receivingAccounts"> | undefined,
    ) => {
      if (!accountId) return false;
      const account = accountMap.get(accountId);
      return Boolean(
        account &&
        (!scope.countryScope || account.countryId === scope.countryScope),
      );
    };
    const paymentScopeIsVisible = (
      payment: Doc<"invoicePayments">,
      invoice: Doc<"invoices">,
    ) =>
      payment.receivingAccountId === undefined
        ? scope.visibleCompanyIds.has(invoice.companyId)
        : accountIsVisible(payment.receivingAccountId);
    const reportStart = financialMonthStart(startMonth);
    let openingCashBalance = 0;
    const regionIncome = new Map<
      string,
      {
        region: string;
        income: number;
        paymentCount: number;
        invoiceIds: Set<Id<"invoices">>;
      }
    >();
    for (const payment of payments) {
      const invoice = invoiceMap.get(payment.invoiceId);
      if (!invoice) continue;
      if (!paymentScopeIsVisible(payment, invoice)) continue;
      assertSupportedCurrency(invoice.sellerCurrency);
      if (invoice.isTest || invoice.hiddenAt) continue;
      if (invoice.status === "void" || invoice.status === "cancelled") {
        continue;
      }
      if (!scope.visibleCompanyIds.has(invoice.companyId)) continue;

      if (payment.paidAt < reportStart) {
        openingCashBalance = sumMoney([openingCashBalance, payment.amount]);
        continue;
      }

      const month = reportMonth(payment.paidAt, invoice);
      if (!monthInRange(month, startMonth, endMonth)) continue;
      const row = monthly.get(month);
      if (!row) continue;
      row.income = roundMoney(row.income + payment.amount);
      row.paymentCount += 1;
      const account = payment.receivingAccountId
        ? accountMap.get(payment.receivingAccountId)
        : undefined;
      const countryId =
        payment.receivingAccountId === undefined
          ? scope.companyMap.get(invoice.companyId)?.countryId
          : account?.countryId;
      if (countryId) {
        const performance = countryRow(countryId);
        performance.collections = sumMoney([
          performance.collections,
          payment.amount,
        ]);
      }

      for (const allocation of paymentRegionAllocations(
        invoice,
        payment.amount,
      )) {
        const regionRow = regionIncome.get(allocation.region) ?? {
          region: allocation.region,
          income: 0,
          paymentCount: 0,
          invoiceIds: new Set<Id<"invoices">>(),
        };
        regionRow.income = roundMoney(regionRow.income + allocation.amount);
        regionRow.paymentCount += 1;
        regionRow.invoiceIds.add(invoice._id);
        regionIncome.set(allocation.region, regionRow);
      }
    }

    const categoryTotals = new Map<
      Id<"expenseCategories">,
      {
        categoryId: Id<"expenseCategories">;
        categoryName: string;
        total: number;
        count: number;
      }
    >();
    const statusSummary = new Map(
      EXPENSE_STATUSES.map((status) => [
        status,
        { status, count: 0, total: 0 },
      ]),
    );
    const [expenses, accountTransactions] = await Promise.all([
      ctx.db.query("expenseRequests").collect(),
      ctx.db.query("accountTransactions").collect(),
    ]);
    const transactionById = new Map(
      accountTransactions.map((transaction) => [transaction._id, transaction]),
    );
    const transactionCategory = (
      transaction: (typeof accountTransactions)[number],
    ) => {
      if (transaction.type === "reversal" && transaction.relatedTransactionId) {
        return transactionById.get(transaction.relatedTransactionId)?.type;
      }
      return transaction.type;
    };
    const returnsByExpense = new Map<Id<"expenseRequests">, number>();
    for (const transaction of accountTransactions) {
      if (!transaction.expenseId) continue;
      const signed =
        transaction.direction === "incoming"
          ? transaction.amount
          : -transaction.amount;
      returnsByExpense.set(
        transaction.expenseId,
        sumMoney([returnsByExpense.get(transaction.expenseId) ?? 0, signed]),
      );
    }
    for (const transaction of accountTransactions) {
      if (!accountIsVisible(transaction.accountId)) continue;
      const signed =
        transaction.direction === "incoming"
          ? transaction.amount
          : -transaction.amount;
      if (transaction.transactionDate < reportStart) {
        openingCashBalance = sumMoney([openingCashBalance, signed]);
        continue;
      }
      const month = monthFromTimestamp(transaction.transactionDate);
      if (!monthInRange(month, startMonth, endMonth)) continue;
      const category = transactionCategory(transaction);
      const row = monthly.get(month);
      if (!row) continue;
      if (category === "opening_balance") {
        row.openingBalances = sumMoney([row.openingBalances, signed]);
      } else if (category === "capital_contribution") {
        row.capitalContributions = sumMoney([row.capitalContributions, signed]);
      } else if (category === "other_non_invoice_inflow") {
        row.otherNonInvoiceInflows = sumMoney([
          row.otherNonInvoiceInflows,
          signed,
        ]);
      }
      if (signed > 0) {
        row.otherCashInflows = sumMoney([row.otherCashInflows, signed]);
        countryRow(transaction.countryId).otherCashInflows = sumMoney([
          countryRow(transaction.countryId).otherCashInflows,
          signed,
        ]);
      } else {
        row.cashOutflows = sumMoney([row.cashOutflows, -signed]);
        countryRow(transaction.countryId).cashOutflows = sumMoney([
          countryRow(transaction.countryId).cashOutflows,
          -signed,
        ]);
      }
    }
    for (const expense of expenses) {
      if (!isVisibleExpenseForReport(expense, user, scope)) continue;
      assertSupportedCurrency(expense.currency);

      if (
        expense.status === "paid" &&
        expense.paidAt &&
        (expense.fundingAccountId === undefined ||
          accountIsVisible(expense.fundingAccountId))
      ) {
        if (expense.paidAt < reportStart) {
          openingCashBalance = sumMoney([openingCashBalance, -expense.amount]);
        } else {
          const cashMonth = monthFromTimestamp(expense.paidAt);
          const cashRow = monthly.get(cashMonth);
          if (cashRow) {
            cashRow.cashOutflows = sumMoney([
              cashRow.cashOutflows,
              expense.amount,
            ]);
            const account = expense.fundingAccountId
              ? accountMap.get(expense.fundingAccountId)
              : undefined;
            const expenseCompany = expense.companyId
              ? scope.companyMap.get(expense.companyId)
              : undefined;
            const countryId =
              expense.fundingAccountId === undefined
                ? expense.countryId ?? expenseCompany?.countryId
                : account?.countryId;
            if (countryId) {
              const performance = countryRow(countryId);
              performance.cashOutflows = sumMoney([
                performance.cashOutflows,
                expense.amount,
              ]);
            }
          }
        }
      }

      const statusTimestamp = expense.expenseDate;
      if (expense.status === "paid") {
        const incurredMonth = monthFromTimestamp(expense.expenseDate);
        const incurredRow = monthly.get(incurredMonth);
        if (incurredRow) {
          incurredRow.incurredExpenses = sumMoney([
            incurredRow.incurredExpenses,
            expense.amount,
            -(returnsByExpense.get(expense._id) ?? 0),
          ]);
        }
      }
      if (
        statusTimestamp &&
        monthInRange(monthFromTimestamp(statusTimestamp), startMonth, endMonth)
      ) {
        const statusRow = statusSummary.get(expense.status);
        if (statusRow) {
          statusRow.count += 1;
          statusRow.total = sumMoney([statusRow.total, expense.amount]);
        }
      }

      if (expense.status !== "paid" || !expense.paidAt) continue;
      const paidMonth = monthFromTimestamp(expense.expenseDate);
      if (!monthInRange(paidMonth, startMonth, endMonth)) continue;

      const row = monthly.get(paidMonth);
      if (row) {
        row.expenses = sumMoney([row.expenses, expense.amount]);
        row.paidExpenseCount += 1;
      }
      const expenseCompany = expense.companyId
        ? scope.companyMap.get(expense.companyId)
        : undefined;
      const expenseCountryId = expense.countryId ?? expenseCompany?.countryId;
      if (expenseCountryId) {
        const performance = countryRow(expenseCountryId);
        performance.expenses = sumMoney([performance.expenses, expense.amount]);
      }

      const category = scope.categoryMap.get(expense.categoryId);
      const existing = categoryTotals.get(expense.categoryId) ?? {
        categoryId: expense.categoryId,
        categoryName: category?.name ?? "Uncategorized",
        total: 0,
        count: 0,
      };
      existing.total = sumMoney([
        existing.total,
        expense.amount,
        -(returnsByExpense.get(expense._id) ?? 0),
      ]);
      existing.count += 1;
      categoryTotals.set(expense.categoryId, existing);
    }

    const expenseById = new Map(
      expenses.map((expense) => [expense._id, expense]),
    );
    for (const transaction of accountTransactions) {
      if (!transaction.expenseId) continue;
      const expense = expenseById.get(transaction.expenseId);
      if (!expense || !isVisibleExpenseForReport(expense, user, scope))
        continue;
      const month = monthFromTimestamp(expense.expenseDate);
      if (!monthInRange(month, startMonth, endMonth)) continue;
      const signed =
        transaction.direction === "incoming"
          ? transaction.amount
          : -transaction.amount;
      const row = monthly.get(month);
      if (row) row.expenseReturns = sumMoney([row.expenseReturns, signed]);
      const expenseCompany = expense.companyId
        ? scope.companyMap.get(expense.companyId)
        : undefined;
      const countryId = expense.countryId ?? expenseCompany?.countryId;
      if (countryId) {
        const performance = countryRow(countryId);
        performance.expenses = sumMoney([performance.expenses, -signed]);
      }
    }

    const monthlyRows = [...monthly.values()].map((row) => ({
      ...row,
      totalCashInflows: sumMoney([row.income, row.otherCashInflows]),
      netExpenses: sumMoney([row.expenses, -row.expenseReturns]),
      netCashMovement: sumMoney([
        row.income,
        row.otherCashInflows,
        -row.cashOutflows,
      ]),
    }));
    const totals = monthlyRows.reduce(
      (acc, row) => ({
        income: sumMoney([acc.income, row.income]),
        expenses: sumMoney([acc.expenses, row.expenses]),
        incurredExpenses: sumMoney([
          acc.incurredExpenses,
          row.incurredExpenses,
        ]),
        expenseReturns: sumMoney([acc.expenseReturns, row.expenseReturns]),
        openingBalances: sumMoney([acc.openingBalances, row.openingBalances]),
        capitalContributions: sumMoney([
          acc.capitalContributions,
          row.capitalContributions,
        ]),
        otherNonInvoiceInflows: sumMoney([
          acc.otherNonInvoiceInflows,
          row.otherNonInvoiceInflows,
        ]),
        otherCashInflows: sumMoney([
          acc.otherCashInflows,
          row.otherCashInflows,
        ]),
        totalCashInflows: sumMoney([
          acc.totalCashInflows,
          row.totalCashInflows,
        ]),
        cashOutflows: sumMoney([acc.cashOutflows, row.cashOutflows]),
        netCashMovement: sumMoney([acc.netCashMovement, row.netCashMovement]),
        netExpenses: sumMoney([acc.netExpenses, row.netExpenses]),
        paymentCount: acc.paymentCount + row.paymentCount,
      }),
      {
        income: 0,
        expenses: 0,
        incurredExpenses: 0,
        expenseReturns: 0,
        openingBalances: 0,
        capitalContributions: 0,
        otherNonInvoiceInflows: 0,
        otherCashInflows: 0,
        totalCashInflows: 0,
        cashOutflows: 0,
        netCashMovement: 0,
        netExpenses: 0,
        paymentCount: 0,
      },
    );
    return {
      currency: REPORT_CURRENCY,
      startMonth,
      endMonth,
      monthly: monthlyRows,
      totals: {
        ...totals,
        openingCashBalance,
        closingCashBalance: sumMoney([
          openingCashBalance,
          totals.netCashMovement,
        ]),
      },
      topExpenseCategories: [...categoryTotals.values()].sort(
        (a, b) => b.total - a.total,
      ),
      expenseStatusSummary: [...statusSummary.values()],
      countryPerformance: [...countryPerformance.values()]
        .map((row) => ({
          ...row,
          totalCashInflows: sumMoney([row.collections, row.otherCashInflows]),
          net: sumMoney([
            row.collections,
            row.otherCashInflows,
            -row.cashOutflows,
          ]),
        }))
        .sort((a, b) => b.net - a.net),
      incomeByRegion: [...regionIncome.values()]
        .filter((row) => row.region !== "Unassigned")
        .map((row) => ({
          region: row.region,
          income: row.income,
          paymentCount: row.paymentCount,
          invoiceCount: row.invoiceIds.size,
        }))
        .sort((a, b) => b.income - a.income),
    };
  },
});

export const invoicePaymentsExport = query({
  args: {
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewFinanceReports(user);
    const scope = await getReportScope(ctx, user, args);
    const invoices = await ctx.db.query("invoices").collect();
    const invoiceMap = new Map(
      invoices.map((invoice) => [invoice._id, invoice]),
    );
    const payments = await ctx.db.query("invoicePayments").collect();

    return payments
      .flatMap((payment) => {
        const invoice = invoiceMap.get(payment.invoiceId);
        if (!invoice) return [];
        if (invoice.isTest || invoice.hiddenAt) return [];
        if (invoice.status === "void" || invoice.status === "cancelled") {
          return [];
        }
        if (!scope.visibleCompanyIds.has(invoice.companyId)) return [];

        const month = reportMonth(payment.paidAt, invoice);
        if (!monthInRange(month, scope.startMonth, scope.endMonth)) return [];

        const company = scope.companyMap.get(invoice.companyId);
        const country = company
          ? scope.countryMap.get(company.countryId)
          : undefined;
        const recordedBy = scope.userMap.get(payment.recordedBy);

        return [
          {
            paymentDate: payment.paidAt,
            invoiceNumber: invoice.invoiceNumber ?? "",
            customerCompany: invoice.companyName,
            country: country?.name ?? "",
            amount: roundMoney(payment.amount),
            currency: REPORT_CURRENCY,
            paymentMethod: payment.method ?? "",
            customerReference: payment.reference ?? "",
            receivingBankName: payment.receivingBankName ?? "",
            receivingAccountNumber: payment.receivingAccountNumber ?? "",
            receivingAccountName: payment.receivingAccountName ?? "",
            receivingBankLocation: payment.receivingBankLocation ?? "",
            receivingCurrencyNote: payment.receivingCurrencyNote ?? "",
            recordedByName: displayUserName(recordedBy),
            recordedByEmail: displayUserEmail(recordedBy),
            recordedAt: payment.createdAt,
            invoiceStatus: invoice.status,
            sourceReference: invoice.sourceReference ?? "",
          },
        ];
      })
      .sort((a, b) => a.paymentDate - b.paymentDate);
  },
});

export const invoicePaymentsByRegionExport = query({
  args: {
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewFinanceReports(user);
    const scope = await getReportScope(ctx, user, args);
    const invoices = await ctx.db.query("invoices").collect();
    const invoiceMap = new Map(
      invoices.map((invoice) => [invoice._id, invoice]),
    );
    const payments = await ctx.db.query("invoicePayments").collect();

    return payments
      .flatMap((payment) => {
        const invoice = invoiceMap.get(payment.invoiceId);
        if (!invoice) return [];
        if (invoice.isTest || invoice.hiddenAt) return [];
        if (invoice.status === "void" || invoice.status === "cancelled") {
          return [];
        }
        if (!scope.visibleCompanyIds.has(invoice.companyId)) return [];

        const month = reportMonth(payment.paidAt, invoice);
        if (!monthInRange(month, scope.startMonth, scope.endMonth)) return [];

        const company = scope.companyMap.get(invoice.companyId);
        const country = company
          ? scope.countryMap.get(company.countryId)
          : undefined;
        const recordedBy = scope.userMap.get(payment.recordedBy);

        return paymentRegionAllocations(invoice, payment.amount)
          .filter((allocation) => allocation.region !== "Unassigned")
          .map((allocation) => ({
            paymentDate: payment.paidAt,
            invoiceNumber: invoice.invoiceNumber ?? "",
            customerCompany: invoice.companyName,
            country: country?.name ?? "",
            region: allocation.region,
            allocatedAmount: allocation.amount,
            originalPaymentAmount: roundMoney(payment.amount),
            paymentMethod: payment.method ?? "",
            customerReference: payment.reference ?? "",
            recordedByName: displayUserName(recordedBy),
            recordedByEmail: displayUserEmail(recordedBy),
            recordedAt: payment.createdAt,
            invoiceStatus: invoice.status,
            sourceReference: invoice.sourceReference ?? "",
          }));
      })
      .sort((a, b) =>
        a.paymentDate === b.paymentDate
          ? a.region.localeCompare(b.region)
          : a.paymentDate - b.paymentDate,
      );
  },
});

export const paidExpensesExport = query({
  args: {
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewFinanceReports(user);
    const scope = await getReportScope(ctx, user, args);
    const expenses = await ctx.db.query("expenseRequests").collect();

    return expenses
      .flatMap((expense) => {
        if (!isVisibleExpenseForReport(expense, user, scope)) return [];
        if (expense.status !== "paid" || !expense.paidAt) return [];

        const month = monthFromTimestamp(expense.expenseDate);
        if (!monthInRange(month, scope.startMonth, scope.endMonth)) return [];

        const category = scope.categoryMap.get(expense.categoryId);
        const requester = scope.userMap.get(expense.requestedBy);
        const approvedBy = expense.approvedBy
          ? scope.userMap.get(expense.approvedBy)
          : undefined;
        const paidBy = expense.paidBy
          ? scope.userMap.get(expense.paidBy)
          : undefined;
        const company = expense.companyId
          ? scope.companyMap.get(expense.companyId)
          : undefined;
        const countryId = expense.countryId ?? company?.countryId;
        const country = countryId ? scope.countryMap.get(countryId) : undefined;

        return [
          {
            expenseDate: expense.expenseDate,
            paidDate: expense.paidAt,
            title: expense.title,
            category: category?.name ?? "",
            requesterName: displayUserName(requester),
            requesterEmail: displayUserEmail(requester),
            company: company?.name ?? "",
            country: country?.name ?? "",
            vendor: expense.vendor ?? "",
            amount: roundMoney(expense.amount),
            currency: expense.currency,
            paymentMethod: expense.paymentMethod ?? "",
            paymentReference: expense.paymentReference ?? "",
            paymentTransactionId: expense.paymentTransactionId ?? "",
            fundingAccountName: expense.fundingAccountName ?? "",
            fundingProviderName: expense.fundingProviderName ?? "",
            fundingAccountNumber: expense.fundingAccountNumber ?? "",
            approvedByName: displayUserName(approvedBy),
            approvedByEmail: displayUserEmail(approvedBy),
            paidByName: displayUserName(paidBy),
            paidByEmail: displayUserEmail(paidBy),
            status: expense.status,
          },
        ];
      })
      .sort((a, b) => a.expenseDate - b.expenseDate);
  },
});
