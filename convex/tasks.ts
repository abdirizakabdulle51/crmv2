import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCompany, isCeoOrHob } from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type TaskStatus = Doc<"tasks">["status"];
type TaskPriority = Doc<"tasks">["priority"];
type TaskNotificationType = Doc<"notifications">["type"];
const MAX_COMMENT_LENGTH = 2000;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

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

async function getCommentOrThrow(ctx: Ctx, commentId: Id<"taskComments">) {
  const comment = await ctx.db.get(commentId);
  if (!comment) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Task comment not found",
    });
  }
  return comment;
}

async function getAttachmentOrThrow(
  ctx: Ctx,
  attachmentId: Id<"taskAttachments">,
) {
  const attachment = await ctx.db.get(attachmentId);
  if (!attachment) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Task attachment not found",
    });
  }
  return attachment;
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

function isLeadership(user: Doc<"users">) {
  return (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  );
}

function canReportToUser(actor: Doc<"users">, target: Doc<"users">) {
  if (isCeoOrHob(actor)) {
    return true;
  }
  if (actor._id === target._id) {
    return true;
  }
  if (target.role === "ceo" || target.role === "head_of_business") {
    return true;
  }
  if (actor.role === "country_gm" && actor.countryId) {
    return target.countryId === actor.countryId;
  }
  if (actor.role === "account_manager") {
    return (
      target.role === "country_gm" &&
      !!actor.countryId &&
      target.countryId === actor.countryId
    );
  }
  return false;
}

async function canViewTask(ctx: Ctx, user: Doc<"users">, task: Doc<"tasks">) {
  if (isCeoOrHob(user)) {
    return true;
  }

  if (user.role === "country_gm" && user.countryId) {
    const visibleUserIds = await getVisibleUserIds(ctx, user);
    if (
      visibleUserIds.has(task.createdBy) ||
      (task.assigneeId && visibleUserIds.has(task.assigneeId)) ||
      (task.reportToId && visibleUserIds.has(task.reportToId))
    ) {
      return true;
    }
    if (task.companyId) {
      const company = await ctx.db.get(task.companyId);
      return !!company && company.countryId === user.countryId;
    }
    return false;
  }

  if (
    task.createdBy === user._id ||
    task.assigneeId === user._id ||
    task.reportToId === user._id
  ) {
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

function assertCanModerateComment(
  user: Doc<"users">,
  comment: Doc<"taskComments">,
) {
  if (comment.createdBy === user._id || isCeoOrHob(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to modify this comment",
  });
}

function assertCanArchiveAttachment(
  user: Doc<"users">,
  attachment: Doc<"taskAttachments">,
) {
  if (attachment.uploadedBy === user._id || isCeoOrHob(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to archive this attachment",
  });
}

function normalizeCommentBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Comment body is required",
    });
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    });
  }
  return trimmed;
}

function normalizeAttachmentFileName(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Attachment file name is required",
    });
  }
  return trimmed;
}

function assertAllowedAttachment(mimeType: string, size: number) {
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Attachment file type is not allowed",
    });
  }
  if (!Number.isFinite(size) || size < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Attachment file size is invalid",
    });
  }
  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Attachment file size must be 10 MB or less",
    });
  }
}

async function assertCommentBelongsToTask(
  ctx: Ctx,
  taskId: Id<"tasks">,
  commentId: Id<"taskComments"> | undefined,
) {
  if (!commentId) {
    return;
  }

  const comment = await getCommentOrThrow(ctx, commentId);
  if (comment.taskId !== taskId) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Attachment comment must belong to the same task",
    });
  }
  if (comment.archivedAt !== undefined) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Cannot attach files to an archived comment",
    });
  }
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

async function assertCanReportTaskTo(
  ctx: Ctx,
  actor: Doc<"users">,
  reportToId: Id<"users"> | undefined,
) {
  if (!reportToId) {
    return;
  }

  const reportTo = await ctx.db.get(reportToId);
  if (!reportTo) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Report To user not found",
    });
  }

  if (canReportToUser(actor, reportTo)) {
    return;
  }

  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to report this task to that user",
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

function statusLabel(status: TaskStatus) {
  if (status === "todo") return "To Do";
  if (status === "in_progress") return "In Progress";
  if (status === "blocked") return "Blocked";
  if (status === "done") return "Done";
  return "Canceled";
}

