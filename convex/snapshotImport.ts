import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring } from "./authorization";

async function assertSnapshotImportAllowed(ctx: MutationCtx) {
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

  assertNotMonitoring(user as Doc<"users">);
}

const row = <T extends ReturnType<typeof v.object>>(doc: T) =>
  v.object({
    oldId: v.string(),
    doc,
  });

const countryRow = row(
  v.object({
    name: v.string(),
    region: v.string(),
  }),
);

const sectorRow = row(
  v.object({
    name: v.string(),
  }),
);

const companyRow = row(
  v.object({
    name: v.string(),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
    contractStatus: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("expired"),
      v.literal("terminated"),
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("current"),
        v.literal("overdue"),
        v.literal("delinquent"),
      ),
    ),
    notes: v.optional(v.string()),
    website: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  }),
);

const leadRow = row(
  v.object({
    title: v.string(),
    companyId: v.id("companies"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    potentialValue: v.number(),
    expectedCloseDate: v.string(),
    nextAction: v.optional(v.string()),
    notes: v.optional(v.string()),
  }),
);

const serviceCatalogRow = row(
  v.object({
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  }),
);

const salesTargetRow = row(
  v.object({
    year: v.number(),
    quarter: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
    target: v.number(),
  }),
);

export const insertCountries = mutation({
  args: { rows: v.array(countryRow) },
  handler: async (ctx, args) => {
    await assertSnapshotImportAllowed(ctx);
    const ids: Record<string, string> = {};
    for (const { oldId, doc } of args.rows) {
      ids[oldId] = await ctx.db.insert("countries", doc);
    }
    return ids;
  },
});

export const insertSectors = mutation({
  args: { rows: v.array(sectorRow) },
  handler: async (ctx, args) => {
    await assertSnapshotImportAllowed(ctx);
    const ids: Record<string, string> = {};
    for (const { oldId, doc } of args.rows) {
      ids[oldId] = await ctx.db.insert("sectors", doc);
    }
    return ids;
  },
});

export const insertCompanies = mutation({
  args: { rows: v.array(companyRow) },
  handler: async (ctx, args) => {
    await assertSnapshotImportAllowed(ctx);
    const ids: Record<string, string> = {};
    for (const { oldId, doc } of args.rows) {
      ids[oldId] = await ctx.db.insert("companies", doc);
    }
    return ids;
  },
});

export const insertLeads = mutation({
  args: { rows: v.array(leadRow) },
  handler: async (ctx, args) => {
    await assertSnapshotImportAllowed(ctx);
    const ids: Record<string, string> = {};
    for (const { oldId, doc } of args.rows) {
      ids[oldId] = await ctx.db.insert("leads", doc);
    }
    return ids;
  },
});

export const insertServiceCatalog = mutation({
  args: { rows: v.array(serviceCatalogRow) },
  handler: async (ctx, args) => {
    await assertSnapshotImportAllowed(ctx);
    const ids: Record<string, string> = {};
    for (const { oldId, doc } of args.rows) {
      ids[oldId] = await ctx.db.insert("serviceCatalog", doc);
    }
    return ids;
  },
});

export const insertSalesTargets = mutation({
  args: { rows: v.array(salesTargetRow) },
  handler: async (ctx, args) => {
    await assertSnapshotImportAllowed(ctx);
    const ids: Record<string, string> = {};
    for (const { oldId, doc } of args.rows) {
      ids[oldId] = await ctx.db.insert("salesTargets", doc);
    }
    return ids;
  },
});
