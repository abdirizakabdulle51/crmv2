import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { assertCanManageCompany, canViewCompany, isCeoOrHob } from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type ExpenseStatus = Doc<"expenseRequests">["status"];
type ExpenseEventType = Doc<"expenseEvents">["type"];

const DEFAULT_CURRENCY = "USD";
const TERMINAL_STATUSES = new Set<ExpenseStatus>([
  "rejected",
  "paid",
  "cancelled",
]);

const DEFAULT_EXPENSE_CATEGORIES = [
  "Travel",
  "Cloud Operations",
  "Customer Visit",
  "Office Supplies",
  "Vendor Payment",
  "Marketing",
  "Other",
];

const expenseStatusValidator = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("paid"),
  v.literal("cancelled"),
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

function normalizeRequiredText(value: string, field: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${field} is required`,
    });
  }
  return trimmed;
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCurrency(value: string | undefined) {
  const normalized = (value ?? DEFAULT_CURRENCY).trim().toUpperCase();
  if (!normalized) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Currency is required",
    });
  }
  return normalized;
}

function assertPositiveAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Expense amount must be positive",
    });
  }
}

async function getCategoryOrThrow(ctx: Ctx, categoryId: Id<"expenseCategories">) {
  const category = await ctx.db.get(categoryId);
  if (!category) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Expense category not found",
    });
  }
  return category;
}

async function assertActiveCategory(
  ctx: Ctx,
  categoryId: Id<"expenseCategories">,
) {
  const category = await getCategoryOrThrow(ctx, categoryId);
  if (!category.isActive) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Expense category is inactive",
    });
  }
  return category;
}

async function getExpenseOrThrow(ctx: Ctx, expenseId: Id<"expenseRequests">) {
  const expense = await ctx.db.get(expenseId);
  if (!expense) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Expense request not found",
    });
  }
  return expense;
}

async function getCompanyCountryId(
  ctx: Ctx,
  user: Doc<"users">,
  companyId: Id<"companies"> | undefined,
) {
  if (!companyId) {
    return undefined;
  }
  const company = await ctx.db.get(companyId);
  if (!company) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
  }
  assertCanManageCompany(user, company);
  return company.countryId;
}

async function normalizeExpenseScope(
  ctx: Ctx,
  user: Doc<"users">,
  args: {
    companyId?: Id<"companies">;
    countryId?: Id<"countries">;
  },
) {
  const companyCountryId = await getCompanyCountryId(ctx, user, args.companyId);
  const countryId = args.countryId ?? companyCountryId ?? user.countryId;

  if (
    companyCountryId !== undefined &&
    args.countryId !== undefined &&
    args.countryId !== companyCountryId
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Expense country must match the linked company",
    });
  }

  if (!isCeoOrHob(user) && user.countryId && countryId !== user.countryId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You can only create expenses in your country",
    });
  }

  return {
    companyId: args.companyId,
    countryId,
  };
}

async function canViewExpense(ctx: Ctx, user: Doc<"users">, expense: Doc<"expenseRequests">) {
  if (isCeoOrHob(user) || expense.requestedBy === user._id) {
    return true;
  }
  if (user.role === "country_gm" && user.countryId) {
    if (expense.status === "draft") {
      return false;
    }
    if (expense.countryId === user.countryId) {
      return true;
    }
    if (expense.companyId) {
      const company = await ctx.db.get(expense.companyId);
      return !!company && canViewCompany(user, company);
    }
  }
  return false;
}

async function assertCanViewExpense(
  ctx: Ctx,
  user: Doc<"users">,
  expense: Doc<"expenseRequests">,
) {
  if (await canViewExpense(ctx, user, expense)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to view this expense",
  });
}

async function canApproveExpense(
  ctx: Ctx,
  user: Doc<"users">,
  expense: Doc<"expenseRequests">,
) {
  if (isCeoOrHob(user)) {
    return true;
  }
  if (user.role === "country_gm" && user.countryId) {
    if (expense.countryId === user.countryId) {
      return true;
    }
    if (expense.companyId) {
      const company = await ctx.db.get(expense.companyId);
      return !!company && company.countryId === user.countryId;
    }
  }
  return false;
}

async function assertCanApproveExpense(
  ctx: Ctx,
  user: Doc<"users">,
  expense: Doc<"expenseRequests">,
) {
  if (await canApproveExpense(ctx, user, expense)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to approve this expense",
  });
}

function assertCanManageCategories(user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can manage expense categories",
  });
}

function assertCanMarkPaid(user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can mark expenses as paid",
  });
}

function assertExpenseStatus(
  expense: Doc<"expenseRequests">,
  expected: ExpenseStatus,
  action: string,
) {
  if (expense.status !== expected) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Only ${expected} expenses can be ${action}`,
    });
  }
}

