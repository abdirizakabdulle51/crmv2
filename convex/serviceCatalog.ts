import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring } from "./authorization";
import { normalizeRate } from "./money";
import { PRODUCT_GROUPS } from "../src/lib/product-groups";

const productGroups = new Set<string>(PRODUCT_GROUPS.map((group) => group.value));

function normalizedProductGroup(value?: string) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!productGroups.has(normalized)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Invalid product group" });
  }
  return normalized;
}

function normalizedPrices(args: {
  monthlyPrice: number;
  yearlyPrice?: number;
  hourlyPrice?: number;
}) {
  return {
    monthlyPrice: normalizeRate(args.monthlyPrice, "Monthly price"),
    ...(args.yearlyPrice === undefined
      ? {}
      : { yearlyPrice: normalizeRate(args.yearlyPrice, "Yearly price") }),
    ...(args.hourlyPrice === undefined
      ? {}
      : { hourlyPrice: normalizeRate(args.hourlyPrice, "Hourly price") }),
  };
}

function inferProductGroup(item: Doc<"serviceCatalog">) {
  const value = `${item.serviceCategory} ${item.itemName}`.toLowerCase();
  const groups: Array<[string, string[]]> = [
    ["compute", ["ecs", "bms", "cce", "ims", "compute", "bare metal", "auto scaling"]],
    ["storage", ["evs", "obs", "sfs", "csbs", "cbh", "backup", "storage", "ssd"]],
    ["network", ["eip", "vpc", "elb", "nat", "vpn", "network", "load balance"]],
    ["databases", ["rds", "dds", "dcs", "database", "mysql", "postgres", "redis"]],
    ["security_compliance", ["waf", "ddos", "security", "firewall"]],
    ["applications", ["application", "app service"]],
  ];
  return groups.find(([, terms]) => terms.some((term) => value.includes(term)))?.[0];
}

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

export const list = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db.query("serviceCatalog").collect();
  },
});

export const classifyLegacyItems = internalMutation({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("serviceCatalog").collect();
    let updated = 0;
    for (const item of items) {
      const productGroup = item.productGroup ?? inferProductGroup(item);
      if (!productGroup) continue;
      const serviceCode = item.serviceCode ?? item.serviceCategory.trim();
      if (!item.productGroup || !item.serviceCode) {
        await ctx.db.patch(item._id, { productGroup, serviceCode });
        updated += 1;
      }
      const contractLines = await ctx.db
        .query("customerContractLineItems")
        .withIndex("by_catalog_item", (q) => q.eq("catalogItemId", item._id))
        .collect();
      for (const line of contractLines) {
        if (line.productGroup && line.serviceCode) continue;
        await ctx.db.patch(line._id, { productGroup, serviceCode });
      }
    }
    return {
      updated,
      unclassified: items.filter((item) => !item.productGroup && !inferProductGroup(item)).length,
    };
  },
});

export const create = mutation({
  args: {
    productGroup: v.optional(v.string()),
    serviceCode: v.optional(v.string()),
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
      productGroup: normalizedProductGroup(args.productGroup),
      serviceCode: args.serviceCode?.trim() || undefined,
      itemName: args.itemName,
      specs: args.specs,
      billingUnit: args.billingUnit,
      ...normalizedPrices(args),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("serviceCatalog"),
    productGroup: v.optional(v.string()),
    serviceCode: v.optional(v.string()),
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
    const { id, monthlyPrice, yearlyPrice, hourlyPrice, ...fields } = args;
    await ctx.db.patch(id, {
      ...fields,
      productGroup: normalizedProductGroup(fields.productGroup),
      monthlyPrice: normalizeRate(monthlyPrice, "Monthly price"),
      yearlyPrice:
        yearlyPrice === undefined
          ? undefined
          : normalizeRate(yearlyPrice, "Yearly price"),
      hourlyPrice:
        hourlyPrice === undefined
          ? undefined
          : normalizeRate(hourlyPrice, "Hourly price"),
    });
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
        productGroup: v.optional(v.string()),
        serviceCode: v.optional(v.string()),
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
      await ctx.db.insert("serviceCatalog", {
        ...item,
        productGroup: normalizedProductGroup(item.productGroup),
        ...normalizedPrices(item),
      });
    }
    return { inserted: args.items.length };
  },
});
