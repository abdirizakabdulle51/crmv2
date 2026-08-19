import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth } from "./authorization";

const DEFAULT_CAPACITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DRY_RUN_PAGE_SIZE = 1_000;

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
    message:
      "Only Monitoring, Country GM, Head of Business, or CEO can view Cloud Health",
  });
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

const ecsFlavorAvailabilityValidator = v.object({
  name: v.string(),
  vcpus: v.number(),
  ramGb: v.number(),
  cpuVendor: v.optional(v.string()),
  available: v.boolean(),
  matchedName: v.optional(v.string()),
  availabilityZones: v.optional(v.array(v.string())),
  estimatedFitCount: v.optional(v.number()),
  status: v.optional(
    v.union(
      v.literal("available"),
      v.literal("low_capacity"),
      v.literal("not_offered"),
    ),
  ),
});

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
        storagePools: v.optional(v.array(storagePoolValidator)),
        ecsFlavorAvailabilityStatus: v.optional(
          v.union(v.literal("verified"), v.literal("unavailable")),
        ),
        ecsFlavorAvailabilityMessage: v.optional(v.string()),
        ecsFlavorAvailability: v.optional(
          v.array(ecsFlavorAvailabilityValidator),
        ),
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
  args: { regionId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);
    const limit = Math.min(args.limit ?? 5_000, 10_000);

    const snapshots = await ctx.db
      .query("cloudCapacitySnapshots")
      .withIndex("by_region_snapshot_at", (q) =>
        q.eq("regionId", args.regionId),
      )
      .order("desc")
      .take(limit);

    return snapshots.sort((a, b) => a.snapshotAt - b.snapshotAt);
  },
});

export const dryRunOldCapacitySnapshotsPage = internalQuery({
  args: {
    olderThanMs: v.optional(v.number()),
    nowMs: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const olderThanMs = args.olderThanMs ?? DEFAULT_CAPACITY_RETENTION_MS;
    const nowMs = args.nowMs ?? Date.now();
    const cutoff = nowMs - olderThanMs;
    const requestedItems = args.paginationOpts.numItems;
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(requestedItems, MAX_DRY_RUN_PAGE_SIZE),
    };
    const page = await ctx.db
      .query("cloudCapacitySnapshots")
      .paginate(paginationOpts);
    const matchingSnapshots = page.page.filter(
      (snapshot) => snapshot.snapshotAt < cutoff,
    );
    const snapshotAts = matchingSnapshots.map((snapshot) => snapshot.snapshotAt);

    return {
      dryRun: true,
      table: "cloudCapacitySnapshots",
      action: "count_only",
      olderThanMs,
      cutoff,
      scannedPageCount: page.page.length,
      matchingPageCount: matchingSnapshots.length,
      requestedPageSize: requestedItems,
      effectivePageSize: paginationOpts.numItems,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      oldestSnapshotAt: snapshotAts.length > 0 ? Math.min(...snapshotAts) : null,
      newestSnapshotAt: snapshotAts.length > 0 ? Math.max(...snapshotAts) : null,
    };
  },
});
