import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertCanManageCompany,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";
import { buildCloudAdvisorRecommendationKey } from "./cloudAdvisorKeys";
import { generateRecommendations } from "../src/lib/recommendations/rules";

type Ctx = QueryCtx | MutationCtx;
type DiscountApprovalLevel =
  | "self"
  | "account_manager"
  | "country_gm"
  | "head_of_business"
  | "ceo";

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
  assertNotMonitoring(user);
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
  regionId: v.optional(v.string()),
  regionName: v.optional(v.string()),
  dataCenterName: v.optional(v.string()),
});

function optionalRegionFields(entry: {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return {
    ...(entry.regionId ? { regionId: entry.regionId } : {}),
    ...(entry.regionName ? { regionName: entry.regionName } : {}),
    ...(entry.dataCenterName ? { dataCenterName: entry.dataCenterName } : {}),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizedDiscountPercent(value?: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function calculateQuoteTotals(
  lineItems: Array<{
    monthlyTotal: number;
    yearlyTotal: number;
  }>,
  discountPercent?: number,
) {
  const normalizedDiscount = normalizedDiscountPercent(discountPercent);
  const monthlySubtotal = roundMoney(
    lineItems.reduce((sum, item) => sum + item.monthlyTotal, 0),
  );
  const yearlySubtotal = roundMoney(
    lineItems.reduce((sum, item) => sum + item.yearlyTotal, 0),
  );
  const monthlyDiscountTotal = roundMoney(
    monthlySubtotal * (normalizedDiscount / 100),
  );
  const yearlyDiscountTotal = roundMoney(
    yearlySubtotal * (normalizedDiscount / 100),
  );

  return {
    discountPercent: normalizedDiscount,
    monthlySubtotal,
    yearlySubtotal,
    monthlyDiscountTotal,
    yearlyDiscountTotal,
    monthlyGrandTotal: roundMoney(monthlySubtotal - monthlyDiscountTotal),
    yearlyGrandTotal: roundMoney(yearlySubtotal - yearlyDiscountTotal),
  };
}

function discountApprovalLevelForPercent(
  discountPercent: number,
): DiscountApprovalLevel {
  if (discountPercent <= 5) return "self";
  if (discountPercent <= 10) return "account_manager";
  if (discountPercent <= 15) return "country_gm";
  if (discountPercent <= 25) return "head_of_business";
  return "ceo";
}

function discountLimitForUser(user: Doc<"users">) {
  switch (user.role) {
    case "ceo":
      return 50;
    case "head_of_business":
      return 25;
    case "country_gm":
      return 15;
    case "account_manager":
      return 10;
    default:
      return 5;
  }
}

function discountLevelLabel(level: DiscountApprovalLevel) {
  switch (level) {
    case "account_manager":
      return "Account Manager";
    case "country_gm":
      return "Country Manager";
    case "head_of_business":
      return "HOB";
    case "ceo":
      return "CEO";
    default:
      return "Team";
  }
}

function assertDiscountCanProceed(quote: Doc<"quotes">) {
  const discountPercent = quote.discountPercent ?? 0;
  if (discountPercent <= 0) return;
  if (quote.discountApprovalStatus === "pending") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Discount approval is still pending. It must be approved before this quote can proceed.",
    });
  }
  if (quote.discountApprovalStatus === "rejected") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Discount approval was rejected. Change or remove the discount before this quote can proceed.",
    });
  }
}

async function findDiscountApprovers(
  ctx: MutationCtx,
  company: Doc<"companies">,
  level: DiscountApprovalLevel,
) {
  const users = await ctx.db.query("users").collect();
  const activeUsers = users.filter((user) => !user.isDisabled);

  if (level === "account_manager" && company.accountManagerId) {
    const accountManager = await ctx.db.get(company.accountManagerId);
    if (accountManager && !accountManager.isDisabled) {
      return [accountManager];
    }
  }

  const roleOrder =
    level === "account_manager"
      ? ["account_manager", "country_gm", "head_of_business", "ceo"]
      : level === "country_gm"
        ? ["country_gm", "head_of_business", "ceo"]
        : level === "head_of_business"
          ? ["head_of_business", "ceo"]
          : level === "ceo"
            ? ["ceo"]
            : [];

  for (const role of roleOrder) {
    const matches = activeUsers.filter((user) => {
      if (user.role !== role) return false;
      if (role === "country_gm") {
        return user.countryId === company.countryId;
      }
      if (role === "account_manager") {
        return user._id === company.accountManagerId;
      }
      return true;
    });
    if (matches.length > 0) return matches;
  }

  return [];
}

