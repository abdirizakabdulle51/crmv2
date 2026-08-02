import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCompany, isCeoOrHob } from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type TaskStatus = Doc<"tasks">["status"];
type TaskPriority = Doc<"tasks">["priority"];

const statusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("done"),
  v.literal("canceled"),
);

const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("urgent"),
);

async function getCurrentUserOrThrow(ctx: Ctx): Promise<Doc<"users">> {
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

async function getTaskOrThrow(ctx: Ctx, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Task not found" });
  }
  return task;
}

async function getVisibleCompanyIds(ctx: Ctx, user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return new Set(
      (await ctx.db.query("companies").collect()).map((company) => company._id),
    );
  }
  if (user.role === "country_gm" && user.countryId) {
    return new Set(
      (
        await ctx.db
          .query("companies")
          .withIndex("by_country", (q) => q.eq("countryId", user.countryId!))
          .collect()
      ).map((company) => company._id),
    );
  }
  return new Set(
    (
      await ctx.db
        .query("companies")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", user._id),
        )
        .collect()
    ).map((company) => company._id),
  );
}

async function getVisibleUserIds(ctx: Ctx, user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return new Set((await ctx.db.query("users").collect()).map((u) => u._id));
  }
  if (user.role === "country_gm" && user.countryId) {
    return new Set([
      user._id,
      ...(
        await ctx.db
          .query("users")
          .withIndex("by_country", (q) => q.eq("countryId", user.countryId!))
          .collect()
      ).map((u) => u._id),
    ]);
  }
  return new Set([user._id]);
}

async function canViewTask(ctx: Ctx, user: Doc<"users">, task: Doc<"tasks">) {
  if (isCeoOrHob(user)) {
    return true;
  }

  if (user.role === "country_gm" && user.countryId) {
    const visibleUserIds = await getVisibleUserIds(ctx, user);
    if (
      visibleUserIds.has(task.createdBy) ||
      (task.assigneeId && visibleUserIds.has(task.assigneeId))
    ) {
      return true;
    }
    if (task.companyId) {
      const company = await ctx.db.get(task.companyId);
      return !!company && company.countryId === user.countryId;
    }
    return false;
  }

  if (task.createdBy === user._id || task.assigneeId === user._id) {
    return true;
  }
  if (task.companyId) {
    const company = await ctx.db.get(task.companyId);
    return !!company && canViewCompany(user, company);
  }
  return false;
}

async function assertCanViewTask(
  ctx: Ctx,
  user: Doc<"users">,
  task: Doc<"tasks">,
) {
  if (await canViewTask(ctx, user, task)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to manage this task",
  });
}

async function assertCanAssignTaskTo(
  ctx: Ctx,
  actor: Doc<"users">,
  assigneeId: Id<"users"> | undefined,
) {
  if (!assigneeId) {
    return;
  }

  const assignee = await ctx.db.get(assigneeId);
  if (!assignee) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Assignee not found",
    });
  }

  if (isCeoOrHob(actor)) {
    return;
  }
  if (actor.role === "account_manager" && assigneeId === actor._id) {
    return;
  }
  if (
    actor.role === "country_gm" &&
    actor.countryId &&
    (assigneeId === actor._id || assignee.countryId === actor.countryId)
  ) {
    return;
  }

  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to assign this task to that user",
  });
}

async function assertCanLinkCompany(
  ctx: Ctx,
  actor: Doc<"users">,
  companyId: Id<"companies"> | undefined,
) {
  if (!companyId) {
    return;
  }

  const company = await ctx.db.get(companyId);
  if (!company) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
  }
  if (canViewCompany(actor, company)) {
    return;
  }

  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to link this company to a task",
  });
}

