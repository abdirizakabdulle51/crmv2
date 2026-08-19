import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth } from "./authorization";

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

function uptimePercent(results: Doc<"pingResults">[]) {
  if (results.length === 0) {
    return null;
  }
  const successful = results.filter((result) => result.success).length;
  return Math.round((successful / results.length) * 1000) / 10;
}

const MAX_RECENT_HISTORY_SAMPLES_PER_TARGET = 2_000;

export const bulkUpsert = internalMutation({
  args: {
    results: v.array(
      v.object({
        targetId: v.id("pingTargets"),
        success: v.boolean(),
        latencyMs: v.optional(v.number()),
        error: v.optional(v.string()),
        checkedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;

    for (const result of args.results) {
      await ctx.db.insert("pingResults", result);
      inserted++;
    }

    return inserted;
  },
});

export const latestStatusByTarget = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const targets = await ctx.db.query("pingTargets").collect();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    if (targets.length === 0) {
      return [];
    }

    const rows = [];
    for (const target of targets) {
      const [latest, recentResults] = await Promise.all([
        ctx.db
          .query("pingResults")
          .withIndex("by_target_checked_at", (q) =>
            q.eq("targetId", target._id),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("pingResults")
          .withIndex("by_target_checked_at", (q) =>
            q.eq("targetId", target._id).gte("checkedAt", dayAgo),
          )
          .collect(),
      ]);

      rows.push({
        target,
        latest,
        uptime24hPercent: uptimePercent(recentResults),
        samples24h: recentResults.length,
      });
    }

    return rows.sort((a, b) => a.target.name.localeCompare(b.target.name));
  },
});

export const recentHistory = query({
  args: {
    targetId: v.id("pingTargets"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const limit = Math.min(args.limit ?? 100, 500);
    const results = await ctx.db
      .query("pingResults")
      .withIndex("by_target_checked_at", (q) => q.eq("targetId", args.targetId))
      .order("desc")
      .take(limit);

    return results;
  },
});

export const recentHistoryForActiveTargets = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const limit = Math.min(args.limit ?? 100, 500);
    const samplesPerTarget = Math.min(
      Math.max(limit * 4, limit),
      MAX_RECENT_HISTORY_SAMPLES_PER_TARGET,
    );
    const targets = await ctx.db
      .query("pingTargets")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const activeTargets = targets.sort((a, b) => a.name.localeCompare(b.name));
    if (activeTargets.length === 0) {
      return {
        targets: [],
        buckets: [],
      };
    }

    const results = (
      await Promise.all(
        activeTargets.map((target) =>
          ctx.db
            .query("pingResults")
            .withIndex("by_target_checked_at", (q) =>
              q.eq("targetId", target._id),
            )
            .order("desc")
            .take(samplesPerTarget),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.checkedAt - a.checkedAt);

    const buckets = new Map<
      number,
      {
        checkedAt: number;
        values: Map<string, { latencyMs: number | null; checkedAt: number }>;
      }
    >();

    for (const result of results) {
      const bucketTime = Math.round(result.checkedAt / 60_000) * 60_000;
      const bucket = buckets.get(bucketTime) ?? {
        checkedAt: bucketTime,
        values: new Map(),
      };
      const targetKey = result.targetId;
      const existing = bucket.values.get(targetKey);

      if (!existing || result.checkedAt > existing.checkedAt) {
        bucket.values.set(targetKey, {
          latencyMs: result.success ? (result.latencyMs ?? null) : null,
          checkedAt: result.checkedAt,
        });
      }

      buckets.set(bucketTime, bucket);
    }

    const recentBuckets = [...buckets.values()]
      .sort((a, b) => b.checkedAt - a.checkedAt)
      .slice(0, limit)
      .sort((a, b) => a.checkedAt - b.checkedAt);

    return {
      targets: activeTargets.map((target) => ({
        _id: target._id,
        name: target.name,
        ip: target.ip,
      })),
      buckets: recentBuckets.map((bucket) => {
        const row: Record<string, number | string | null> = {
          checkedAt: bucket.checkedAt,
        };

        for (const target of activeTargets) {
          row[target._id] = bucket.values.get(target._id)?.latencyMs ?? null;
        }

        return row;
      }),
    };
  },
});

export const historyForActiveTargetsInRange = query({
  args: {
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const targets = await ctx.db
      .query("pingTargets")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const activeTargets = targets.sort((a, b) => a.name.localeCompare(b.name));
    const rangeMs = Math.max(0, args.to - args.from);
    const bucketSizeMs =
      rangeMs <= 24 * 60 * 60 * 1000 ? 60 * 1000 : 60 * 60 * 1000;

    if (activeTargets.length === 0) {
      return {
        bucketSizeMs,
        targets: [],
        buckets: [],
      };
    }

    const activeTargetIds = new Set(activeTargets.map((target) => target._id));
    const results = (
      await ctx.db
        .query("pingResults")
        .withIndex("by_checked_at", (q) =>
          q.gte("checkedAt", args.from).lte("checkedAt", args.to),
        )
        .collect()
    )
      .filter((result) => activeTargetIds.has(result.targetId))
      .sort((a, b) => b.checkedAt - a.checkedAt);

    const buckets = new Map<
      number,
      {
        checkedAt: number;
        values: Map<string, { latencyMs: number | null; checkedAt: number }>;
      }
    >();

    for (const result of results) {
      const bucketTime =
        Math.floor(result.checkedAt / bucketSizeMs) * bucketSizeMs;
      const bucket = buckets.get(bucketTime) ?? {
        checkedAt: bucketTime,
        values: new Map(),
      };
      const targetKey = result.targetId;
      const existing = bucket.values.get(targetKey);

      if (!existing || result.checkedAt > existing.checkedAt) {
        bucket.values.set(targetKey, {
          latencyMs: result.success ? (result.latencyMs ?? null) : null,
          checkedAt: result.checkedAt,
        });
      }

      buckets.set(bucketTime, bucket);
    }

    const sortedBuckets = [...buckets.values()].sort(
      (a, b) => a.checkedAt - b.checkedAt,
    );

    return {
      bucketSizeMs,
      targets: activeTargets.map((target) => ({
        _id: target._id,
        name: target.name,
        ip: target.ip,
      })),
      buckets: sortedBuckets.map((bucket) => {
        const row: Record<string, number | string | null> = {
          checkedAt: bucket.checkedAt,
        };

        for (const target of activeTargets) {
          row[target._id] = bucket.values.get(target._id)?.latencyMs ?? null;
        }

        return row;
      }),
    };
  },
});