async function insertExpenseEvent(
  ctx: MutationCtx,
  args: {
    expenseId: Id<"expenseRequests">;
    type: ExpenseEventType;
    message: string;
    actorId: Id<"users">;
    now: number;
  },
) {
  await ctx.db.insert("expenseEvents", {
    expenseId: args.expenseId,
    type: args.type,
    message: args.message,
    actorId: args.actorId,
    createdAt: args.now,
  });
}

export const listExpenseCategories = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (args.includeInactive && !isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can list inactive categories",
      });
    }
    const categories = await ctx.db.query("expenseCategories").collect();
    return categories
      .filter((category) => args.includeInactive || category.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createExpenseCategory = mutation({
  args: {
    name: v.string(),
    code: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    requiresReceipt: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageCategories(user);
    const now = Date.now();
    return await ctx.db.insert("expenseCategories", {
      name: normalizeRequiredText(args.name, "Category name"),
      code: normalizeOptionalText(args.code),
      description: normalizeOptionalText(args.description),
      isActive: args.isActive ?? true,
      requiresReceipt: args.requiresReceipt,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const seedDefaultExpenseCategories = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageCategories(user);
    const now = Date.now();
    let created = 0;
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      const existing = await ctx.db
        .query("expenseCategories")
        .withIndex("by_name", (q) => q.eq("name", name))
        .first();
      if (!existing) {
        await ctx.db.insert("expenseCategories", {
          name,
          isActive: true,
          createdBy: user._id,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
    }
    return { created };
  },
});

export const updateExpenseCategory = mutation({
  args: {
    categoryId: v.id("expenseCategories"),
    name: v.string(),
    code: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    requiresReceipt: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageCategories(user);
    await getCategoryOrThrow(ctx, args.categoryId);
    await ctx.db.patch(args.categoryId, {
      name: normalizeRequiredText(args.name, "Category name"),
      code: normalizeOptionalText(args.code),
      description: normalizeOptionalText(args.description),
      isActive: args.isActive,
      requiresReceipt: args.requiresReceipt,
      updatedAt: Date.now(),
    });
  },
});

export const createExpenseRequest = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    categoryId: v.id("expenseCategories"),
    amount: v.number(),
    currency: v.optional(v.string()),
    expenseDate: v.number(),
    vendor: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    await assertActiveCategory(ctx, args.categoryId);
    assertPositiveAmount(args.amount);
    const scope = await normalizeExpenseScope(ctx, user, args);
    const now = Date.now();
    const expenseId = await ctx.db.insert("expenseRequests", {
      title: normalizeRequiredText(args.title, "Expense title"),
      description: normalizeOptionalText(args.description),
      categoryId: args.categoryId,
      amount: args.amount,
      currency: normalizeCurrency(args.currency),
      expenseDate: args.expenseDate,
      vendor: normalizeOptionalText(args.vendor),
      requestedBy: user._id,
      companyId: scope.companyId,
      countryId: scope.countryId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    await insertExpenseEvent(ctx, {
      expenseId,
      type: "created",
      message: "Expense request created.",
      actorId: user._id,
      now,
    });
    return expenseId;
  },
});

export const updateDraftExpenseRequest = mutation({
  args: {
    expenseId: v.id("expenseRequests"),
    title: v.string(),
    description: v.optional(v.string()),
    categoryId: v.id("expenseCategories"),
    amount: v.number(),
    currency: v.optional(v.string()),
    expenseDate: v.number(),
    vendor: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    assertExpenseStatus(expense, "draft", "updated");
    if (expense.requestedBy !== user._id && !isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the requester can edit a draft expense",
      });
    }
    await assertActiveCategory(ctx, args.categoryId);
    assertPositiveAmount(args.amount);
    const scope = await normalizeExpenseScope(ctx, user, args);
    const now = Date.now();
    await ctx.db.patch(args.expenseId, {
      title: normalizeRequiredText(args.title, "Expense title"),
      description: normalizeOptionalText(args.description),
      categoryId: args.categoryId,
      amount: args.amount,
      currency: normalizeCurrency(args.currency),
      expenseDate: args.expenseDate,
      vendor: normalizeOptionalText(args.vendor),
      companyId: scope.companyId,
      countryId: scope.countryId,
      updatedAt: now,
    });
    await insertExpenseEvent(ctx, {
      expenseId: args.expenseId,
      type: "updated",
      message: "Draft expense request updated.",
      actorId: user._id,
      now,
    });
  },
});

export const submitExpenseRequest = mutation({
  args: { expenseId: v.id("expenseRequests") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    assertExpenseStatus(expense, "draft", "submitted");
    if (expense.requestedBy !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the requester can submit this expense",
      });
    }
    const now = Date.now();
    await ctx.db.patch(args.expenseId, {
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
    });
    await insertExpenseEvent(ctx, {
      expenseId: args.expenseId,
      type: "submitted",
      message: "Expense request submitted for approval.",
      actorId: user._id,
      now,
    });
  },
});

