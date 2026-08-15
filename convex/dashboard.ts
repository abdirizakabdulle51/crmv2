import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canManageUser,
  isCeoOrHob,
} from "./authorization";
import { generateRecommendations } from "../src/lib/recommendations/rules";

type LeadStage = Doc<"leads">["stage"];
type Task = Doc<"tasks">;

const LEAD_STAGES: LeadStage[] = [
  "new_lead",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

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

async function getVisibleCompanies(ctx: QueryCtx, user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return await ctx.db.query("companies").collect();
  }
  if (user.role === "country_gm" && user.countryId) {
    return await ctx.db
      .query("companies")
      .withIndex("by_country", (q) => q.eq("countryId", user.countryId!))
      .collect();
  }
  return await ctx.db
    .query("companies")
    .withIndex("by_account_manager", (q) => q.eq("accountManagerId", user._id))
    .collect();
}

async function getVisibleLeads(
  ctx: QueryCtx,
  user: Doc<"users">,
  visibleCompanyIds: Set<Id<"companies">>,
) {
  if (isCeoOrHob(user)) {
    return await ctx.db.query("leads").collect();
  }
  if (user.role === "country_gm") {
    const allLeads = await ctx.db.query("leads").collect();
    return allLeads.filter(
      (lead) =>
        lead.countryId === user.countryId ||
        (lead.companyId !== undefined && visibleCompanyIds.has(lead.companyId)),
    );
  }
  return await ctx.db
    .query("leads")
    .withIndex("by_account_manager", (q) => q.eq("accountManagerId", user._id))
    .collect();
}

