import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { assertCanManageCompany, canViewCompany } from "./authorization";
import { buildCloudAdvisorRecommendationKey } from "./cloudAdvisorKeys";
import { generateRecommendations } from "../src/lib/recommendations/rules";

type Ctx = QueryCtx | MutationCtx;

async function getCurrentUserOrThrow(ctx: Ctx): Promise<Doc<"users">> {
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

async function getCompanyOrThrow(ctx: Ctx, companyId: Id<"companies">) {
  const company = await ctx.db.get(companyId);
  if (!company) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
  }
  return company;
}

async function assertCanManageQuote(
  ctx: Ctx,
  user: Doc<"users">,
  quote: Doc<"quotes">,
) {
  const company = await getCompanyOrThrow(ctx, quote.companyId);
  assertCanManageCompany(user, company);
}

const lineItemValidator = v.object({
  catalogItemId: v.id("serviceCatalog"),
  itemName: v.string(),
  serviceCategory: v.string(),
  billingUnit: v.string(),
  quantity: v.number(),
  monthlyUnitPrice: v.number(),
  monthlyTotal: v.number(),
  yearlyTotal: v.number(),
});

function normalizeCatalogName(value: string) {
  return value.trim().toLowerCase();
}

function isSafeQuantityOneRecommendation(
  recommendation: {
    estimateBasis?: string;
  },
  catalogItem: Doc<"serviceCatalog">,
) {
  const billingUnit = catalogItem.billingUnit.trim().toLowerCase();
  return (
    recommendation.estimateBasis?.startsWith("Flat catalog rate:") ||
    billingUnit.includes("flat")
  );
}

function findAdvisorCatalogMatch(
  catalog: Doc<"serviceCatalog">[],
  recommendation: {
    recommendedService: string;
    estimateCatalogItemName?: string;
  },
) {
  if (recommendation.estimateCatalogItemName) {
    const matches = catalog.filter(
      (item) => item.itemName === recommendation.estimateCatalogItemName,
    );
    return {
      matches,
      source: `estimate catalog item "${recommendation.estimateCatalogItemName}"`,
    };
  }

  const serviceName = normalizeCatalogName(recommendation.recommendedService);
  const matches = catalog.filter(
    (item) => normalizeCatalogName(item.itemName) === serviceName,
  );
  return {
    matches,
    source: `recommended service "${recommendation.recommendedService}"`,
  };
}

/** List quotes by company */
export const listByCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await getCompanyOrThrow(ctx, args.companyId);
    assertCanManageCompany(user, company);
    return await ctx.db
      .query("quotes")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
  },
});

/** List all quotes visible by company scope */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quotes = await ctx.db.query("quotes").collect();
    const companies = await ctx.db.query("companies").collect();
    const companyMap = new Map(
      companies.map((company) => [company._id, company]),
    );

    return quotes.filter((quote) => {
      const company = companyMap.get(quote.companyId);
      return company ? canViewCompany(user, company) : false;
    });
  },
});

/** Get a single quote by ID */
export const getById = query({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    await assertCanManageQuote(ctx, user, quote);
    return quote;
  },
});

/** Build a draft quote preview from usage entries for one company/month */
export const buildQuotePreviewFromUsage = query({
  args: { companyId: v.id("companies"), month: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await getCompanyOrThrow(ctx, args.companyId);
    assertCanManageCompany(user, company);

    const entries = await ctx.db
      .query("consumption")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
    const existingQuote = (
      await ctx.db
        .query("quotes")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .collect()
    ).find((quote) => quote.sourceMonth === args.month);
    const lineItems = [];
    const warnings = [];

    for (const entry of entries) {
      if (!entry.catalogItemId) {
        warnings.push({
          serviceType: entry.serviceType,
          amount: entry.amount,
          reason: "No catalog item linked",
        });
        continue;
      }
      if (entry.quantity == null) {
        warnings.push({
          serviceType: entry.serviceType,
          amount: entry.amount,
          reason: "Missing quantity",
        });
        continue;
      }

      const catalogItem = await ctx.db.get(entry.catalogItemId);
      if (!catalogItem) {
        warnings.push({
          serviceType: entry.serviceType,
          amount: entry.amount,
          reason: "Catalog item not found",
        });
        continue;
      }

      const monthlyTotal = entry.quantity * catalogItem.monthlyPrice;
      lineItems.push({
        catalogItemId: catalogItem._id,
        itemName: catalogItem.itemName,
        serviceCategory: catalogItem.serviceCategory,
        billingUnit: catalogItem.billingUnit,
        quantity: entry.quantity,
        monthlyUnitPrice: catalogItem.monthlyPrice,
        monthlyTotal,
        yearlyTotal: catalogItem.yearlyPrice
          ? entry.quantity * catalogItem.yearlyPrice
          : monthlyTotal * 12,
      });
    }

    return {
      lineItems,
      warnings,
      monthlyGrandTotal: lineItems.reduce(
        (sum, item) => sum + item.monthlyTotal,
        0,
      ),
      yearlyGrandTotal: lineItems.reduce(
        (sum, item) => sum + item.yearlyTotal,
        0,
      ),
      existingQuote: existingQuote
        ? {
            id: existingQuote._id,
            date: existingQuote.date,
            status: existingQuote.status,
          }
        : null,
    };
  },
});

