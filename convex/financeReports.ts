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
  return new Date(timestamp).toISOString().slice(0, 7);
}

function monthStartTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return Date.UTC(year, monthNumber - 1, 1);
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
          recognizedRevenue: 0,
          preCollected: 0,
          expectedCollections: 0,
          expenses: 0,
          net: 0,
          paymentCount: 0,
          paidExpenseCount: 0,
        },
      ]),
    );

    const invoices = await ctx.db.query("invoices").collect();
    const invoiceMap = new Map(
      invoices.map((invoice) => [invoice._id, invoice]),
    );
    const payments = await ctx.db.query("invoicePayments").collect();
    const paymentsByInvoice = new Map<Id<"invoices">, typeof payments>();
    for (const payment of payments) {
      const rows = paymentsByInvoice.get(payment.invoiceId) ?? [];
      rows.push(payment);
      paymentsByInvoice.set(payment.invoiceId, rows);
    }
    for (const invoice of invoices) {
      if (
        !scope.visibleCompanyIds.has(invoice.companyId) ||
        invoice.status === "draft" ||
        invoice.status === "void" ||
        invoice.status === "cancelled" ||
        !invoice.revenueAllocations?.length
      )
        continue;
      const receivableAllocations =
        invoice.receivableAllocations ?? invoice.revenueAllocations;
      const paidAllocations = allocateMoney(
        Math.min(invoice.amountPaid, invoice.grandTotal),
        receivableAllocations.map((allocation) => ({
          month: allocation.month,
          weight: allocation.amount,
        })),
      );
      const paidByMonth = new Map(
        paidAllocations.map((allocation) => [
          allocation.month,
          allocation.amount,
        ]),
      );
      const preCollectedByMonth = new Map<string, number>();
      for (const payment of paymentsByInvoice.get(invoice._id) ?? []) {
        for (const allocation of allocateMoney(payment.amount, receivableAllocations.map(
          (row) => ({ month: row.month, weight: row.amount }),
        ))) {
          if (payment.paidAt < monthStartTimestamp(allocation.month)) {
            preCollectedByMonth.set(
              allocation.month,
              sumMoney([
                preCollectedByMonth.get(allocation.month) ?? 0,
                allocation.amount,
              ]),
            );
          }
        }
      }
      for (const allocation of invoice.revenueAllocations) {
        const row = monthly.get(allocation.month);
        if (!row) continue;
        row.recognizedRevenue = sumMoney([
          row.recognizedRevenue,
          allocation.amount,
        ]);
        const receivable =
          receivableAllocations.find((row) => row.month === allocation.month)
            ?.amount ?? allocation.amount;
        const paid = paidByMonth.get(allocation.month) ?? 0;
        if (invoice.billingTiming === "prepaid") {
          row.preCollected = sumMoney([
            row.preCollected,
            preCollectedByMonth.get(allocation.month) ?? 0,
          ]);
        } else {
          row.expectedCollections = sumMoney([
            row.expectedCollections,
            receivable,
            -paid,
          ]);
        }
      }
    }
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
      assertSupportedCurrency(invoice.sellerCurrency);
      if (invoice.isTest || invoice.hiddenAt) continue;
      if (invoice.status === "void" || invoice.status === "cancelled") {
        continue;
      }
      if (!scope.visibleCompanyIds.has(invoice.companyId)) continue;

      const month = monthFromTimestamp(payment.paidAt);
      if (!monthInRange(month, startMonth, endMonth)) continue;
      const row = monthly.get(month);
      if (!row) continue;
      row.income = roundMoney(row.income + payment.amount);
      row.paymentCount += 1;

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
    const expenses = await ctx.db.query("expenseRequests").collect();
    for (const expense of expenses) {
      if (!isVisibleExpenseForReport(expense, user, scope)) continue;
      assertSupportedCurrency(expense.currency);

      const statusMonth = monthFromTimestamp(expense.expenseDate);
      if (monthInRange(statusMonth, startMonth, endMonth)) {
        const statusRow = statusSummary.get(expense.status);
        if (statusRow) {
          statusRow.count += 1;
          statusRow.total = sumMoney([statusRow.total, expense.amount]);
        }
      }

      if (expense.status !== "paid" || !expense.paidAt) continue;
      const paidMonth = monthFromTimestamp(expense.paidAt);
      if (!monthInRange(paidMonth, startMonth, endMonth)) continue;

      const row = monthly.get(paidMonth);
      if (row) {
        row.expenses = sumMoney([row.expenses, expense.amount]);
        row.paidExpenseCount += 1;
      }

      const category = scope.categoryMap.get(expense.categoryId);
      const existing = categoryTotals.get(expense.categoryId) ?? {
        categoryId: expense.categoryId,
        categoryName: category?.name ?? "Uncategorized",
        total: 0,
        count: 0,
      };
      existing.total = sumMoney([existing.total, expense.amount]);
      existing.count += 1;
      categoryTotals.set(expense.categoryId, existing);
    }

    const monthlyRows = [...monthly.values()].map((row) => ({
      ...row,
      net: sumMoney([row.income, -row.expenses]),
    }));
    const totals = monthlyRows.reduce(
      (acc, row) => ({
        income: sumMoney([acc.income, row.income]),
        recognizedRevenue: sumMoney([
          acc.recognizedRevenue,
          row.recognizedRevenue,
        ]),
        preCollected: sumMoney([acc.preCollected, row.preCollected]),
        expectedCollections: sumMoney([
          acc.expectedCollections,
          row.expectedCollections,
        ]),
        expenses: sumMoney([acc.expenses, row.expenses]),
        net: sumMoney([acc.net, row.net]),
        paymentCount: acc.paymentCount + row.paymentCount,
      }),
      {
        income: 0,
        recognizedRevenue: 0,
        preCollected: 0,
        expectedCollections: 0,
        expenses: 0,
        net: 0,
        paymentCount: 0,
      },
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
      incomeByRegion: [...regionIncome.values()]
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

        const month = monthFromTimestamp(payment.paidAt);
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

        const month = monthFromTimestamp(payment.paidAt);
        if (!monthInRange(month, scope.startMonth, scope.endMonth)) return [];

        const company = scope.companyMap.get(invoice.companyId);
        const country = company
          ? scope.countryMap.get(company.countryId)
          : undefined;
        const recordedBy = scope.userMap.get(payment.recordedBy);

        return paymentRegionAllocations(invoice, payment.amount).map(
          (allocation) => ({
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
          }),
        );
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

        const month = monthFromTimestamp(expense.paidAt);
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
            approvedByName: displayUserName(approvedBy),
            approvedByEmail: displayUserEmail(approvedBy),
            paidByName: displayUserName(paidBy),
            paidByEmail: displayUserEmail(paidBy),
            status: expense.status,
          },
        ];
      })
      .sort((a, b) => a.paidDate - b.paidDate);
  },
});