async function getVisibleTargets(
  ctx: QueryCtx,
  user: Doc<"users">,
  year: number,
) {
  const yearTargets = (await ctx.db.query("salesTargets").collect()).filter(
    (target) => target.year === year,
  );

  if (isCeoOrHob(user)) {
    return yearTargets;
  }

  if (user.role === "country_gm" && user.countryId) {
    const countryUsers = await ctx.db
      .query("users")
      .withIndex("by_country", (q) => q.eq("countryId", user.countryId!))
      .collect();
    const visibleUserIds = new Set([
      user._id,
      ...countryUsers.map((countryUser) => countryUser._id),
    ]);
    return yearTargets.filter(
      (target) =>
        target.accountManagerId !== undefined &&
        visibleUserIds.has(target.accountManagerId),
    );
  }

  return yearTargets.filter((target) => target.accountManagerId === user._id);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function latestUsageMonth(consumption: Doc<"consumption">[]) {
  const months = [...new Set(consumption.map((entry) => entry.month))].sort();
  const latestMonth = months.length > 0 ? months[months.length - 1] : undefined;
  return latestMonth ?? currentMonth();
}

function monthlyTotalsForCompany(
  consumption: Doc<"consumption">[],
  companyId: Id<"companies">,
) {
  const totals = new Map<string, number>();
  for (const entry of consumption) {
    if (entry.companyId !== companyId) {
      continue;
    }
    totals.set(entry.month, (totals.get(entry.month) ?? 0) + entry.amount);
  }
  return [...totals.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function isAtRisk(monthlyTotals: { month: string; total: number }[]) {
  if (monthlyTotals.length < 3) {
    return false;
  }
  const latest = monthlyTotals[monthlyTotals.length - 1].total;
  const previous = monthlyTotals[monthlyTotals.length - 2].total;
  const beforePrevious = monthlyTotals[monthlyTotals.length - 3].total;
  return latest < previous && previous < beforePrevious;
}

function percentage(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((used / total) * 1000) / 10;
}

function startOfYear(year: number) {
  return Date.UTC(year, 0, 1);
}

function endOfYear(year: number) {
  return Date.UTC(year + 1, 0, 1) - 1;
}

function monthKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function dayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function emptyFinancePeriod(period: string, label: string) {
  return {
    period,
    label,
    invoicesSent: 0,
    invoicesPaid: 0,
    expenses: 0,
  };
}

function addFinanceAmount(
  rows: Map<
    string,
    {
      period: string;
      label: string;
      invoicesSent: number;
      invoicesPaid: number;
      expenses: number;
    }
  >,
  period: string,
  label: string,
  field: "invoicesSent" | "invoicesPaid" | "expenses",
  amount: number,
) {
  const row = rows.get(period) ?? emptyFinancePeriod(period, label);
  row[field] = Math.round((row[field] + amount) * 100) / 100;
  rows.set(period, row);
}

function buildMonthlyRows(year: number) {
  return new Map(
    Array.from({ length: 12 }, (_, index) => {
      const period = `${year}-${String(index + 1).padStart(2, "0")}`;
      return [period, emptyFinancePeriod(period, monthLabel(period))] as const;
    }),
  );
}

function rowsFromMap(
  rows: Map<
    string,
    {
      period: string;
      label: string;
      invoicesSent: number;
      invoicesPaid: number;
      expenses: number;
    }
  >,
) {
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
}

function canViewCloudHealth(user: Doc<"users">) {
  return (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  );
}

async function getLatestPingResultsByTarget(
  ctx: QueryCtx,
  targets: Doc<"pingTargets">[],
) {
  const latestByTarget = new Map<Id<"pingTargets">, Doc<"pingResults">>();

  for (const target of targets) {
    const latest = await ctx.db
      .query("pingResults")
      .withIndex("by_target_checked_at", (q) => q.eq("targetId", target._id))
      .order("desc")
      .first();

    if (latest) {
      latestByTarget.set(target._id, latest);
    }
  }

  return latestByTarget;
}

function isActiveTask(task: Task) {
  return (
    task.archivedAt === undefined &&
    task.status !== "done" &&
    task.status !== "canceled"
  );
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfThisWeek() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  date.setDate(date.getDate() + 7);
  return date.getTime();
}

async function getVisibleTasks(
  ctx: QueryCtx,
  user: Doc<"users">,
  visibleCompanyIds: Set<Id<"companies">>,
) {
  const tasks = await ctx.db.query("tasks").collect();

  if (isCeoOrHob(user)) {
    return tasks;
  }

  if (user.role === "country_gm" && user.countryId) {
    const countryUsers = await ctx.db
      .query("users")
      .withIndex("by_country", (q) => q.eq("countryId", user.countryId!))
      .collect();
    const visibleUserIds = new Set([
      user._id,
      ...countryUsers.map((countryUser) => countryUser._id),
    ]);

    return tasks.filter(
      (task) =>
        visibleUserIds.has(task.createdBy) ||
        (task.assigneeId !== undefined &&
          visibleUserIds.has(task.assigneeId)) ||
        (task.reportToId !== undefined &&
          visibleUserIds.has(task.reportToId)) ||
        (task.companyId !== undefined && visibleCompanyIds.has(task.companyId)),
    );
  }

  return tasks.filter(
    (task) =>
      task.createdBy === user._id ||
      task.assigneeId === user._id ||
      task.reportToId === user._id ||
      (task.companyId !== undefined && visibleCompanyIds.has(task.companyId)),
  );
}

function buildTasksSummary(tasks: Task[], user: Doc<"users">) {
  const today = startOfToday();
  const weekEnd = endOfThisWeek();
  const myActiveTasks = tasks.filter(
    (task) => task.assigneeId === user._id && isActiveTask(task),
  );

  return {
    myOpen: myActiveTasks.length,
    overdue: myActiveTasks.filter(
      (task) => task.dueDate !== undefined && task.dueDate < today,
    ).length,
    dueThisWeek: myActiveTasks.filter(
      (task) =>
        task.dueDate !== undefined &&
        task.dueDate >= today &&
        task.dueDate <= weekEnd,
    ).length,
    blocked: myActiveTasks.filter((task) => task.status === "blocked").length,
  };
}

async function buildFinanceActivity(
  ctx: QueryCtx,
  user: Doc<"users">,
  year: number,
  companies: Doc<"companies">[],
  countries: Doc<"countries">[],
) {
  if (!isCeoOrHob(user)) {
    return null;
  }

  const yearStart = startOfYear(year);
  const yearEnd = endOfYear(year);
  const companyCountryIds = new Map(
    companies.map((company) => [company._id, company.countryId]),
  );
  const visibleCompanyIds = new Set(companies.map((company) => company._id));
  const overallMonthly = buildMonthlyRows(year);
  const overallDaily = new Map<string, ReturnType<typeof emptyFinancePeriod>>();
  const countryMonthly = new Map<
    Id<"countries">,
    ReturnType<typeof buildMonthlyRows>
  >();
  const countryDaily = new Map<
    Id<"countries">,
    Map<string, ReturnType<typeof emptyFinancePeriod>>
  >();

  const ensureCountryMonthly = (countryId: Id<"countries">) => {
    let rows = countryMonthly.get(countryId);
    if (!rows) {
      rows = buildMonthlyRows(year);
      countryMonthly.set(countryId, rows);
    }
    return rows;
  };
  const ensureCountryDaily = (countryId: Id<"countries">) => {
    let rows = countryDaily.get(countryId);
    if (!rows) {
      rows = new Map<string, ReturnType<typeof emptyFinancePeriod>>();
      countryDaily.set(countryId, rows);
    }
    return rows;
  };
  const addActivity = (
    timestamp: number | undefined,
    countryId: Id<"countries"> | undefined,
    field: "invoicesSent" | "invoicesPaid" | "expenses",
    amount: number,
  ) => {
    if (timestamp === undefined || timestamp < yearStart || timestamp > yearEnd) {
      return;
    }

    const monthlyPeriod = monthKey(timestamp);
    const dailyPeriod = dayKey(timestamp);
    addFinanceAmount(
      overallMonthly,
      monthlyPeriod,
      monthLabel(monthlyPeriod),
      field,
      amount,
    );
    addFinanceAmount(
      overallDaily,
      dailyPeriod,
      dayLabel(dailyPeriod),
      field,
      amount,
    );

    if (!countryId) {
      return;
    }

    addFinanceAmount(
      ensureCountryMonthly(countryId),
      monthlyPeriod,
      monthLabel(monthlyPeriod),
      field,
      amount,
    );
    addFinanceAmount(
      ensureCountryDaily(countryId),
      dailyPeriod,
      dayLabel(dailyPeriod),
      field,
      amount,
    );
  };

  const invoices = (await ctx.db.query("invoices").collect()).filter(
    (invoice) =>
      visibleCompanyIds.has(invoice.companyId) &&
      invoice.isTest !== true &&
      invoice.hiddenAt === undefined &&
      invoice.status !== "draft" &&
      invoice.status !== "void" &&
      invoice.status !== "cancelled",
  );
  const invoicesById = new Map(invoices.map((invoice) => [invoice._id, invoice]));
  const paidByInvoiceId = new Map<Id<"invoices">, number>();
  for (const invoice of invoices) {
    addActivity(
      invoice.sentAt ?? invoice.issueDate ?? invoice.lockedAt ?? invoice.createdAt,
      companyCountryIds.get(invoice.companyId),
      "invoicesSent",
      invoice.grandTotal,
    );
  }

  const payments = await ctx.db.query("invoicePayments").collect();
  for (const payment of payments) {
    const invoice = invoicesById.get(payment.invoiceId);
    if (!invoice) {
      continue;
    }
    paidByInvoiceId.set(
      invoice._id,
      Math.round(((paidByInvoiceId.get(invoice._id) ?? 0) + payment.amount) * 100) /
        100,
    );
    addActivity(
      payment.paidAt,
      companyCountryIds.get(invoice.companyId),
      "invoicesPaid",
      payment.amount,
    );
  }
  for (const invoice of invoices) {
    const recordedPayments = paidByInvoiceId.get(invoice._id) ?? 0;
    const unrecordedPaidAmount = Math.round((invoice.amountPaid - recordedPayments) * 100) / 100;
    if (unrecordedPaidAmount <= 0) {
      continue;
    }
    addActivity(
      invoice.updatedAt,
      companyCountryIds.get(invoice.companyId),
      "invoicesPaid",
      unrecordedPaidAmount,
    );
  }

  const expenses = (await ctx.db.query("expenseRequests").collect()).filter(
    (expense) =>
      expense.status === "paid" &&
      expense.archivedAt === undefined,
  );
  for (const expense of expenses) {
    const countryId =
      expense.countryId ??
      (expense.companyId ? companyCountryIds.get(expense.companyId) : undefined);
    addActivity(expense.paidAt ?? expense.expenseDate, countryId, "expenses", expense.amount);
  }

  const countryOptions = countries
    .filter(
      (country) =>
        countryMonthly.has(country._id) || countryDaily.has(country._id),
    )
    .map((country) => ({ id: country._id, name: country.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    countries: [{ id: "overall", name: "Overall" }, ...countryOptions],
    monthly: {
      overall: rowsFromMap(overallMonthly),
      byCountry: Object.fromEntries(
        countryOptions.map((country) => [
          country.id,
          rowsFromMap(countryMonthly.get(country.id as Id<"countries">)!),
        ]),
      ),
    },
    daily: {
      overall: rowsFromMap(overallDaily),
      byCountry: Object.fromEntries(
        countryOptions.map((country) => [
          country.id,
          rowsFromMap(
            countryDaily.get(country.id as Id<"countries">) ??
              new Map<string, ReturnType<typeof emptyFinancePeriod>>(),
          ),
        ]),
      ),
    },
  };
}

export const summary = query({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const companies = await getVisibleCompanies(ctx, user);
    const visibleCompanyIds = new Set(companies.map((company) => company._id));
    const leads = await getVisibleLeads(ctx, user, visibleCompanyIds);
    const targets = await getVisibleTargets(ctx, user, args.year);
    const users = (await ctx.db.query("users").collect()).filter((teamUser) =>
      canManageUser(user, teamUser, "view"),
    );
    const countries = await ctx.db.query("countries").collect();
    const allConsumption = await ctx.db.query("consumption").collect();
    const consumption = allConsumption.filter((entry) =>
      visibleCompanyIds.has(entry.companyId),
    );
    const quotes = (await ctx.db.query("quotes").collect()).filter((quote) =>
      visibleCompanyIds.has(quote.companyId),
    );
    const tasks = await getVisibleTasks(ctx, user, visibleCompanyIds);
    const sectors = await ctx.db.query("sectors").collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const recommendations = generateRecommendations(
      companies,
      consumption,
      sectors,
      catalog,
    );
    const month = latestUsageMonth(consumption);

    const activeCompanies = companies.filter(
      (company) => company.contractStatus === "active",
    ).length;
    const activeLeads = leads.filter(
      (lead) => lead.stage !== "won" && lead.stage !== "lost",
    ).length;
    const wonLeads = leads.filter((lead) => lead.stage === "won");
    const totalWonValue = wonLeads.reduce(
      (sum, lead) => sum + lead.potentialValue,
      0,
    );
    const companyWideTarget = targets.reduce(
      (sum, target) => sum + target.target,
      0,
    );
    const targetAchievementPercent =
      companyWideTarget > 0
        ? Math.round((totalWonValue / companyWideTarget) * 100)
        : 0;

    const stageCounts = Object.fromEntries(
      LEAD_STAGES.map((stage) => [
        stage,
        leads.filter((lead) => lead.stage === stage).length,
      ]),
    ) as Record<LeadStage, number>;
    const pipelineValue = leads
      .filter((lead) => lead.stage !== "won" && lead.stage !== "lost")
      .reduce((sum, lead) => sum + lead.potentialValue, 0);

    const usageEntriesForMonth = consumption.filter(
      (entry) => entry.month === month,
    );
    const thisMonthUsageTotal = usageEntriesForMonth.reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );

    const quotesSummary = {
      total: quotes.length,
      draft: quotes.filter((quote) => quote.status === "draft").length,
      sent: quotes.filter((quote) => quote.status === "sent").length,
      accepted: quotes.filter((quote) => quote.status === "accepted").length,
      monthlyValue: quotes.reduce(
        (sum, quote) => sum + quote.monthlyGrandTotal,
        0,
      ),
      acceptedMonthlyValue: quotes
        .filter((quote) => quote.status === "accepted")
        .reduce((sum, quote) => sum + quote.monthlyGrandTotal, 0),
    };

    const aiRecommendationsSummary = {
      openOpportunityCount: recommendations.length,
      highPriorityCount: recommendations.filter(
        (recommendation) => recommendation.priority === "high",
      ).length,
      estimatedMonthlyValue: recommendations.reduce(
        (sum, recommendation) =>
          sum + (recommendation.estimatedMonthlyValue ?? 0),
        0,
      ),
      companiesWithOpportunities: new Set(
        recommendations.map((recommendation) => recommendation.companyId),
      ).size,
    };

    const atRiskCount = companies.filter((company) =>
      isAtRisk(monthlyTotalsForCompany(consumption, company._id)),
    ).length;

    const accountManagers = users.filter(
      (teamUser) =>
        teamUser.role === "account_manager" ||
        teamUser.role === "country_gm" ||
        teamUser.role === "head_of_business" ||
        teamUser.role === "ceo",
    );
    const amChartData = accountManagers.map((accountManager) => {
      const amTargets = targets.filter(
        (target) => target.accountManagerId === accountManager._id,
      );
      const totalTarget = amTargets.reduce(
        (sum, target) => sum + target.target,
        0,
      );
      const amWonLeads = wonLeads.filter(
        (lead) => lead.accountManagerId === accountManager._id,
      );
      const achieved = amWonLeads.reduce(
        (sum, lead) => sum + lead.potentialValue,
        0,
      );
      return {
        name: accountManager.name?.split(" ")[0] || "Unknown",
        fullName: accountManager.name || "Unknown",
        target: totalTarget,
        achieved,
        percentage:
          totalTarget > 0 ? Math.round((achieved / totalTarget) * 100) : 0,
      };
    });
    const countryChartData = countries
      .map((country) => {
        const countryUsers = accountManagers.filter(
          (accountManager) => accountManager.countryId === country._id,
        );
        const userIds = new Set(
          countryUsers.map((countryUser) => countryUser._id),
        );
        const countryTargets = targets.filter(
          (target) =>
            target.accountManagerId !== undefined &&
            userIds.has(target.accountManagerId),
        );
        const target = countryTargets.reduce(
          (sum, salesTarget) => sum + salesTarget.target,
          0,
        );
        const achieved = wonLeads
          .filter(
            (lead) =>
              lead.accountManagerId !== undefined &&
              userIds.has(lead.accountManagerId),
          )
          .reduce((sum, lead) => sum + lead.potentialValue, 0);
        return {
          name: country.name,
          target,
          achieved,
          percentage: target > 0 ? Math.round((achieved / target) * 100) : 0,
        };
      })
      .filter((country) => country.target > 0 || country.achieved > 0);
    const financeActivity = await buildFinanceActivity(
      ctx,
      user,
      args.year,
      companies,
      countries,
    );

    let cloudHealth = null;
    if (canViewCloudHealth(user)) {
      const regions = await ctx.db.query("cloudCapacityRegions").collect();
      const pingTargets = await ctx.db.query("pingTargets").collect();
      const activePingTargets = pingTargets.filter((target) => target.active);
      const latestByTarget = await getLatestPingResultsByTarget(
        ctx,
        activePingTargets,
      );
      const regionSummaries = regions.map((region) => {
        const maxUsedPercent = Math.max(
          percentage(region.cpuUsed, region.cpuTotal),
          percentage(region.memoryUsedGb, region.memoryTotalGb),
          percentage(region.storageUsedGb, region.storageTotalGb),
        );
        return {
          regionId: region.regionId,
          regionName: region.regionName,
          maxUsedPercent,
          status:
            maxUsedPercent >= 90
              ? ("critical" as const)
              : maxUsedPercent >= 70
                ? ("warning" as const)
                : ("healthy" as const),
        };
      });
      const downTargets = activePingTargets.filter(
        (target) => latestByTarget.get(target._id)?.success === false,
      ).length;
      cloudHealth = {
        regions: regionSummaries.length,
        healthyRegions: regionSummaries.filter(
          (region) => region.status === "healthy",
        ).length,
        warningRegions: regionSummaries.filter(
          (region) => region.status === "warning",
        ).length,
        criticalRegions: regionSummaries.filter(
          (region) => region.status === "critical",
        ).length,
        activePingTargets: activePingTargets.length,
        upPingTargets: activePingTargets.length - downTargets,
        downPingTargets: downTargets,
      };
    }

    return {
      year: args.year,
      month,
      companies: {
        total: companies.length,
        activeContracts: activeCompanies,
      },
      leads: {
        active: activeLeads,
        won: wonLeads.length,
        wonValue: totalWonValue,
      },
      targets: {
        target: companyWideTarget,
        achieved: totalWonValue,
        achievementPercent: targetAchievementPercent,
      },
      pipeline: {
        stageCounts,
        value: pipelineValue,
      },
      usage: {
        month,
        total: thisMonthUsageTotal,
        entries: usageEntriesForMonth.length,
        companiesWithUsage: new Set(
          usageEntriesForMonth.map((entry) => entry.companyId),
        ).size,
      },
      quotes: quotesSummary,
      aiRecommendations: aiRecommendationsSummary,
      atRisk: {
        count: atRiskCount,
      },
      tasks: buildTasksSummary(tasks, user),
      cloudHealth,
      charts: {
        accountManagers: amChartData,
        countries: countryChartData,
      },
      financeActivity,
    };
  },
});
