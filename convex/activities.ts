import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import {
  assertCanManageLead,
  assertNotMonitoring,
  isCeoOrHob,
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
  assertNotMonitoring(user);
  return user;
}

async function assertCanRemoveActivity(
  ctx: QueryCtx | MutationCtx,
  currentUser: Doc<"users">,
  activity: Doc<"activities">,
) {
  const lead = await ctx.db.get(activity.leadId);
  if (!lead) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
  }
  await assertCanManageLead(ctx, currentUser, lead);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrThrow(ctx);

    if (isCeoOrHob(currentUser)) {
      return await ctx.db.query("activities").order("desc").take(200);
    } else if (currentUser.role === "country_gm" && currentUser.countryId) {
      // Get users in same country
      const countryUsers = await ctx.db
        .query("users")
        .withIndex("by_country", (q) =>
          q.eq("countryId", currentUser.countryId!),
        )
        .collect();
      const userIds = new Set(countryUsers.map((u) => u._id));
      const allActivities = await ctx.db
        .query("activities")
        .order("desc")
        .take(500);
      return allActivities.filter((a) => userIds.has(a.accountManagerId));
    } else {
      return await ctx.db
        .query("activities")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", currentUser._id),
        )
        .order("desc")
        .take(200);
    }
  },
});

export const listByLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    return await ctx.db
      .query("activities")
      .withIndex("by_lead", (q) => q.eq("leadId", args.leadId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    leadId: v.id("leads"),
    type: v.union(
      v.literal("call"),
      v.literal("meeting"),
      v.literal("proposal_sent"),
      v.literal("email"),
      v.literal("note"),
      v.literal("follow_up"),
    ),
    description: v.optional(v.string()),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);

    // Determine AM: for admin roles, derive from the lead
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);

    const accountManagerId =
      currentUser.role === "account_manager"
        ? currentUser._id
        : lead.accountManagerId;

    if (!accountManagerId) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "Lead must be assigned to an account manager first",
      });
    }

    return await ctx.db.insert("activities", {
      accountManagerId,
      leadId: args.leadId,
      type: args.type,
      description: args.description,
      date: args.date,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("activities") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const activity = await ctx.db.get(args.id);
    if (!activity) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Activity not found",
      });
    }
    await assertCanRemoveActivity(ctx, currentUser, activity);
    await ctx.db.delete(args.id);
  },
});
