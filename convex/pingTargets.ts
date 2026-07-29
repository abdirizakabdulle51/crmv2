import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

function canViewCloudHealth(user: Doc<"users">) {
  return (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  );
}

function canManagePingTargets(user: Doc<"users">) {
  return user.role === "ceo" || user.role === "head_of_business";
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

function assertCanManagePingTargets(user: Doc<"users">) {
  if (canManagePingTargets(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can manage ping targets",
  });
}

export const create = mutation({
  args: {
    name: v.string(),
    ip: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManagePingTargets(user);
    const now = Date.now();

    return await ctx.db.insert("pingTargets", {
      name: args.name,
      ip: args.ip,
      active: true,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setActive = mutation({
  args: {
    targetId: v.id("pingTargets"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManagePingTargets(user);

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

    const targets = await ctx.db.query("pingTargets").collect();
    return targets.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listActiveForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("pingTargets")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});
