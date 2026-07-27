import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) {
    throw new ConvexError({ code: "NOT_FOUND", message: "User profile not found" });
  }
  return user;
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

/** List quotes by company */
export const listByCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db
      .query("quotes")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
  },
});

/** List all quotes (role-based) */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role === "ceo" || user.role === "head_of_business") {
      return await ctx.db.query("quotes").collect();
    }
    // AMs and GMs see only their own quotes
    return await ctx.db
      .query("quotes")
      .withIndex("by_created_by", (q) => q.eq("createdBy", user._id))
      .collect();
  },
});

/** Get a single quote by ID */
export const getById = query({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    return quote;
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
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
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
    });
  },
});

/** Update quote status */
export const updateStatus = mutation({
  args: {
    id: v.id("quotes"),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("accepted")),
  },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    await ctx.db.patch(args.id, { status: args.status });
  },
});

/** Delete a quote (draft only) */
export const remove = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.id);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    if (quote.status !== "draft") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Only draft quotes can be deleted" });
    }
    await ctx.db.delete(args.id);
  },
});
