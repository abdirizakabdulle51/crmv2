import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring } from "./authorization";

const notificationTypeValidator = v.union(
  v.literal("task_assigned"),
  v.literal("task_report_to"),
  v.literal("task_status_changed"),
  v.literal("task_commented"),
  v.literal("quote_discount_approval_requested"),
  v.literal("quote_discount_approved"),
  v.literal("quote_discount_rejected"),
);

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

export const listMine = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

    return await ctx.db
      .query("notifications")
      .withIndex("by_recipient_created", (q) =>
        q.eq("recipientId", user._id),
      )
      .order("desc")
      .take(limit);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_read", (q) =>
        q.eq("recipientId", user._id).eq("readAt", undefined),
      )
      .collect();

    return notifications.length;
  },
});

export const markRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const notification = await ctx.db.get(args.notificationId);

    if (!notification) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Notification not found",
      });
    }
    if (notification.recipientId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to update this notification",
      });
    }
    if (notification.readAt !== undefined) {
      return;
    }

    await ctx.db.patch(args.notificationId, {
      readAt: Date.now(),
    });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_recipient_read", (q) =>
        q.eq("recipientId", user._id).eq("readAt", undefined),
      )
      .collect();
    const now = Date.now();

    await Promise.all(
      notifications.map((notification) =>
        ctx.db.patch(notification._id, { readAt: now }),
      ),
    );

    return notifications.length;
  },
});

export const createForRecipient = internalMutation({
  args: {
    recipientId: v.id("users"),
    actorId: v.optional(v.id("users")),
    type: notificationTypeValidator,
    title: v.string(),
    body: v.optional(v.string()),
    entityType: v.union(v.literal("task"), v.literal("quote")),
    entityId: v.union(v.id("tasks"), v.id("quotes")),
    href: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      ...args,
      title: args.title.trim(),
      body: args.body?.trim() || undefined,
      createdAt: Date.now(),
    });
  },
});
