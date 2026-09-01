import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertCanManageUsage, assertNotMonitoring } from "./authorization";
import { multiplyMoney, roundMoney, roundQuantity } from "./money";

async function calculateConsumptionAmount(
  ctx: MutationCtx,
  args: {
    amount?: number;
    quantity?: number;
    catalogItemId?: Doc<"serviceCatalog">["_id"];
    isManualOverride?: boolean;
  },
) {
  if (args.catalogItemId && !args.isManualOverride) {
    if (args.quantity === undefined) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Quantity is required for catalog-priced usage",
      });
    }
    const catalogItem = await ctx.db.get(args.catalogItemId);
    if (!catalogItem) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Service catalog item not found",
      });
    }
    return multiplyMoney(
      catalogItem.monthlyPrice,
      args.quantity,
      "Usage charge",
    );
  }
  if (args.amount === undefined) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Amount is required for manual usage",
    });
  }
  if (args.amount < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Usage amount cannot be negative",
    });
  }
  return roundMoney(args.amount);
}

function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function regionFieldsFromArgs(args: {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return {
    ...(trimOptional(args.regionId)
      ? { regionId: trimOptional(args.regionId) }
      : {}),
    ...(trimOptional(args.regionName)
      ? { regionName: trimOptional(args.regionName) }
      : {}),
    ...(trimOptional(args.dataCenterName)
      ? { dataCenterName: trimOptional(args.dataCenterName) }
      : {}),
  };
}

async function getCurrentUserOrThrow(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
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

/** List all consumption entries (role-based visibility via companies) */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrThrow(ctx);

    // Get visible companies based on role
    let companies: Doc<"companies">[];
    if (currentUser.role === "ceo" || currentUser.role === "head_of_business") {
      companies = await ctx.db.query("companies").collect();
    } else if (currentUser.role === "country_gm" && currentUser.countryId) {
      companies = await ctx.db
        .query("companies")
        .withIndex("by_country", (q) =>
          q.eq("countryId", currentUser.countryId!),
        )
        .collect();
    } else {
      companies = await ctx.db
        .query("companies")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", currentUser._id),
        )
        .collect();
    }

    const companyIds = new Set(companies.map((c) => c._id));

    // Get all consumption — filter by visible companies
    const allConsumption = await ctx.db.query("consumption").collect();
    return allConsumption.filter((c) => companyIds.has(c.companyId));
  },
});

/** List consumption for a specific company */
export const listByCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, currentUser, args.companyId);
    return await ctx.db
      .query("consumption")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
  },
});

/** Create a single consumption entry */
export const create = mutation({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
    usageDate: v.optional(v.string()),
    serviceType: v.string(),
    amount: v.optional(v.number()),
    quantity: v.optional(v.number()),
    catalogItemId: v.optional(v.id("serviceCatalog")),
    isManualOverride: v.optional(v.boolean()),
    regionId: v.optional(v.string()),
    regionName: v.optional(v.string()),
    dataCenterName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, currentUser, args.companyId);
    const amount = await calculateConsumptionAmount(ctx, args);
    return await ctx.db.insert("consumption", {
      companyId: args.companyId,
      month: args.month,
      usageDate: args.usageDate,
      serviceType: args.serviceType,
      amount,
      quantity:
        args.quantity === undefined ? undefined : roundQuantity(args.quantity),
      catalogItemId: args.catalogItemId,
      isManualOverride: args.isManualOverride,
      ...regionFieldsFromArgs(args),
    });
  },
});

/** Bulk create ManageOne-derived usage entries */
export const bulkCreateFromManageOne = mutation({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
    usageDate: v.optional(v.string()),
    rows: v.array(
      v.object({
        serviceType: v.string(),
        catalogItemId: v.id("serviceCatalog"),
        quantity: v.number(),
        regionId: v.optional(v.string()),
        regionName: v.optional(v.string()),
        dataCenterName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, currentUser, args.companyId);

    let inserted = 0;
    for (const row of args.rows) {
      const amount = await calculateConsumptionAmount(ctx, row);
      await ctx.db.insert("consumption", {
        companyId: args.companyId,
        month: args.month,
        usageDate: args.usageDate,
        serviceType: row.serviceType,
        amount,
        quantity: roundQuantity(row.quantity),
        catalogItemId: row.catalogItemId,
        isManualOverride: false,
        ...regionFieldsFromArgs(row),
      });
      inserted++;
    }

    return { inserted };
  },
});

/** Bulk create consumption entries (for CSV import) */
export const bulkCreate = mutation({
  args: {
    entries: v.array(
      v.object({
        companyId: v.id("companies"),
        month: v.string(),
        usageDate: v.optional(v.string()),
        serviceType: v.string(),
        amount: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    if (currentUser.role !== "ceo" && currentUser.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can bulk import",
      });
    }
    for (const entry of args.entries) {
      await ctx.db.insert("consumption", {
        companyId: entry.companyId,
        month: entry.month,
        usageDate: entry.usageDate,
        serviceType: entry.serviceType,
        amount: roundMoney(entry.amount),
        isManualOverride: true,
      });
    }
    return { inserted: args.entries.length };
  },
});

/** Remove a consumption entry */
export const remove = mutation({
  args: { id: v.id("consumption") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const entry = await ctx.db.get(args.id);
    if (!entry) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Usage entry not found",
      });
    }
    await assertCanManageUsage(ctx, currentUser, entry.companyId);
    await ctx.db.delete(args.id);
  },
});

/** Remove multiple consumption entries after checking each entry's company scope */
export const bulkRemove = mutation({
  args: { ids: v.array(v.id("consumption")) },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const uniqueIds = [...new Set(args.ids)];

    if (uniqueIds.length === 0) {
      return { deleted: 0 };
    }

    if (uniqueIds.length > 100) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Delete up to 100 usage entries at a time",
      });
    }

    const entries = [];
    for (const id of uniqueIds) {
      const entry = await ctx.db.get(id);
      if (!entry) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "One or more usage entries were not found",
        });
      }
      await assertCanManageUsage(ctx, currentUser, entry.companyId);
      entries.push(entry);
    }

    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }

    return { deleted: entries.length };
  },
});
