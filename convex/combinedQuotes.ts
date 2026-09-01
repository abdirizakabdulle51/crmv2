import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertCanManageCompany,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";
import {
  addCents,
  calculateTaxedLine,
  fromCents,
  sumMoney,
  toCents,
} from "./money";

type Ctx = QueryCtx | MutationCtx;

const combinedLineItemValidator = v.object({
  sourceCompanyId: v.optional(v.id("companies")),
  sourceCompanyName: v.optional(v.string()),
  source: v.union(
    v.literal("usage"),
    v.literal("latest_accepted_quote"),
    v.literal("manual"),
  ),
  product: v.string(),
  quantity: v.number(),
  unitPrice: v.number(),
  taxRate: v.number(),
  discountPercent: v.number(),
});

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

function quoteNumberForSequence(now: Date, sequence: number) {
  return `CQ-${now.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}

async function nextCombinedQuoteNumber(ctx: MutationCtx, now: Date) {
  const prefix = `CQ-${now.getUTCFullYear()}-`;
  const quotes = await ctx.db.query("combinedQuotes").collect();
  const issuedThisYear = quotes
    .map((quote) => quote.quoteNumber)
    .filter(
      (quoteNumber): quoteNumber is string =>
        typeof quoteNumber === "string" && quoteNumber.startsWith(prefix),
    );
  return quoteNumberForSequence(now, issuedThisYear.length + 1);
}

function lineAmount(line: {
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
}) {
  return calculateTaxedLine(line).total;
}

async function latestAcceptedQuoteTotal(
  ctx: QueryCtx,
  companyId: Id<"companies">,
) {
  const acceptedQuotes = (
    await ctx.db
      .query("quotes")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect()
  )
    .filter((quote) => quote.status === "accepted")
    .sort((a, b) => b.date.localeCompare(a.date));

  return acceptedQuotes[0]?.monthlyGrandTotal ?? 0;
}

export const buildPreview = query({
  args: {
    companyIds: v.array(v.id("companies")),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const uniqueCompanyIds = Array.from(new Set(args.companyIds));
    const lines = [];

    for (const companyId of uniqueCompanyIds) {
      const company = await ctx.db.get(companyId);
      if (!company) {
        continue;
      }
      assertCanManageCompany(user, company);

      const usageEntries = await ctx.db
        .query("consumption")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", companyId).eq("month", args.month),
        )
        .collect();
      const usageMonthlyTotal = sumMoney(
        usageEntries.map((entry) => entry.amount),
      );
      const acceptedQuoteMonthlyTotal =
        usageMonthlyTotal > 0
          ? 0
          : await latestAcceptedQuoteTotal(ctx, companyId);
      const unitPrice =
        usageMonthlyTotal > 0
          ? usageMonthlyTotal
          : fromCents(toCents(acceptedQuoteMonthlyTotal));
      const source =
        usageMonthlyTotal > 0
          ? "usage"
          : unitPrice > 0
            ? "latest_accepted_quote"
            : "manual";

      const quantity = 12;
      const taxRate = 0;
      const discountPercent = 0;

      lines.push({
        sourceCompanyId: company._id,
        sourceCompanyName: company.name,
        source,
        product: `Compute, Network and Storage Services - ${company.name}`,
        quantity,
        unitPrice,
        taxRate,
        discountPercent,
        amount: lineAmount({ quantity, unitPrice, taxRate, discountPercent }),
      });
    }

    return { lines };
  },
});

export const create = mutation({
  args: {
    parentCompanyName: v.string(),
    sourceMonth: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    lineItems: v.array(combinedLineItemValidator),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const parentCompanyName = args.parentCompanyName.trim();

    if (!parentCompanyName) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Parent company name is required",
      });
    }
    if (args.lineItems.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Add at least one quote line",
      });
    }

    for (const line of args.lineItems) {
      if (line.sourceCompanyId) {
        const company = await ctx.db.get(line.sourceCompanyId);
        if (!company) {
          throw new ConvexError({
            code: "NOT_FOUND",
            message: "Selected company not found",
          });
        }
        assertCanManageCompany(user, company);
      }
    }

    const calculations = args.lineItems.map((line) => calculateTaxedLine(line));
    const lineItems = args.lineItems.map((line, index) => ({
      ...line,
      product: line.product.trim(),
      sourceCompanyName: line.sourceCompanyName?.trim(),
      amount: calculations[index].total,
    }));
    const subtotal = fromCents(
      addCents(...calculations.map((line) => toCents(line.subtotal))),
    );
    const taxTotal = fromCents(
      addCents(...calculations.map((line) => toCents(line.tax))),
    );
    const discountTotal = fromCents(
      addCents(...calculations.map((line) => toCents(line.discount))),
    );
    const grandTotal = fromCents(
      addCents(...calculations.map((line) => toCents(line.total))),
    );
    const now = Date.now();
    return await ctx.db.insert("combinedQuotes", {
      parentCompanyName,
      createdBy: user._id,
      quoteNumber: await nextCombinedQuoteNumber(ctx, new Date(now)),
      date: new Date(now).toISOString().slice(0, 10),
      expirationDate: args.expirationDate?.trim() || undefined,
      paymentTerms: args.paymentTerms?.trim() || undefined,
      status: "draft",
      sourceMonth: args.sourceMonth,
      lineItems,
      subtotal,
      taxTotal,
      discountTotal,
      grandTotal,
      notes: args.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getById = query({
  args: { id: v.id("combinedQuotes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Combined quote not found",
      });
    }
    const visibleCompanyIds = new Set(
      (await ctx.db.query("companies").collect())
        .filter((company) => canViewCompany(user, company))
        .map((company) => company._id),
    );
    const canView =
      quote.createdBy === user._id ||
      quote.lineItems.some(
        (line) =>
          !line.sourceCompanyId || visibleCompanyIds.has(line.sourceCompanyId),
      );
    if (!canView) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have access to this combined quote",
      });
    }
    return quote;
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("combinedQuotes"),
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
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Combined quote not found",
      });
    }
    for (const line of quote.lineItems) {
      if (!line.sourceCompanyId) continue;
      const company = await ctx.db.get(line.sourceCompanyId);
      if (company) assertCanManageCompany(user, company);
    }
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("combinedQuotes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Combined quote not found",
      });
    }
    if (quote.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only draft combined quotes can be deleted",
      });
    }
    for (const line of quote.lineItems) {
      if (!line.sourceCompanyId) continue;
      const company = await ctx.db.get(line.sourceCompanyId);
      if (company) assertCanManageCompany(user, company);
    }
    await ctx.db.delete(args.id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const combinedQuotes = await ctx.db.query("combinedQuotes").collect();
    const visibleCompanyIds = new Set(
      (await ctx.db.query("companies").collect())
        .filter((company) => canViewCompany(user, company))
        .map((company) => company._id),
    );

    return combinedQuotes.filter((quote) =>
      quote.lineItems.some(
        (line) =>
          !line.sourceCompanyId || visibleCompanyIds.has(line.sourceCompanyId),
      ),
    );
  },
});
