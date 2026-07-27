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

export const list = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db.query("serviceCatalog").collect();
  },
});

export const create = mutation({
  args: {
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    return await ctx.db.insert("serviceCatalog", {
      serviceCategory: args.serviceCategory,
      itemName: args.itemName,
      specs: args.specs,
      billingUnit: args.billingUnit,
      monthlyPrice: args.monthlyPrice,
      yearlyPrice: args.yearlyPrice,
      hourlyPrice: args.hourlyPrice,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("serviceCatalog"),
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("serviceCatalog") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    await ctx.db.delete(args.id);
  },
});

export const bulkCreate = mutation({
  args: {
    items: v.array(
      v.object({
        serviceCategory: v.string(),
        itemName: v.string(),
        specs: v.optional(v.string()),
        billingUnit: v.string(),
        monthlyPrice: v.number(),
        yearlyPrice: v.optional(v.number()),
        hourlyPrice: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    for (const item of args.items) {
      await ctx.db.insert("serviceCatalog", item);
    }
    return { inserted: args.items.length };
  },
});
