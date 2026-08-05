import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCompany, isCeoOrHob } from "./authorization";

type ExpenseStatus = Doc<"expenseRequests">["status"];

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
  return user;
}

function monthFromTimestamp(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function currentMonth() {
  return monthFromTimestamp(Date.now());
}

function currentYearStartMonth() {
  return `${new Date().getUTCFullYear()}-01`;
}

function isValidMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function normalizeMonthRange(args: {
  startMonth?: string;
  endMonth?: string;
}) {
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

export const summary = query({
  args: {
    startMonth: v.optional(v.string()),
    endMonth: v.optional(v.string()),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewFinanceReports(user);
    if (args.countryId && !isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can filter finance reports by country",
      });
    }

    const { startMonth, endMonth } = normalizeMonthRange(args);
    const reportMonths = monthsBetween(startMonth, endMonth);
    const companies = await ctx.db.query("companies").collect();
    const companyMap = new Map(
      companies.map((company) => [company._id, company]),
    );
    const categoryMap = new Map(
      (await ctx.db.query("expenseCategories").collect()).map((category) => [
        category._id,
        category,
      ]),
    );

    const countryScope = isCeoOrHob(user)
      ? args.countryId
      : user.countryId;
    const visibleCompanyIds = new Set(
      companies
        .filter((company) => canViewCompany(user, company))
        .filter((company) => !countryScope || company.countryId === countryScope)
        .map((company) => company._id),
    );

    const monthly = new Map(
      reportMonths.map((month) => [
        month,
        {
          month,
          income: 0,
          expenses: 0,
          net: 0,
          paymentCount: 0,
          paidExpenseCount: 0,
        },
      ]),
    );

    const invoices = await ctx.db.query("invoices").collect();
    const invoiceMap = new Map(invoices.map((invoice) => [invoice._id, invoice]));
    const payments = await ctx.db.query("invoicePayments").collect();
    for (const payment of payments) {
      const invoice = invoiceMap.get(payment.invoiceId);
      if (!invoice) continue;
      if (invoice.isTest || invoice.hiddenAt) continue;
      if (invoice.status === "void" || invoice.status === "cancelled") {
        continue;
      }
      if (!visibleCompanyIds.has(invoice.companyId)) continue;

      const month = monthFromTimestamp(payment.paidAt);
      if (!monthInRange(month, startMonth, endMonth)) continue;
      const row = monthly.get(month);
      if (!row) continue;
      row.income = roundMoney(row.income + payment.amount);
      row.paymentCount += 1;
    }

    const categoryTotals = new Map<
      Id<"expenseCategories">,
      { categoryId: Id<"expenseCategories">; categoryName: string; total: number; count: number }
    >();
    const statusSummary = new Map(
      EXPENSE_STATUSES.map((status) => [
        status,
        { status, count: 0, total: 0 },
      ]),
    );
    const expenses = await ctx.db.query("expenseRequests").collect();
    for (const expense of expenses) {
      if (expense.archivedAt !== undefined) continue;
      if (countryScope && expense.countryId !== countryScope) continue;
      if (expense.companyId && !visibleCompanyIds.has(expense.companyId)) {
        continue;
      }
      if (!expense.companyId && !isCeoOrHob(user) && expense.countryId !== user.countryId) {
        continue;
      }

      const statusMonth = monthFromTimestamp(expense.expenseDate);
      if (monthInRange(statusMonth, startMonth, endMonth)) {
        const statusRow = statusSummary.get(expense.status);
        if (statusRow) {
          statusRow.count += 1;
          statusRow.total = roundMoney(statusRow.total + expense.amount);
        }
      }

      if (expense.status !== "paid" || !expense.paidAt) continue;
      const paidMonth = monthFromTimestamp(expense.paidAt);
      if (!monthInRange(paidMonth, startMonth, endMonth)) continue;

      const row = monthly.get(paidMonth);
      if (row) {
        row.expenses = roundMoney(row.expenses + expense.amount);
        row.paidExpenseCount += 1;
      }

      const category = categoryMap.get(expense.categoryId);
      const existing = categoryTotals.get(expense.categoryId) ?? {
        categoryId: expense.categoryId,
        categoryName: category?.name ?? "Uncategorized",
        total: 0,
        count: 0,
      };
      existing.total = roundMoney(existing.total + expense.amount);
      existing.count += 1;
      categoryTotals.set(expense.categoryId, existing);
    }

    const monthlyRows = [...monthly.values()].map((row) => ({
      ...row,
      net: roundMoney(row.income - row.expenses),
    }));
    const totals = monthlyRows.reduce(
      (acc, row) => ({
        income: roundMoney(acc.income + row.income),
        expenses: roundMoney(acc.expenses + row.expenses),
        net: roundMoney(acc.net + row.net),
        paymentCount: acc.paymentCount + row.paymentCount,
      }),
      { income: 0, expenses: 0, net: 0, paymentCount: 0 },
    );

    return {
      currency: REPORT_CURRENCY,
      startMonth,
      endMonth,
      monthly: monthlyRows,
      totals,
      topExpenseCategories: [...categoryTotals.values()].sort(
        (a, b) => b.total - a.total,
      ),
      expenseStatusSummary: [...statusSummary.values()],
    };
  },
});