/** Build a draft quote preview from one computed Cloud Advisor recommendation. */
export const buildQuotePreviewFromAdvisor = query({
  args: { recommendationKey: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const companies = (await ctx.db.query("companies").collect()).filter(
      (company) => canViewCompany(user, company),
    );
    const companyIds = new Set(companies.map((company) => company._id));
    const consumption = (await ctx.db.query("consumption").collect()).filter(
      (entry) => companyIds.has(entry.companyId),
    );
    const sectors = await ctx.db.query("sectors").collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const recommendations = generateRecommendations(
      companies,
      consumption,
      sectors,
      catalog,
    );

    const recommendation = recommendations.find(
      (candidate) =>
        buildCloudAdvisorRecommendationKey(
          candidate.companyId,
          candidate.rule,
          candidate.recommendedService,
        ) === args.recommendationKey,
    );

    if (!recommendation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Cloud Advisor recommendation not found",
      });
    }

    const company = await getCompanyOrThrow(ctx, recommendation.companyId);
    assertCanManageCompany(user, company);

    const warnings: string[] = [];
    const { matches, source } = findAdvisorCatalogMatch(
      catalog,
      recommendation,
    );
    const matchedCatalogItem = matches.length === 1 ? matches[0] : undefined;
    let lineItemPreview:
      | {
          catalogItemId: Id<"serviceCatalog">;
          itemName: string;
          serviceCategory: string;
          billingUnit: string;
          quantity: number;
          monthlyUnitPrice: number;
          monthlyTotal: number;
          yearlyTotal: number;
        }
      | undefined;

    if (matches.length === 0) {
      warnings.push(
        `No service catalog item matched the recommendation ${source}.`,
      );
    } else if (matches.length > 1) {
      warnings.push(
        `Multiple service catalog items matched the recommendation ${source}; select a catalog item manually.`,
      );
    } else if (matchedCatalogItem) {
      if (isSafeQuantityOneRecommendation(recommendation, matchedCatalogItem)) {
        const quantity = 1;
        const monthlyTotal = quantity * matchedCatalogItem.monthlyPrice;
        lineItemPreview = {
          catalogItemId: matchedCatalogItem._id,
          itemName: matchedCatalogItem.itemName,
          serviceCategory: matchedCatalogItem.serviceCategory,
          billingUnit: matchedCatalogItem.billingUnit,
          quantity,
          monthlyUnitPrice: matchedCatalogItem.monthlyPrice,
          monthlyTotal,
          yearlyTotal: matchedCatalogItem.yearlyPrice
            ? quantity * matchedCatalogItem.yearlyPrice
            : monthlyTotal * 12,
        };
      } else {
        warnings.push(
          "A service catalog item matched, but the recommendation does not expose a quote-safe quantity; review the quantity manually before creating a quote.",
        );
      }
    }

    return {
      companyId: recommendation.companyId,
      companyName: recommendation.companyName,
      recommendationKey: args.recommendationKey,
      recommendedService: recommendation.recommendedService,
      sourceRule: recommendation.rule,
      triggerReason: recommendation.triggerReason,
      estimateBasis: recommendation.estimateBasis,
      estimatedMonthlyValue: recommendation.estimatedMonthlyValue,
      matchedCatalogItem: matchedCatalogItem
        ? {
            catalogItemId: matchedCatalogItem._id,
            itemName: matchedCatalogItem.itemName,
            serviceCategory: matchedCatalogItem.serviceCategory,
            billingUnit: matchedCatalogItem.billingUnit,
            monthlyUnitPrice: matchedCatalogItem.monthlyPrice,
          }
        : undefined,
      lineItemPreview,
      warnings,
    };
  },
});

/** Create a new quote */
export const create = mutation({
  args: {
    companyId: v.id("companies"),
    lineItems: v.array(lineItemValidator),
    monthlyGrandTotal: v.number(),
    yearlyGrandTotal: v.number(),
    notes: v.optional(v.string()),
    sourceMonth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await getCompanyOrThrow(ctx, args.companyId);
    assertCanManageCompany(user, company);
    const now = new Date().toISOString().slice(0, 10);
    return await ctx.db.insert("quotes", {
      companyId: args.companyId,
      createdBy: user._id,
      date: now,
      status: "draft",
      lineItems: args.lineItems,
      monthlyGrandTotal: args.monthlyGrandTotal,
      yearlyGrandTotal: args.yearlyGrandTotal,
      notes: args.notes,
      sourceMonth: args.sourceMonth,
    });
  },
});

/** Update quote status */
export const updateStatus = mutation({
  args: {
    id: v.id("quotes"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    await assertCanManageQuote(ctx, user, quote);
    await ctx.db.patch(args.id, { status: args.status });
  },
});

/** Delete a quote (draft only) */
export const remove = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    await assertCanManageQuote(ctx, user, quote);
    if (quote.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only draft quotes can be deleted",
      });
    }
    await ctx.db.delete(args.id);
  },
});
