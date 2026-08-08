import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

function canViewCloudHealth(user: Doc<"users">) {
  return (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  );
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

  return user;
}

function assertCanViewCloudHealth(user: Doc<"users">) {
  if (canViewCloudHealth(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only Country GM, Head of Business, or CEO can view Cloud Health",
  });
}

function percentage(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((used / total) * 1000) / 10;
}

const storagePoolValidator = v.object({
  volumeType: v.string(),
  usedGb: v.number(),
  totalGb: v.number(),
  freeGb: v.number(),
  usedRatio: v.number(),
  oversubscriptionTotalGb: v.optional(v.number()),
  oversubscriptionAllocatedGb: v.optional(v.number()),
  oversubscriptionFreeGb: v.optional(v.number()),
  oversubscriptionAllocatedRatio: v.optional(v.number()),
});

export const bulkUpsert = internalMutation({
  args: {
    regions: v.array(
      v.object({
        regionId: v.string(),
        regionName: v.string(),
        cpuUsed: v.number(),
        cpuTotal: v.number(),
        cpuOversubscriptionCapacity: v.optional(v.number()),
        cpuOversubscriptionRatio: v.optional(v.number()),
        memoryUsedGb: v.number(),
        memoryTotalGb: v.number(),
        memoryOversubscriptionCapacityGb: v.optional(v.number()),
        memoryOversubscriptionRatio: v.optional(v.number()),
        storageUsedGb: v.number(),
        storageTotalGb: v.number(),
        storageOversubscriptionCapacityGb: v.optional(v.number()),
        storageOversubscriptionRatio: v.optional(v.number()),
        storagePools: v.optional(v.array(storagePoolValidator)),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let upserted = 0;

    for (const region of args.regions) {
      const existing = await ctx.db
        .query("cloudCapacityRegions")
        .withIndex("by_region_id", (q) => q.eq("regionId", region.regionId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { ...region, lastSyncedAt: now });
      } else {
        await ctx.db.insert("cloudCapacityRegions", {
          ...region,
          lastSyncedAt: now,
        });
      }

      upserted++;
    }

    return upserted;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const regions = await ctx.db.query("cloudCapacityRegions").collect();
    return regions
      .map((region) => ({
        ...region,
        cpuUsedPercent: percentage(region.cpuUsed, region.cpuTotal),
        memoryUsedPercent: percentage(
          region.memoryUsedGb,
          region.memoryTotalGb,
        ),
        storageUsedPercent: percentage(
          region.storageUsedGb,
          region.storageTotalGb,
        ),
        storagePools: region.storagePools?.map((pool) => ({
          ...pool,
          usedPercent: percentage(pool.usedGb, pool.totalGb),
        })),
      }))
      .sort((a, b) => a.regionName.localeCompare(b.regionName));
  },
});
