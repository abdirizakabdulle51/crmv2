import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import {
  canManageCloudHealthTargets,
  canViewCloudHealth,
} from "./authorization";

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

function assertCanManageServiceHealthTargets(user: Doc<"users">) {
  if (canManageCloudHealthTargets(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can manage service health targets",
  });
}

const checkTypeValidator = v.union(
  v.literal("http"),
  v.literal("tcp"),
  v.literal("dns"),
);

export const create = mutation({
  args: {
    name: v.string(),
    checkType: checkTypeValidator,
    target: v.string(),
    expectedStatusCode: v.optional(v.number()),
    expectedResponseContains: v.optional(v.string()),
    expectedIp: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageServiceHealthTargets(user);
    const now = Date.now();

    return await ctx.db.insert("serviceHealthTargets", {
      ...args,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setActive = mutation({
  args: {
    targetId: v.id("serviceHealthTargets"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageServiceHealthTargets(user);
    await ctx.db.patch(args.targetId, {
      active: args.active,
      updatedAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);
    const targets = await ctx.db.query("serviceHealthTargets").collect();
    return targets.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listActiveForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("serviceHealthTargets")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});