async function notifyDiscountApprovers(
  ctx: MutationCtx,
  args: {
    quote: Doc<"quotes">;
    company: Doc<"companies">;
    requester: Doc<"users">;
    level: DiscountApprovalLevel;
    discountPercent: number;
  },
) {
  const approvers = await findDiscountApprovers(ctx, args.company, args.level);
  const now = Date.now();
  await Promise.all(
    approvers
      .filter((approver) => approver._id !== args.requester._id)
      .map((approver) =>
        ctx.db.insert("notifications", {
          recipientId: approver._id,
          actorId: args.requester._id,
          type: "quote_discount_approval_requested",
          title: "Quote discount approval requested",
          body: `${args.discountPercent}% discount for ${args.company.name} requires ${discountLevelLabel(args.level)} approval.`,
          entityType: "quote",
          entityId: args.quote._id,
          href: `/quotes/${args.quote._id}`,
          createdAt: now,
        }),
      ),
  );
}

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

function quoteNumberForSequence(now: Date, sequence: number) {
  return `Q-${now.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}

async function nextQuoteNumber(ctx: MutationCtx, now: Date) {
  const year = now.getUTCFullYear();
  const prefix = `Q-${year}-`;
  const quotes = await ctx.db.query("quotes").collect();
  const issuedThisYear = quotes
    .map((quote) => quote.quoteNumber)
    .filter(
      (quoteNumber): quoteNumber is string =>
        typeof quoteNumber === "string" && quoteNumber.startsWith(prefix),
    );
  return quoteNumberForSequence(now, issuedThisYear.length + 1);
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
        ...optionalRegionFields(entry),
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
    discountPercent: v.optional(v.number()),
    notes: v.optional(v.string()),
    sourceMonth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await getCompanyOrThrow(ctx, args.companyId);
    assertCanManageCompany(user, company);
    const now = new Date();
    const totals = calculateQuoteTotals(args.lineItems, args.discountPercent);
    if (totals.discountPercent > 50) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Discounts above 50% require CEO review outside CRM.",
      });
    }
    const approvalLevel = discountApprovalLevelForPercent(
      totals.discountPercent,
    );
    const isApprovedByRequester =
      totals.discountPercent <= discountLimitForUser(user);
    const quoteId = await ctx.db.insert("quotes", {
      companyId: args.companyId,
      createdBy: user._id,
      quoteNumber: await nextQuoteNumber(ctx, now),
      date: now.toISOString().slice(0, 10),
      status: "draft",
      lineItems: args.lineItems,
      discountPercent: totals.discountPercent,
      monthlySubtotal: totals.monthlySubtotal,
      yearlySubtotal: totals.yearlySubtotal,
      monthlyDiscountTotal: totals.monthlyDiscountTotal,
      yearlyDiscountTotal: totals.yearlyDiscountTotal,
      discountApprovalStatus:
        totals.discountPercent <= 0
          ? "not_required"
          : isApprovedByRequester
            ? totals.discountPercent <= 5
              ? "not_required"
              : "approved"
            : "pending",
      discountApprovalLevel: approvalLevel,
      discountRequestedBy:
        totals.discountPercent > 0 && !isApprovedByRequester
          ? user._id
          : undefined,
      discountRequestedAt:
        totals.discountPercent > 0 && !isApprovedByRequester
          ? now.getTime()
          : undefined,
      discountApprovedBy:
        totals.discountPercent > 5 && isApprovedByRequester
          ? user._id
          : undefined,
      discountApprovedAt:
        totals.discountPercent > 5 && isApprovedByRequester
          ? now.getTime()
          : undefined,
      monthlyGrandTotal: totals.monthlyGrandTotal,
      yearlyGrandTotal: totals.yearlyGrandTotal,
      notes: args.notes,
      sourceMonth: args.sourceMonth,
    });
    const quote = await ctx.db.get(quoteId);
    if (quote && quote.discountApprovalStatus === "pending") {
      await notifyDiscountApprovers(ctx, {
        quote,
        company,
        requester: user,
        level: approvalLevel,
        discountPercent: totals.discountPercent,
      });
    }
    return quoteId;
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
    if (args.status !== "draft") {
      assertDiscountCanProceed(quote);
    }
    await ctx.db.patch(args.id, { status: args.status });
  },
});

/** Update a draft quote discount and recompute totals */
export const updateDiscount = mutation({
  args: {
    id: v.id("quotes"),
    discountPercent: v.optional(v.number()),
  },
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
        message: "Only draft quotes can be discounted",
      });
    }

    const totals = calculateQuoteTotals(quote.lineItems, args.discountPercent);
    if (totals.discountPercent > 50) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Discounts above 50% require CEO review outside CRM.",
      });
    }
    const company = await getCompanyOrThrow(ctx, quote.companyId);
    const approvalLevel = discountApprovalLevelForPercent(
      totals.discountPercent,
    );
    const isApprovedByRequester =
      totals.discountPercent <= discountLimitForUser(user);
    const now = Date.now();
    const approvalStatus =
      totals.discountPercent <= 0
        ? "not_required"
        : isApprovedByRequester
          ? totals.discountPercent <= 5
            ? "not_required"
            : "approved"
          : "pending";
    await ctx.db.patch(args.id, {
      discountPercent: totals.discountPercent,
      monthlySubtotal: totals.monthlySubtotal,
      yearlySubtotal: totals.yearlySubtotal,
      monthlyDiscountTotal: totals.monthlyDiscountTotal,
      yearlyDiscountTotal: totals.yearlyDiscountTotal,
      discountApprovalStatus: approvalStatus,
      discountApprovalLevel: approvalLevel,
      discountRequestedBy:
        totals.discountPercent > 0 && approvalStatus === "pending"
          ? user._id
          : undefined,
      discountRequestedAt:
        totals.discountPercent > 0 && approvalStatus === "pending"
          ? now
          : undefined,
      discountApprovedBy:
        totals.discountPercent > 5 && approvalStatus === "approved"
          ? user._id
          : undefined,
      discountApprovedAt:
        totals.discountPercent > 5 && approvalStatus === "approved"
          ? now
          : undefined,
      discountRejectedBy: undefined,
      discountRejectedAt: undefined,
      discountApprovalNote: undefined,
      monthlyGrandTotal: totals.monthlyGrandTotal,
      yearlyGrandTotal: totals.yearlyGrandTotal,
    });
    const updatedQuote = await ctx.db.get(args.id);
    if (updatedQuote && approvalStatus === "pending") {
      await notifyDiscountApprovers(ctx, {
        quote: updatedQuote,
        company,
        requester: user,
        level: approvalLevel,
        discountPercent: totals.discountPercent,
      });
    }
    return {
      discountPercent: totals.discountPercent,
      discountApprovalStatus: approvalStatus,
      discountApprovalLevel: approvalLevel,
    };
  },
});

export const approveDiscount = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    await assertCanManageQuote(ctx, user, quote);
    const discountPercent = quote.discountPercent ?? 0;
    if (quote.discountApprovalStatus !== "pending" || discountPercent <= 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "This quote does not have a pending discount approval.",
      });
    }
    if (discountLimitForUser(user) < discountPercent) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Your role cannot approve this discount percentage.",
      });
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      discountApprovalStatus: "approved",
      discountApprovedBy: user._id,
      discountApprovedAt: now,
      discountRejectedBy: undefined,
      discountRejectedAt: undefined,
      discountApprovalNote: undefined,
    });
    if (quote.discountRequestedBy && quote.discountRequestedBy !== user._id) {
      await ctx.db.insert("notifications", {
        recipientId: quote.discountRequestedBy,
        actorId: user._id,
        type: "quote_discount_approved",
        title: "Quote discount approved",
        body: `${discountPercent}% discount was approved.`,
        entityType: "quote",
        entityId: quote._id,
        href: `/quotes/${quote._id}`,
        createdAt: now,
      });
    }
  },
});

export const rejectDiscount = mutation({
  args: {
    id: v.id("quotes"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    await assertCanManageQuote(ctx, user, quote);
    const discountPercent = quote.discountPercent ?? 0;
    if (quote.discountApprovalStatus !== "pending" || discountPercent <= 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "This quote does not have a pending discount approval.",
      });
    }
    if (discountLimitForUser(user) < discountPercent) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Your role cannot reject this discount percentage.",
      });
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      discountApprovalStatus: "rejected",
      discountRejectedBy: user._id,
      discountRejectedAt: now,
      discountApprovedBy: undefined,
      discountApprovedAt: undefined,
      discountApprovalNote: args.note?.trim() || undefined,
    });
    if (quote.discountRequestedBy && quote.discountRequestedBy !== user._id) {
      await ctx.db.insert("notifications", {
        recipientId: quote.discountRequestedBy,
        actorId: user._id,
        type: "quote_discount_rejected",
        title: "Quote discount rejected",
        body: `${discountPercent}% discount was rejected.`,
        entityType: "quote",
        entityId: quote._id,
        href: `/quotes/${quote._id}`,
        createdAt: now,
      });
    }
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
