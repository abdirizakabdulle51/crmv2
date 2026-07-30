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

export const append = internalMutation({
  args: {
    snapshots: v.array(
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
        snapshotAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    for (const snapshot of args.snapshots) {
      await ctx.db.insert("cloudCapacitySnapshots", snapshot);
      inserted++;
    }
    return inserted;
  },
});

export const historyForRegion = query({
  args: { regionId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    return await ctx.db
      .query("cloudCapacitySnapshots")
      .withIndex("by_region_snapshot_at", (q) =>
        q.eq("regionId", args.regionId),
      )
      .collect();
  },
});
