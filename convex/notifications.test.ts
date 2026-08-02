import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

type Seed = {
  amA: Doc<"users">;
  amB: Doc<"users">;
  taskId: Id<"tasks">;
};

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  return await t.run(async (ctx) => {
    const amAId = await ctx.db.insert("users", {
      name: "AM A",
      tokenIdentifier: "am-a-token",
      role: "account_manager",
    });
    const amBId = await ctx.db.insert("users", {
      name: "AM B",
      tokenIdentifier: "am-b-token",
      role: "account_manager",
    });
    const taskId = await ctx.db.insert("tasks", {
      title: "Review customer rollout",
      status: "todo",
      priority: "medium",
      createdBy: amAId,
      assigneeId: amAId,
      reportToId: amBId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      amA: (await ctx.db.get(amAId))!,
      amB: (await ctx.db.get(amBId))!,
      taskId,
    };
  });
}

async function insertNotification(
  t: ReturnType<typeof convexTest>,
  args: {
    recipientId: Id<"users">;
    actorId?: Id<"users">;
    taskId: Id<"tasks">;
    title: string;
    createdAt: number;
    readAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("notifications", {
      recipientId: args.recipientId,
      actorId: args.actorId,
      type: "task_assigned",
      title: args.title,
      entityType: "task",
      entityId: args.taskId,
      href: `/tasks/${args.taskId}`,
      readAt: args.readAt,
      createdAt: args.createdAt,
    });
  });
}

describe("notifications", () => {
  it("lists only the current user's notifications newest first", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await insertNotification(t, {
      recipientId: s.amA._id,
      actorId: s.amB._id,
      taskId: s.taskId,
      title: "Old notification",
      createdAt: 100,
    });
    await insertNotification(t, {
      recipientId: s.amA._id,
      actorId: s.amB._id,
      taskId: s.taskId,
      title: "New notification",
      createdAt: 200,
    });
    await insertNotification(t, {
      recipientId: s.amB._id,
      actorId: s.amA._id,
      taskId: s.taskId,
      title: "Other user notification",
      createdAt: 300,
    });

    const notifications = await asUser(t, s.amA).query(
      api.notifications.listMine,
      {},
    );

    expect(notifications.map((notification) => notification.title)).toEqual([
      "New notification",
      "Old notification",
    ]);
  });

  it("counts only the current user's unread notifications", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await insertNotification(t, {
      recipientId: s.amA._id,
      taskId: s.taskId,
      title: "Unread",
      createdAt: 100,
    });
    await insertNotification(t, {
      recipientId: s.amA._id,
      taskId: s.taskId,
      title: "Read",
      createdAt: 200,
      readAt: 250,
    });
    await insertNotification(t, {
      recipientId: s.amB._id,
      taskId: s.taskId,
      title: "Other unread",
      createdAt: 300,
    });

    const count = await asUser(t, s.amA).query(
      api.notifications.unreadCount,
      {},
    );

    expect(count).toBe(1);
  });

  it("marks a recipient notification as read", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const notificationId = await insertNotification(t, {
      recipientId: s.amA._id,
      taskId: s.taskId,
      title: "Unread",
      createdAt: 100,
    });

    await asUser(t, s.amA).mutation(api.notifications.markRead, {
      notificationId,
    });

    const notification = await t.run(
      async (ctx) => await ctx.db.get(notificationId),
    );
    expect(notification?.readAt).toEqual(expect.any(Number));
  });

  it("rejects markRead for a non-recipient", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const notificationId = await insertNotification(t, {
      recipientId: s.amA._id,
      taskId: s.taskId,
      title: "Private",
      createdAt: 100,
    });

    await expect(
      asUser(t, s.amB).mutation(api.notifications.markRead, {
        notificationId,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("marks only the current user's unread notifications as read", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const amAUnreadId = await insertNotification(t, {
      recipientId: s.amA._id,
      taskId: s.taskId,
      title: "Unread A",
      createdAt: 100,
    });
    const amAReadId = await insertNotification(t, {
      recipientId: s.amA._id,
      taskId: s.taskId,
      title: "Read A",
      createdAt: 200,
      readAt: 220,
    });
    const amBUnreadId = await insertNotification(t, {
      recipientId: s.amB._id,
      taskId: s.taskId,
      title: "Unread B",
      createdAt: 300,
    });

    const updated = await asUser(t, s.amA).mutation(
      api.notifications.markAllRead,
      {},
    );

    const notifications = await t.run(async (ctx) => ({
      amAUnread: await ctx.db.get(amAUnreadId),
      amARead: await ctx.db.get(amAReadId),
      amBUnread: await ctx.db.get(amBUnreadId),
    }));
    expect(updated).toBe(1);
    expect(notifications.amAUnread?.readAt).toEqual(expect.any(Number));
    expect(notifications.amARead?.readAt).toBe(220);
    expect(notifications.amBUnread?.readAt).toBeUndefined();
  });

  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.notifications.listMine, {})).rejects.toThrow(
      /logged in|UNAUTHENTICATED/i,
    );
    await expect(t.query(api.notifications.unreadCount, {})).rejects.toThrow(
      /logged in|UNAUTHENTICATED/i,
    );
  });
});