async function assertLinkedRecordsAreInScope(
  ctx: Ctx,
  actor: Doc<"users">,
  args: {
    companyId?: Id<"companies">;
    leadId?: Id<"leads">;
    quoteId?: Id<"quotes">;
  },
) {
  let linkedCompanyId = args.companyId;
  await assertCanLinkCompany(ctx, actor, linkedCompanyId);

  if (args.leadId) {
    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanLinkCompany(ctx, actor, lead.companyId);
    if (linkedCompanyId && lead.companyId !== linkedCompanyId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Lead must belong to the linked company",
      });
    }
    linkedCompanyId = lead.companyId;
  }

  if (args.quoteId) {
    const quote = await ctx.db.get(args.quoteId);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    await assertCanLinkCompany(ctx, actor, quote.companyId);
    if (linkedCompanyId && quote.companyId !== linkedCompanyId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Quote must belong to the linked company",
      });
    }
    linkedCompanyId = quote.companyId;
  }

  return linkedCompanyId;
}

function taskMatchesFilters(
  task: Doc<"tasks">,
  filters: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assigneeId?: Id<"users">;
    companyId?: Id<"companies">;
    includeArchived?: boolean;
  },
) {
  if (!filters.includeArchived && task.archivedAt !== undefined) {
    return false;
  }
  if (filters.status && task.status !== filters.status) {
    return false;
  }
  if (filters.priority && task.priority !== filters.priority) {
    return false;
  }
  if (filters.assigneeId && task.assigneeId !== filters.assigneeId) {
    return false;
  }
  if (filters.companyId && task.companyId !== filters.companyId) {
    return false;
  }
  return true;
}

export const list = query({
  args: {
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const tasks = await ctx.db.query("tasks").order("desc").collect();
    const visibleTasks: Doc<"tasks">[] = [];

    for (const task of tasks) {
      if (
        taskMatchesFilters(task, args) &&
        (await canViewTask(ctx, user, task))
      ) {
        visibleTasks.push(task);
      }
    }

    return visibleTasks.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
    leadId: v.optional(v.id("leads")),
    quoteId: v.optional(v.id("quotes")),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Task title is required",
      });
    }
    await assertCanAssignTaskTo(ctx, user, args.assigneeId);
    const companyId = await assertLinkedRecordsAreInScope(ctx, user, args);

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      title,
      description: args.description?.trim() || undefined,
      status: "todo",
      priority: args.priority ?? "medium",
      createdBy: user._id,
      assigneeId: args.assigneeId,
      companyId,
      leadId: args.leadId,
      quoteId: args.quoteId,
      dueDate: args.dueDate,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
    leadId: v.optional(v.id("leads")),
    quoteId: v.optional(v.id("quotes")),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);

    if (args.assigneeId !== undefined) {
      await assertCanAssignTaskTo(ctx, user, args.assigneeId);
    }
    const companyId = await assertLinkedRecordsAreInScope(ctx, user, {
      companyId: args.companyId ?? task.companyId,
      leadId: args.leadId,
      quoteId: args.quoteId,
    });

    const patch: Partial<Doc<"tasks">> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Task title is required",
        });
      }
      patch.title = title;
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }
    if (args.priority !== undefined) {
      patch.priority = args.priority;
    }
    if (args.assigneeId !== undefined) {
      patch.assigneeId = args.assigneeId;
    }
    if (
      args.companyId !== undefined ||
      ((args.leadId !== undefined || args.quoteId !== undefined) &&
        !task.companyId)
    ) {
      patch.companyId = companyId;
    }
    if (args.leadId !== undefined) {
      patch.leadId = args.leadId;
    }
    if (args.quoteId !== undefined) {
      patch.quoteId = args.quoteId;
    }
    if (args.dueDate !== undefined) {
      patch.dueDate = args.dueDate;
    }

    await ctx.db.patch(args.taskId, patch);
  },
});

export const updateStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      status: args.status,
      updatedAt: now,
      completedAt: args.status === "done" ? now : undefined,
    });
  },
});

export const archive = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      archivedAt: now,
      updatedAt: now,
    });
  },
});
