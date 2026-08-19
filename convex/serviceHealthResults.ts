import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, query } from "./_generated/server";
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

function uptimePercent(results: Doc<"serviceHealthResults">[]) {
  if (results.length === 0) {
    return null;
  }

  const successful = results.filter((result) => result.success).length;
  return Math.round((successful / results.length) * 1000) / 10;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const bulkInsert = internalMutation({
  args: {
    results: v.array(
      v.object({
        targetId: v.id("serviceHealthTargets"),
        success: v.boolean(),
        latencyMs: v.optional(v.number()),
        statusCode: v.optional(v.number()),
        resolvedValue: v.optional(v.string()),
        error: v.optional(v.string()),
        checkedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const result of args.results) {
      await ctx.db.insert("serviceHealthResults", result);
    }
    return args.results.length;
  },
});

export const latestStatusByTarget = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);
    const targets = await ctx.db.query("serviceHealthTargets").collect();
    const since = Date.now() - ONE_DAY_MS;

    const rows = [];
    for (const target of targets) {
      const [latest, recentResults] = await Promise.all([
        ctx.db
          .query("serviceHealthResults")
          .withIndex("by_target_checked_at", (q) =>
            q.eq("targetId", target._id),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("serviceHealthResults")
          .withIndex("by_target_checked_at", (q) =>
            q.eq("targetId", target._id).gte("checkedAt", since),
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
    targetId: v.id("serviceHealthTargets"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);
    const limit = Math.min(args.limit ?? 100, 500);

    const results = await ctx.db
      .query("serviceHealthResults")
      .withIndex("by_target_checked_at", (q) => q.eq("targetId", args.targetId))
      .order("desc")
      .take(limit);

    return results;
  },
});
