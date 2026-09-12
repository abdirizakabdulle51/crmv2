import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertNotMonitoring } from "./authorization";
import { isCeoOrHob } from "./authorization";

async function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx) {
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

export const list = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db.query("countries").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    region: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUserOrThrow(ctx);
    if (!isCeoOrHob(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can create countries",
      });
    }
    return await ctx.db.insert("countries", {
      name: args.name,
      region: args.region,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("countries"),
    name: v.string(),
    region: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUserOrThrow(ctx);
    if (!isCeoOrHob(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can change country regions",
      });
    }
    await ctx.db.patch(args.id, { name: args.name, region: args.region });
  },
});

export const remove = mutation({
  args: { id: v.id("countries") },
  handler: async (ctx, args) => {
    const actor = await getCurrentUserOrThrow(ctx);
    if (!isCeoOrHob(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can remove countries",
      });
    }
    const [employee, department, scopedUser] = await Promise.all([
      ctx.db
        .query("employeeProfiles")
        .withIndex("by_country", (q) => q.eq("countryId", args.id))
        .first(),
      ctx.db
        .query("hrDepartments")
        .withIndex("by_country", (q) => q.eq("countryId", args.id))
        .first(),
      ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("hrCountryId"), args.id))
        .first(),
    ]);
    if (employee || department || scopedUser) {
      throw new ConvexError({
        code: "CONFLICT",
        message:
          "This country is referenced by HR records and cannot be removed",
      });
    }
    await ctx.db.delete(args.id);
  },
});
