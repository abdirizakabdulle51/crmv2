import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }
    return await ctx.db.query("countries").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    region: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }
    await ctx.db.patch(args.id, { name: args.name, region: args.region });
  },
});

export const remove = mutation({
  args: { id: v.id("countries") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }
    await ctx.db.delete(args.id);
  },
});