async function createTaskNotification(
  ctx: MutationCtx,
  args: {
    recipientId: Id<"users"> | undefined;
    actorId: Id<"users">;
    type: TaskNotificationType;
    title: string;
    body?: string;
    taskId: Id<"tasks">;
  },
) {
  if (!args.recipientId || args.recipientId === args.actorId) {
    return;
  }

  await ctx.db.insert("notifications", {
    recipientId: args.recipientId,
    actorId: args.actorId,
    type: args.type,
    title: args.title,
    body: args.body,
    entityType: "task",
    entityId: args.taskId,
    href: `/tasks/${args.taskId}`,
    createdAt: Date.now(),
  });
}

async function notifyTaskRecipients(
  ctx: MutationCtx,
  args: {
    actorId: Id<"users">;
    taskId: Id<"tasks">;
    recipients: Array<{
      recipientId: Id<"users"> | undefined;
      type: TaskNotificationType;
      title: string;
      body?: string;
    }>;
  },
) {
  const seen = new Set<Id<"users">>();
  for (const recipient of args.recipients) {
    if (!recipient.recipientId || seen.has(recipient.recipientId)) {
      continue;
    }
    seen.add(recipient.recipientId);
    await createTaskNotification(ctx, {
      recipientId: recipient.recipientId,
      actorId: args.actorId,
      type: recipient.type,
      title: recipient.title,
      body: recipient.body,
      taskId: args.taskId,
    });
  }
}

async function countActiveTaskComments(ctx: Ctx, taskId: Id<"tasks">) {
  const comments = await ctx.db
    .query("taskComments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();

  return comments.filter((comment) => comment.archivedAt === undefined).length;
}

async function countActiveTaskAttachments(ctx: Ctx, taskId: Id<"tasks">) {
  const attachments = await ctx.db
    .query("taskAttachments")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();

  return attachments.filter(
    (attachment) => attachment.archivedAt === undefined,
  ).length;
}

async function withTaskActivityCounts(ctx: Ctx, task: Doc<"tasks">) {
  const [commentCount, attachmentCount] = await Promise.all([
    countActiveTaskComments(ctx, task._id),
    countActiveTaskAttachments(ctx, task._id),
  ]);

  return {
    ...task,
    commentCount,
    attachmentCount,
  };
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

    const sortedTasks = visibleTasks.sort((a, b) => b.updatedAt - a.updatedAt);
    return await Promise.all(
      sortedTasks.map((task) => withTaskActivityCounts(ctx, task)),
    );
  },
});

export const get = query({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      return null;
    }
    await assertCanViewTask(ctx, user, task);
    return task;
  },
});

export const listReportToCandidates = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const users = await ctx.db.query("users").collect();

    return users
      .filter((candidate) => canReportToUser(user, candidate))
      .sort((a, b) => {
        const aLeadership = isLeadership(a);
        const bLeadership = isLeadership(b);
        if (aLeadership !== bLeadership) {
          return aLeadership ? -1 : 1;
        }
        return (a.name || a.email || "").localeCompare(b.name || b.email || "");
      });
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    reportToId: v.optional(v.id("users")),
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
    const reportToId = args.reportToId ?? user._id;
    await assertCanReportTaskTo(ctx, user, reportToId);
    const companyId = await assertLinkedRecordsAreInScope(ctx, user, args);

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      title,
      description: args.description?.trim() || undefined,
      status: "todo",
      priority: args.priority ?? "medium",
      createdBy: user._id,
      assigneeId: args.assigneeId,
      reportToId,
      companyId,
      leadId: args.leadId,
      quoteId: args.quoteId,
      dueDate: args.dueDate,
      createdAt: now,
      updatedAt: now,
    });
    await notifyTaskRecipients(ctx, {
      actorId: user._id,
      taskId,
      recipients: [
        {
          recipientId: args.assigneeId,
          type: "task_assigned",
          title: "Task assigned to you",
          body: title,
        },
        {
          recipientId: reportToId,
          type: "task_report_to",
          title: "You were set as Report To",
          body: title,
        },
      ],
    });

    return taskId;
  },
});

