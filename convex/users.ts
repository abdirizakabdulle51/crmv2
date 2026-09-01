import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import {
  assertNotMonitoring,
  canManageUser,
  isCeoOrHob,
} from "./authorization";

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
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
    if (user !== null) {
      // Update name/email if changed
      if (user.name !== identity.name || user.email !== identity.email) {
        await ctx.db.patch(user._id, {
          name: identity.name,
          email: identity.email,
        });
      }
      return user._id;
    }
    // First user becomes CEO automatically
    const existingUsers = await ctx.db.query("users").take(1);
    const isFirstUser = existingUsers.length === 0;
    return await ctx.db.insert("users", {
      name: identity.name,
      email: identity.email,
      tokenIdentifier: identity.tokenIdentifier,
      role: isFirstUser ? "ceo" : undefined,
    });
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Called getCurrentUser without authentication present",
      });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    return user;
  },
});

export const getById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const getTeamManager = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (
      !currentUser ||
      (currentUser.role !== "ceo" &&
        currentUser.role !== "head_of_business" &&
        currentUser.role !== "country_gm")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to manage team members",
      });
    }

    return currentUser;
  },
});

export const updateOwnName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }

    const name = args.name.trim();
    if (!name) {
      throw new ConvexError({
        code: "INVALID_NAME",
        message: "Full name is required",
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
        message: "User not found",
      });
    }

    await ctx.db.patch(user._id, { name });
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }
    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User profile not found",
      });
    }
    assertNotMonitoring(currentUser);
    const users = await ctx.db.query("users").collect();
    return users.filter((user) => canManageUser(currentUser, user, "view"));
  },
});

export const updateRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(
      v.literal("account_manager"),
      v.literal("country_gm"),
      v.literal("head_of_business"),
      v.literal("ceo"),
      v.literal("monitoring"),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }
    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User profile not found",
      });
    }
    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    if (isCeoOrHob(currentUser)) {
      await ctx.db.patch(args.userId, { role: args.role });
      return;
    }
    if (
      currentUser.role !== "country_gm" ||
      args.userId === currentUser._id ||
      args.role !== "account_manager" ||
      !canManageUser(currentUser, targetUser, "manage")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Country GMs can only keep Account Managers in their own country",
      });
    }
    await ctx.db.patch(args.userId, { role: args.role });
  },
});

export const assignCountry = mutation({
  args: {
    userId: v.id("users"),
    countryId: v.id("countries"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    }
    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!currentUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User profile not found",
      });
    }
    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }
    if (isCeoOrHob(currentUser)) {
      await ctx.db.patch(args.userId, {
        countryId: args.countryId,
        organizationScope: "country",
      });
      return;
    }
    if (
      currentUser.role !== "country_gm" ||
      args.userId === currentUser._id ||
      !currentUser.countryId ||
      args.countryId !== currentUser.countryId ||
      !canManageUser(currentUser, targetUser, "manage")
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Country GMs can only manage Account Managers in their own country",
      });
    }
    await ctx.db.patch(args.userId, {
      countryId: args.countryId,
      organizationScope: "country",
    });
  },
});

export const setOrganizationScope = mutation({
  args: {
    userId: v.id("users"),
    organizationScope: v.union(v.literal("country"), v.literal("global")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!currentUser || !isCeoOrHob(currentUser))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can assign global scope",
      });
    const target = await ctx.db.get(args.userId);
    if (!target)
      throw new ConvexError({ code: "NOT_FOUND", message: "User not found" });
    if (args.organizationScope === "country" && !target.countryId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Assign a country before selecting country scope",
      });
    await ctx.db.patch(args.userId, {
      organizationScope: args.organizationScope,
      ...(args.organizationScope === "global" ? { countryId: undefined } : {}),
    });
  },
});
