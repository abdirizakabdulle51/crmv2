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
import {
  calculateInvoiceTotals,
  calculateLineItems,
  multiplyMoney,
  toCents,
  withLineMoneyCents,
} from "./money";
import { usageBelongsToContract } from "./contractPricing";

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
  serviceDiscountPercent: v.optional(v.number()),
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

async function nextOpportunityNumber(ctx: MutationCtx, now: Date) {
  const prefix = `OPP-${now.getUTCFullYear()}-`;
  const opportunities = await ctx.db.query("leads").collect();
  const count = opportunities.filter((lead) =>
    lead.opportunityNumber?.startsWith(prefix),
  ).length;
  return `OPP-${now.getUTCFullYear()}-${String(count + 1).padStart(5, "0")}`;
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

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity not found",
      });
    }
    if (lead.companyId) {
      const company = await getCompanyOrThrow(ctx, lead.companyId);
      if (!canViewCompany(user, company)) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
      }
    }
    return (await ctx.db.query("quotes").collect()).filter(
      (quote) => quote.leadId === args.leadId,
    );
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

    const recordedEntries = await ctx.db
      .query("consumption")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
    const [year, monthNumber] = args.month.split("-").map(Number);
    const monthStart = Date.UTC(year, monthNumber - 1, 1);
    const monthEnd = Date.UTC(year, monthNumber, 1) - 1;
    const contracts = (
      await ctx.db
        .query("customerContracts")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .collect()
    ).filter(
      (contract) =>
        contract.status === "active" &&
        contract.startDate <= monthEnd &&
        contract.endDate >= monthStart,
    );
    const contractCatalogIds = new Map<string, Set<string>>();
    for (const contract of contracts) {
      const lines = await ctx.db
        .query("customerContractLineItems")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect();
      contractCatalogIds.set(
        contract._id,
        new Set(
          lines.flatMap((line) =>
            line.catalogItemId ? [line.catalogItemId] : [],
          ),
        ),
      );
    }
    const entries = recordedEntries.filter(
      (entry) =>
        !contracts.some((contract) =>
          usageBelongsToContract(
            entry,
            contract,
            contractCatalogIds.get(contract._id) ?? new Set(),
          ),
        ),
    );
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

      const [calculatedLine] = calculateLineItems([
        {
          quantity: entry.quantity,
          monthlyUnitPrice: catalogItem.monthlyPrice,
        },
      ]);
      lineItems.push({
        catalogItemId: catalogItem._id,
        itemName: catalogItem.itemName,
        serviceCategory: catalogItem.serviceCategory,
        billingUnit: catalogItem.billingUnit,
        quantity: entry.quantity,
        monthlyUnitPrice: catalogItem.monthlyPrice,
        monthlyTotal: calculatedLine.monthlyTotal,
        yearlyTotal: catalogItem.yearlyPrice
          ? calculateLineItems([
              {
                quantity: entry.quantity,
                monthlyUnitPrice: catalogItem.yearlyPrice,
              },
            ])[0].monthlyTotal
          : calculatedLine.yearlyTotal,
        ...optionalRegionFields(entry),
      });
    }

    const totals = calculateInvoiceTotals(lineItems);
    return {
      lineItems,
      warnings,
      monthlyGrandTotal: totals.monthlyTotal,
      yearlyGrandTotal: totals.yearlyTotal,
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
        const [calculated] = calculateLineItems([
          {
            quantity,
            monthlyUnitPrice: matchedCatalogItem.monthlyPrice,
          },
        ]);
        lineItemPreview = {
          catalogItemId: matchedCatalogItem._id,
          itemName: matchedCatalogItem.itemName,
          serviceCategory: matchedCatalogItem.serviceCategory,
          billingUnit: matchedCatalogItem.billingUnit,
          quantity,
          monthlyUnitPrice: matchedCatalogItem.monthlyPrice,
          monthlyTotal: calculated.monthlyTotal,
          yearlyTotal: matchedCatalogItem.yearlyPrice
            ? multiplyMoney(
                matchedCatalogItem.yearlyPrice,
                quantity,
                "Advisor preview yearly total",
              )
            : calculated.yearlyTotal,
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
    leadId: v.optional(v.id("leads")),
    opportunity: v.optional(
      v.object({
        title: v.string(),
        expectedCloseDate: v.string(),
        contactName: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
        source: v.optional(v.string()),
        nextAction: v.optional(v.string()),
      }),
    ),
    commercialModel: v.optional(
      v.union(v.literal("payg"), v.literal("contracted")),
    ),
    contractTerms: v.optional(
      v.object({
        pricingModel: v.union(
          v.literal("flexible_total_commitment"),
          v.literal("monthly_minimum"),
          v.literal("discounted_usage"),
        ),
        contractValue: v.optional(v.number()),
        monthlyMinimum: v.optional(v.number()),
        groupDiscounts: v.array(
          v.object({ productGroup: v.string(), discountPercent: v.number() }),
        ),
      }),
    ),
    lineItems: v.array(lineItemValidator),
    notes: v.optional(v.string()),
    sourceMonth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await getCompanyOrThrow(ctx, args.companyId);
    assertCanManageCompany(user, company);
    const now = new Date();
    let leadId = args.leadId;
    let createdOpportunity = false;
    if (leadId) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.companyId !== company._id)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Quote opportunity must belong to the selected organization",
        });
      if (lead.stage === "won" || lead.stage === "lost")
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Closed opportunities cannot receive new quotes",
        });
    }
    if (!leadId) {
      createdOpportunity = true;
      leadId = await ctx.db.insert("leads", {
        opportunityNumber: await nextOpportunityNumber(ctx, now),
        title: args.opportunity?.title.trim() || `${company.name} opportunity`,
        companyId: company._id,
        countryId: company.countryId,
        accountManagerId: company.accountManagerId,
        stage: "proposal",
        potentialValue: 0,
        expectedCloseDate:
          args.opportunity?.expectedCloseDate ??
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        contactName: args.opportunity?.contactName,
        contactEmail: args.opportunity?.contactEmail,
        source: args.opportunity?.source,
        nextAction:
          args.opportunity?.nextAction ?? "Review and send opportunity quote",
        createdAt: now.getTime(),
        updatedAt: now.getTime(),
      });
    }
    if (args.commercialModel === "payg" && args.contractTerms)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "PAYG quotes cannot contain contract discounts",
      });
    if (
      args.commercialModel === "contracted" &&
      (!args.contractTerms ||
        (args.contractTerms.pricingModel === "flexible_total_commitment" &&
          (!args.contractTerms.contractValue ||
            args.contractTerms.contractValue <= 0)) ||
        (args.contractTerms.pricingModel === "monthly_minimum" &&
          (!args.contractTerms.monthlyMinimum ||
            args.contractTerms.monthlyMinimum <= 0)))
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Complete the contracted pricing terms before saving",
      });
    if (
      args.commercialModel !== "contracted" &&
      args.lineItems.some((line) => line.serviceDiscountPercent !== undefined)
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "PAYG quotes must use catalogue prices without discounts",
      });
    const groupRules = args.contractTerms?.groupDiscounts ?? [];
    if (
      new Set(groupRules.map((rule) => rule.productGroup)).size !==
      groupRules.length
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Each product group can have only one discount",
      });
    const groupDiscounts = new Map(
      groupRules.map((rule) => {
        if (rule.discountPercent < 0 || rule.discountPercent > 100)
          throw new ConvexError({
            code: "BAD_REQUEST",
            message: "Discounts must be between 0 and 100 percent",
          });
        return [rule.productGroup, rule.discountPercent] as const;
      }),
    );
    const lineItems = await Promise.all(
      args.lineItems.map(async (line, index) => {
        const catalogItem = await ctx.db.get(line.catalogItemId);
        if (!catalogItem) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: `Line item ${index + 1} catalog item not found`,
          });
        }
        const discount =
          line.serviceDiscountPercent ??
          (catalogItem.productGroup
            ? groupDiscounts.get(catalogItem.productGroup)
            : undefined) ??
          0;
        if (discount < 0 || discount > 100)
          throw new ConvexError({
            code: "BAD_REQUEST",
            message: "Discounts must be between 0 and 100 percent",
          });
        const discountedPrice = multiplyMoney(
          catalogItem.monthlyPrice,
          (100 - discount) / 100,
          `Line item ${index + 1} discounted price`,
        );
        const [calculated] = calculateLineItems([
          {
            ...line,
            itemName: catalogItem.itemName,
            serviceCategory: catalogItem.serviceCategory,
            billingUnit: catalogItem.billingUnit,
            monthlyUnitPrice: discountedPrice,
          },
        ]);
        return {
          ...calculated,
          serviceDiscountPercent:
            line.serviceDiscountPercent === undefined ? undefined : discount,
          yearlyTotal: catalogItem.yearlyPrice
            ? multiplyMoney(
                multiplyMoney(
                  catalogItem.yearlyPrice,
                  (100 - discount) / 100,
                  `Line item ${index + 1} discounted yearly price`,
                ),
                line.quantity,
                `Line item ${index + 1} yearly total`,
              )
            : calculated.yearlyTotal,
        };
      }),
    );
    const totals = calculateInvoiceTotals(lineItems);
    if (createdOpportunity) {
      await ctx.db.patch(leadId, {
        potentialValue: totals.monthlyTotal,
        updatedAt: now.getTime(),
      });
    }
    const quoteId = await ctx.db.insert("quotes", {
      companyId: args.companyId,
      leadId,
      commercialModel: args.commercialModel ?? "payg",
      contractTerms: args.contractTerms,
      createdBy: user._id,
      quoteNumber: await nextQuoteNumber(ctx, now),
      date: now.toISOString().slice(0, 10),
      status: "draft",
      lineItems: lineItems.map(withLineMoneyCents),
      monthlyGrandTotal: totals.monthlyTotal,
      yearlyGrandTotal: totals.yearlyTotal,
      monthlyGrandTotalCents: toCents(totals.monthlyTotal),
      yearlyGrandTotalCents: toCents(totals.yearlyTotal),
      notes: args.notes,
      sourceMonth: args.sourceMonth,
    });
    const lead = await ctx.db.get(leadId);
    if (lead) {
      if (lead.stage !== "proposal" && lead.stage !== "negotiation") {
        await ctx.db.patch(leadId, {
          stage: "proposal",
          updatedAt: now.getTime(),
        });
      }
      await ctx.db.insert("activities", {
        accountManagerId: lead.accountManagerId ?? user._id,
        leadId,
        type: "quote_created",
        description: "Opportunity quote created",
        date: now.toISOString(),
        createdAt: now.getTime(),
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
    await ctx.db.patch(args.id, { status: args.status });
    if (quote.leadId) {
      const lead = await ctx.db.get(quote.leadId);
      if (lead) {
        const type =
          args.status === "accepted"
            ? "quote_accepted"
            : args.status === "sent"
              ? "quote_sent"
              : "stage_changed";
        await ctx.db.insert("activities", {
          accountManagerId: lead.accountManagerId ?? user._id,
          leadId: lead._id,
          type,
          description: `Quote ${quote.quoteNumber ?? quote._id} marked ${args.status}`,
          date: new Date().toISOString(),
          createdAt: Date.now(),
        });
        if (args.status === "sent" && lead.stage === "proposal") {
          await ctx.db.patch(lead._id, {
            stage: "negotiation",
            updatedAt: Date.now(),
          });
        }
      }
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