export const approveExpenseRequest = mutation({
  args: {
    expenseId: v.id("expenseRequests"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    assertExpenseStatus(expense, "submitted", "approved");
    await assertCanApproveExpense(ctx, user, expense);
    const now = Date.now();
    const note = normalizeOptionalText(args.note);
    await ctx.db.patch(args.expenseId, {
      status: "approved",
      approvedAt: now,
      approvedBy: user._id,
      updatedAt: now,
    });
    await insertExpenseEvent(ctx, {
      expenseId: args.expenseId,
      type: "approved",
      message: note
        ? `Expense request approved. Note: ${note}`
        : "Expense request approved.",
      actorId: user._id,
      now,
    });
  },
});

export const rejectExpenseRequest = mutation({
  args: {
    expenseId: v.id("expenseRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    assertExpenseStatus(expense, "submitted", "rejected");
    await assertCanApproveExpense(ctx, user, expense);
    const reason = normalizeRequiredText(args.reason, "Rejection reason");
    const now = Date.now();
    await ctx.db.patch(args.expenseId, {
      status: "rejected",
      rejectedAt: now,
      rejectedBy: user._id,
      rejectionReason: reason,
      updatedAt: now,
    });
    await insertExpenseEvent(ctx, {
      expenseId: args.expenseId,
      type: "rejected",
      message: `Expense request rejected. Reason: ${reason}`,
      actorId: user._id,
      now,
    });
  },
});

export const markExpensePaid = mutation({
  args: {
    expenseId: v.id("expenseRequests"),
    paymentMethod: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanMarkPaid(user);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    assertExpenseStatus(expense, "approved", "marked paid");
    const paymentMethod = normalizeOptionalText(args.paymentMethod);
    const paymentReference = normalizeOptionalText(args.paymentReference);
    const now = Date.now();
    await ctx.db.patch(args.expenseId, {
      status: "paid",
      paidAt: now,
      paidBy: user._id,
      paymentMethod,
      paymentReference,
      updatedAt: now,
    });
    const details = [
      paymentMethod ? `Method: ${paymentMethod}` : undefined,
      paymentReference ? `Reference: ${paymentReference}` : undefined,
    ]
      .filter(Boolean)
      .join(". ");
    await insertExpenseEvent(ctx, {
      expenseId: args.expenseId,
      type: "marked_paid",
      message: details
        ? `Expense request marked paid. ${details}.`
        : "Expense request marked paid.",
      actorId: user._id,
      now,
    });
  },
});

export const cancelExpenseRequest = mutation({
  args: {
    expenseId: v.id("expenseRequests"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    if (TERMINAL_STATUSES.has(expense.status)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "This expense request is already closed",
      });
    }
    if (expense.requestedBy !== user._id && !isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the requester, CEO, or Head of Business can cancel this expense",
      });
    }
    const reason = normalizeRequiredText(args.reason, "Cancellation reason");
    const now = Date.now();
    await ctx.db.patch(args.expenseId, {
      status: "cancelled",
      updatedAt: now,
    });
    await insertExpenseEvent(ctx, {
      expenseId: args.expenseId,
      type: "cancelled",
      message: `Expense request cancelled. Reason: ${reason}`,
      actorId: user._id,
      now,
    });
  },
});

export const getExpenseRequest = query({
  args: { expenseId: v.id("expenseRequests") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    await assertCanViewExpense(ctx, user, expense);
    return expense;
  },
});

export const listExpenseRequests = query({
  args: {
    status: v.optional(expenseStatusValidator),
    requestedBy: v.optional(v.id("users")),
    countryId: v.optional(v.id("countries")),
    companyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expenses = await ctx.db.query("expenseRequests").collect();
    const visible: Doc<"expenseRequests">[] = [];
    for (const expense of expenses) {
      if (expense.archivedAt !== undefined) {
        continue;
      }
      if (args.status && expense.status !== args.status) {
        continue;
      }
      if (args.requestedBy && expense.requestedBy !== args.requestedBy) {
        continue;
      }
      if (args.countryId && expense.countryId !== args.countryId) {
        continue;
      }
      if (args.companyId && expense.companyId !== args.companyId) {
        continue;
      }
      if (await canViewExpense(ctx, user, expense)) {
        visible.push(expense);
      }
    }
    return visible.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listExpenseEvents = query({
  args: { expenseId: v.id("expenseRequests") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const expense = await getExpenseOrThrow(ctx, args.expenseId);
    await assertCanViewExpense(ctx, user, expense);
    const events = await ctx.db
      .query("expenseEvents")
      .withIndex("by_expense", (q) => q.eq("expenseId", args.expenseId))
      .collect();
    return events.sort((a, b) => a.createdAt - b.createdAt);
  },
});