export const update = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    reportToId: v.optional(v.id("users")),
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
    if (args.reportToId !== undefined) {
      await assertCanReportTaskTo(ctx, user, args.reportToId);
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
    if (args.reportToId !== undefined) {
      patch.reportToId = args.reportToId;
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

    await notifyTaskRecipients(ctx, {
      actorId: user._id,
      taskId: args.taskId,
      recipients: [
        args.assigneeId !== undefined && args.assigneeId !== task.assigneeId
          ? {
              recipientId: args.assigneeId,
              type: "task_assigned",
              title: "Task assigned to you",
              body: patch.title ?? task.title,
            }
          : {
              recipientId: undefined,
              type: "task_assigned",
              title: "",
            },
        args.reportToId !== undefined && args.reportToId !== task.reportToId
          ? {
              recipientId: args.reportToId,
              type: "task_report_to",
              title: "You were set as Report To",
              body: patch.title ?? task.title,
            }
          : {
              recipientId: undefined,
              type: "task_report_to",
              title: "",
            },
      ],
    });
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

    if (args.status !== task.status) {
      await createTaskNotification(ctx, {
        recipientId: task.assigneeId,
        actorId: user._id,
        type: "task_status_changed",
        title: "Task status changed",
        body: `${task.title}: ${statusLabel(task.status)} -> ${statusLabel(
          args.status,
        )}`,
        taskId: args.taskId,
      });
    }
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

export const listComments = query({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);

    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    return comments
      .filter((comment) => comment.archivedAt === undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const createComment = mutation({
  args: {
    taskId: v.id("tasks"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);

    const commentId = await ctx.db.insert("taskComments", {
      taskId: args.taskId,
      body: normalizeCommentBody(args.body),
      createdBy: user._id,
      createdAt: Date.now(),
    });
    await notifyTaskRecipients(ctx, {
      actorId: user._id,
      taskId: args.taskId,
      recipients: [
        {
          recipientId: task.assigneeId,
          type: "task_commented",
          title: "New comment on task",
          body: task.title,
        },
        {
          recipientId: task.reportToId,
          type: "task_commented",
          title: "New comment on task",
          body: task.title,
        },
      ],
    });

    return commentId;
  },
});

export const updateComment = mutation({
  args: {
    commentId: v.id("taskComments"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const comment = await getCommentOrThrow(ctx, args.commentId);
    const task = await getTaskOrThrow(ctx, comment.taskId);
    await assertCanViewTask(ctx, user, task);
    assertCanModerateComment(user, comment);

    await ctx.db.patch(args.commentId, {
      body: normalizeCommentBody(args.body),
      updatedAt: Date.now(),
    });
  },
});

export const archiveComment = mutation({
  args: {
    commentId: v.id("taskComments"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const comment = await getCommentOrThrow(ctx, args.commentId);
    const task = await getTaskOrThrow(ctx, comment.taskId);
    await assertCanViewTask(ctx, user, task);
    assertCanModerateComment(user, comment);

    await ctx.db.patch(args.commentId, {
      archivedAt: Date.now(),
    });
  },
});

export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveAttachmentMetadata = mutation({
  args: {
    taskId: v.id("tasks"),
    commentId: v.optional(v.id("taskComments")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);
    await assertCommentBelongsToTask(ctx, args.taskId, args.commentId);
    assertAllowedAttachment(args.mimeType, args.size);

    return await ctx.db.insert("taskAttachments", {
      taskId: args.taskId,
      commentId: args.commentId,
      storageId: args.storageId,
      fileName: normalizeAttachmentFileName(args.fileName),
      mimeType: args.mimeType,
      size: args.size,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
    });
  },
});

export const listAttachments = query({
  args: {
    taskId: v.id("tasks"),
    commentId: v.optional(v.id("taskComments")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await assertCanViewTask(ctx, user, task);
    await assertCommentBelongsToTask(ctx, args.taskId, args.commentId);

    const attachments = await ctx.db
      .query("taskAttachments")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    return attachments
      .filter((attachment) => attachment.archivedAt === undefined)
      .filter((attachment) =>
        args.commentId ? attachment.commentId === args.commentId : true,
      )
      .sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

export const getAttachmentDownloadUrl = query({
  args: {
    attachmentId: v.id("taskAttachments"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const attachment = await getAttachmentOrThrow(ctx, args.attachmentId);
    const task = await getTaskOrThrow(ctx, attachment.taskId);
    await assertCanViewTask(ctx, user, task);

    return await ctx.storage.getUrl(attachment.storageId);
  },
});

export const archiveAttachment = mutation({
  args: {
    attachmentId: v.id("taskAttachments"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const attachment = await getAttachmentOrThrow(ctx, args.attachmentId);
    const task = await getTaskOrThrow(ctx, attachment.taskId);
    await assertCanViewTask(ctx, user, task);
    assertCanArchiveAttachment(user, attachment);

    await ctx.db.patch(args.attachmentId, {
      archivedAt: Date.now(),
      archivedBy: user._id,
    });
  },
});
