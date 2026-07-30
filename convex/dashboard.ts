import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canManageUser, isCeoOrHob } from "./authorization";
import { generateRecommendations } from "../src/lib/recommendations/rules";

type LeadStage = Doc<"leads">["stage"];

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
    return allLeads.filter((lead) => visibleCompanyIds.has(lead.companyId));
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

function canViewCloudHealth(user: Doc<"users">) {
  return (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  );
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
    const sectors = await ctx.db.query("sectors").collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const recommendations = generateRecommendations(
      companies,
      consumption,
      sectors,
      catalog,
    );
    const month = currentMonth();

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

    const thisMonthUsageTotal = consumption
      .filter((entry) => entry.month === month)
      .reduce((sum, entry) => sum + entry.amount, 0);

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

    let cloudHealth = null;
    if (canViewCloudHealth(user)) {
      const regions = await ctx.db.query("cloudCapacityRegions").collect();
      const pingTargets = await ctx.db.query("pingTargets").collect();
      const pingResults = await ctx.db.query("pingResults").collect();
      const latestByTarget = new Map<Id<"pingTargets">, Doc<"pingResults">>();
      for (const result of pingResults) {
        const existing = latestByTarget.get(result.targetId);
        if (!existing || result.checkedAt > existing.checkedAt) {
          latestByTarget.set(result.targetId, result);
        }
      }
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
      const activePingTargets = pingTargets.filter((target) => target.active);
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
        entries: consumption.filter((entry) => entry.month === month).length,
        companiesWithUsage: new Set(
          consumption
            .filter((entry) => entry.month === month)
            .map((entry) => entry.companyId),
        ).size,
      },
      quotes: quotesSummary,
      aiRecommendations: aiRecommendationsSummary,
      atRisk: {
        count: atRiskCount,
      },
      cloudHealth,
      charts: {
        accountManagers: amChartData,
        countries: countryChartData,
      },
    };
  },
});
