import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertCanManageTarget, isCeoOrHob } from "./authorization";

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

async function getVisibleTargets(
  ctx: QueryCtx,
  currentUser: Doc<"users">,
  year: number,
): Promise<Doc<"salesTargets">[]> {
  const yearTargets = (await ctx.db.query("salesTargets").collect()).filter(
    (target) => target.year === year,
  );

  if (isCeoOrHob(currentUser)) {
    return yearTargets;
  }

  if (currentUser.role === "country_gm" && currentUser.countryId) {
    const countryUsers = await ctx.db
      .query("users")
      .withIndex("by_country", (q) => q.eq("countryId", currentUser.countryId!))
      .collect();
    const visibleUserIds = new Set([
      currentUser._id,
      ...countryUsers.map((user) => user._id),
    ]);
    return yearTargets.filter(
      (target) =>
        target.accountManagerId !== undefined &&
        visibleUserIds.has(target.accountManagerId),
    );
  }

  return yearTargets.filter(
    (target) => target.accountManagerId === currentUser._id,
  );
}

export const list = query({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    return await getVisibleTargets(ctx, currentUser, args.year);
  },
});

export const getByYear = query({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    return await getVisibleTargets(ctx, currentUser, args.year);
  },
});

export const upsert = mutation({
  args: {
    accountManagerId: v.id("users"),
    year: v.number(),
    quarter: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
    target: v.number(),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    await assertCanManageTarget(ctx, currentUser, args.accountManagerId);

    // Check if target exists for this AM/year/quarter
    const existing = await ctx.db
      .query("salesTargets")
      .withIndex("by_am_year_quarter", (q) =>
        q
          .eq("accountManagerId", args.accountManagerId)
          .eq("year", args.year)
          .eq("quarter", args.quarter),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { target: args.target });
      return existing._id;
    } else {
      return await ctx.db.insert("salesTargets", {
        accountManagerId: args.accountManagerId,
        year: args.year,
        quarter: args.quarter,
        target: args.target,
      });
    }
  },
});

export const remove = mutation({
  args: { id: v.id("salesTargets") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const target = await ctx.db.get(args.id);
    if (!target) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Target not found",
      });
    }
    await assertCanManageTarget(ctx, currentUser, target.accountManagerId);
    await ctx.db.delete(args.id);
  },
});
