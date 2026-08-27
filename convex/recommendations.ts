import { ConvexError } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { sumMoney } from "./money";
import { assertNotMonitoring, isCeoOrHob } from "./authorization";
import { buildCloudAdvisorRecommendationKey } from "./cloudAdvisorKeys";
import { generateRecommendations } from "../src/lib/recommendations/rules";

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

async function computeRecommendationsForCompanies(
  ctx: QueryCtx,
  companies: Doc<"companies">[],
) {
  const companyIds = new Set(companies.map((company) => company._id));
  const consumption = (await ctx.db.query("consumption").collect()).filter(
    (entry) => companyIds.has(entry.companyId),
  );
  const sectors = await ctx.db.query("sectors").collect();
  const catalog = await ctx.db.query("serviceCatalog").collect();

  return generateRecommendations(companies, consumption, sectors, catalog);
}

export const listComputed = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const companies = await getVisibleCompanies(ctx, user);
    const recommendations = await computeRecommendationsForCompanies(
      ctx,
      companies,
    );
    const companyIds = new Set(companies.map((company) => company._id));
    const overlays = (
      await ctx.db.query("cloudAdvisorStatuses").collect()
    ).filter((overlay) => companyIds.has(overlay.companyId));
    const overlaysByKey = new Map(
      overlays.map((overlay) => [overlay.recommendationKey, overlay]),
    );

    return recommendations.map((recommendation) => {
      const recommendationKey = buildCloudAdvisorRecommendationKey(
        recommendation.companyId,
        recommendation.rule,
        recommendation.recommendedService,
      );
      const overlay = overlaysByKey.get(recommendationKey);

      return {
        ...recommendation,
        recommendationKey,
        status: overlay?.status ?? "open",
        ...(overlay ? { statusUpdatedAt: overlay.updatedAt } : {}),
        ...(overlay?.status === "snoozed" && overlay.snoozedUntil !== undefined
          ? { snoozedUntil: overlay.snoozedUntil }
          : {}),
        ...(overlay?.note ? { note: overlay.note } : {}),
      };
    });
  },
});

export const listContextForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const companies = await ctx.db.query("companies").collect();
    const recommendations = await computeRecommendationsForCompanies(
      ctx,
      companies,
    );
    const sectors = await ctx.db.query("sectors").collect();
    const consumption = await ctx.db.query("consumption").collect();
    const tenants = await ctx.db.query("manageOneTenants").collect();

    const recommendationsByCompany = new Map<
      Id<"companies">,
      typeof recommendations
    >();
    for (const recommendation of recommendations) {
      const existing = recommendationsByCompany.get(recommendation.companyId);
      if (existing) {
        existing.push(recommendation);
      } else {
        recommendationsByCompany.set(recommendation.companyId, [
          recommendation,
        ]);
      }
    }

    const sectorMap = new Map(sectors.map((sector) => [sector._id, sector]));
    const usageByCompany = new Map<
      Id<"companies">,
      { serviceTypes: Set<string>; monthlyTotals: Map<string, number> }
    >();
    for (const entry of consumption) {
      const existing =
        usageByCompany.get(entry.companyId) ??
        ({
          serviceTypes: new Set<string>(),
          monthlyTotals: new Map<string, number>(),
        } satisfies {
          serviceTypes: Set<string>;
          monthlyTotals: Map<string, number>;
        });
      existing.serviceTypes.add(entry.serviceType);
      existing.monthlyTotals.set(
        entry.month,
        sumMoney([existing.monthlyTotals.get(entry.month) ?? 0, entry.amount]),
      );
      usageByCompany.set(entry.companyId, existing);
    }

    return companies
      .map((company) => {
        const companyRecommendations =
          recommendationsByCompany.get(company._id) ?? [];
        if (companyRecommendations.length === 0) {
          return null;
        }

        const usage = usageByCompany.get(company._id);
        const linkedTenants = tenants.filter(
          (tenant) => tenant.linkedCompanyId === company._id,
        );

        return {
          companyId: company._id,
          companyName: company.name,
          sectorName: sectorMap.get(company.sectorId)?.name ?? null,
          recommendations: companyRecommendations,
          usageSummary: {
            serviceTypes: usage ? [...usage.serviceTypes].sort() : [],
            monthlyTotals: usage
              ? [...usage.monthlyTotals.entries()]
                  .map(([month, total]) => ({ month, total }))
                  .sort((a, b) => a.month.localeCompare(b.month))
              : [],
          },
          manageOneTenants: linkedTenants.map((tenant) => ({
            name: tenant.name,
            ecsUsed: tenant.ecsUsed,
            evsUsed: tenant.evsUsed,
            projectCount: tenant.projectCount,
            resources: tenant.resources ?? [],
          })),
        };
      })
      .filter((context) => context !== null);
  },
});
