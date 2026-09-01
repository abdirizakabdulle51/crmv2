import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";
import { assertSupportedCurrency, roundMoney, sumMoney } from "./money";

type Ctx = QueryCtx | MutationCtx;

async function currentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user)
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  assertNotMonitoring(user);
  return user;
}

export const listByCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    const company = await ctx.db.get(args.companyId);
    if (!company || !canViewCompany(user, company)) return [];
    return await ctx.db
      .query("customerCredits")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
  },
});

export const grant = mutation({
  args: {
    companyId: v.id("companies"),
    amount: v.number(),
    currency: v.optional(v.string()),
    policy: v.union(
      v.literal("first_invoice_only"),
      v.literal("carry_forward"),
    ),
    appliesTo: v.union(
      v.literal("all"),
      v.literal("contract"),
      v.literal("non_contract"),
    ),
    expiresAt: v.optional(v.number()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can grant onboarding credit",
      });
    const company = await ctx.db.get(args.companyId);
    if (!company)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer not found",
      });
    const existing = await ctx.db
      .query("customerCredits")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
    if (
      existing.some(
        (credit) =>
          (credit.status === "available" || credit.status === "reserved") &&
          credit.remainingAmount > 0,
      )
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Customer already has an active onboarding credit",
      });
    }
    const amount = roundMoney(args.amount);
    if (amount <= 0)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Credit amount must be positive",
      });
    const currency = assertSupportedCurrency(args.currency);
    const now = Date.now();
    let category: Doc<"expenseCategories"> | null | undefined = (
      await ctx.db.query("expenseCategories").collect()
    ).find(
      (row) => row.code === "ONBOARDING_CREDIT",
    );
    if (!category) {
      const categoryId = await ctx.db.insert("expenseCategories", {
        name: "Onboarding Credit",
        code: "ONBOARDING_CREDIT",
        description: "Non-cash customer onboarding credits",
        isActive: true,
        requiresReceipt: false,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
      category = await ctx.db.get(categoryId);
    }
    if (!category) {
      throw new ConvexError({
        code: "INTERNAL_ERROR",
        message: "Unable to create onboarding credit expense category",
      });
    }
    const creditId = await ctx.db.insert("customerCredits", {
      companyId: args.companyId,
      originalAmount: amount,
      remainingAmount: amount,
      reservedAmount: 0,
      currency,
      policy: args.policy,
      appliesTo: args.appliesTo,
      status: "available",
      expiresAt: args.expiresAt,
      description: args.description?.trim() || undefined,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    const expenseId = await ctx.db.insert("expenseRequests", {
      title: "Onboarding credit",
      description:
        args.description?.trim() || "Customer onboarding credit granted",
      categoryId: category._id,
      amount,
      currency,
      expenseDate: now,
      vendor: company.name,
      requestedBy: user._id,
      companyId: company._id,
      countryId: company.countryId,
      status: "paid",
      submittedAt: now,
      approvedAt: now,
      approvedBy: user._id,
      paidAt: now,
      paidBy: user._id,
      paymentMethod: "Non-cash onboarding credit",
      paymentReference: `CREDIT-${creditId}`,
      onboardingCreditId: creditId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(creditId, { expenseId });
    await ctx.db.insert("expenseEvents", {
      expenseId,
      type: "created",
      actorId: user._id,
      message: "Non-cash onboarding credit expense recorded automatically.",
      createdAt: now,
    });
    await ctx.db.insert("expenseEvents", {
      expenseId,
      type: "marked_paid",
      actorId: user._id,
      message: "Recorded as a non-cash onboarding credit expense.",
      createdAt: now,
    });
    await ctx.db.insert("customerCreditLedger", {
      creditId,
      companyId: args.companyId,
      type: "granted",
      amount,
      balanceAfter: amount,
      actorId: user._id,
      reason: args.description?.trim() || "Onboarding credit granted",
      createdAt: now,
    });
    return creditId;
  },
});

export const reconciliationReport = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can reconcile credits",
      });
    }
    const credits = await ctx.db.query("customerCredits").collect();
    const records = [];
    for (const credit of credits) {
      const ledger = await ctx.db
        .query("customerCreditLedger")
        .withIndex("by_credit", (q) => q.eq("creditId", credit._id))
        .collect();
      const consumed = sumLedger(ledger, "consumed");
      const restored = sumLedger(ledger, "restored");
      const expired = sumLedger(ledger, "expired");
      const reserved = sumLedger(ledger, "reserved");
      const released = sumLedger(ledger, "released");
      const expectedRemaining = roundMoney(
        credit.originalAmount - consumed - expired + restored,
      );
      const expectedReserved = roundMoney(
        Math.max(0, reserved - released - consumed),
      );
      const issues = [];
      if (expectedRemaining !== credit.remainingAmount) {
        issues.push({
          field: "remainingAmount",
          expected: expectedRemaining,
          actual: credit.remainingAmount,
        });
      }
      if (expectedReserved !== credit.reservedAmount) {
        issues.push({
          field: "reservedAmount",
          expected: expectedReserved,
          actual: credit.reservedAmount,
        });
      }
      if (issues.length) records.push({ creditId: credit._id, issues });
    }
    return { checked: credits.length, corrupted: records.length, records };
  },
});

export const expireCredits = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const credits = await ctx.db.query("customerCredits").collect();
    let expired = 0;
    for (const credit of credits) {
      if (
        credit.expiresAt === undefined ||
        credit.expiresAt >= now ||
        credit.status === "expired" ||
        credit.status === "consumed"
      ) continue;
      const amount = roundMoney(credit.remainingAmount - credit.reservedAmount);
      if (amount <= 0) continue;
      await ctx.db.patch(credit._id, {
        remainingAmount: credit.reservedAmount,
        status: "expired",
        updatedAt: now,
      });
      await ctx.db.insert("customerCreditLedger", {
        creditId: credit._id,
        companyId: credit.companyId,
        type: "expired",
        amount,
        balanceAfter: credit.reservedAmount,
        reason: "Onboarding credit reached its expiry date",
        createdAt: now,
      });
      expired += 1;
    }
    return { expired };
  },
});

function sumLedger(
  ledger: Doc<"customerCreditLedger">[],
  type: Doc<"customerCreditLedger">["type"],
) {
  return sumMoney(
    ledger.filter((entry) => entry.type === type).map((entry) => entry.amount),
  );
}

export async function findApplicableCredit(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  isContract: boolean,
  eligibleAmount: number,
) {
  const now = Date.now();
  const credits = await ctx.db
    .query("customerCredits")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const candidates = credits
    .filter((row) => row.status === "available" || row.status === "reserved")
    .filter((row) => row.expiresAt === undefined || row.expiresAt >= now)
    .filter(
      (row) =>
        row.appliesTo === "all" ||
        row.appliesTo === (isContract ? "contract" : "non_contract"),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const credit of candidates) {
    if (credit.remainingAmount - credit.reservedAmount <= 0) continue;
    if (credit.policy === "first_invoice_only") {
      const ledger = await ctx.db
        .query("customerCreditLedger")
        .withIndex("by_credit", (q) => q.eq("creditId", credit._id))
        .collect();
      const usedAmount = roundMoney(
        sumLedger(ledger, "consumed") +
          sumLedger(ledger, "expired") -
          sumLedger(ledger, "restored"),
      );
      if (credit.reservedAmount > 0 || usedAmount > 0)
        continue;
    }
    const amount = Math.min(
      roundMoney(eligibleAmount),
      roundMoney(credit.remainingAmount - credit.reservedAmount),
    );
    if (amount > 0) return { credit, amount };
  }
  return null;
}

export async function reserveCredit(
  ctx: MutationCtx,
  credit: Doc<"customerCredits">,
  invoiceId: Id<"invoices">,
  amount: number,
  actorId: Id<"users">,
) {
  const reservedAmount = roundMoney(credit.reservedAmount + amount);
  await ctx.db.patch(credit._id, {
    reservedAmount,
    status: "reserved",
    updatedAt: Date.now(),
  });
  await ctx.db.insert("customerCreditLedger", {
    creditId: credit._id,
    companyId: credit.companyId,
    invoiceId,
    type: "reserved",
    amount,
    balanceAfter: roundMoney(credit.remainingAmount - reservedAmount),
    actorId,
    reason: "Reserved for draft invoice",
    createdAt: Date.now(),
  });
}

export async function releaseInvoiceCredit(
  ctx: MutationCtx,
  invoice: Doc<"invoices">,
  actorId: Id<"users">,
) {
  if (!invoice.onboardingCreditId || !invoice.onboardingCreditApplied) return;
  const credit = await ctx.db.get(invoice.onboardingCreditId);
  if (!credit) return;
  const amount = invoice.onboardingCreditApplied;
  const reservedAmount = Math.max(
    0,
    roundMoney(credit.reservedAmount - amount),
  );
  await ctx.db.patch(credit._id, {
    reservedAmount,
    status: credit.remainingAmount > 0 ? "available" : "consumed",
    updatedAt: Date.now(),
  });
  await ctx.db.insert("customerCreditLedger", {
    creditId: credit._id,
    companyId: credit.companyId,
    invoiceId: invoice._id,
    type: "released",
    amount,
    balanceAfter: roundMoney(credit.remainingAmount - reservedAmount),
    actorId,
    reason: "Draft invoice cancelled",
    createdAt: Date.now(),
  });
}

export async function consumeInvoiceCredit(
  ctx: MutationCtx,
  invoice: Doc<"invoices">,
  actorId: Id<"users">,
) {
  if (!invoice.onboardingCreditId || !invoice.onboardingCreditApplied) return;
  const credit = await ctx.db.get(invoice.onboardingCreditId);
  if (!credit)
    throw new ConvexError({
      code: "INVOICE_INTEGRITY_ERROR",
      message: "Reserved onboarding credit no longer exists",
    });
  const amount = invoice.onboardingCreditApplied;
  const expiredAmount =
    credit.policy === "first_invoice_only"
      ? Math.max(0, roundMoney(credit.remainingAmount - amount))
      : 0;
  const reservedAmount = Math.max(
    0,
    roundMoney(credit.reservedAmount - amount),
  );
  let remainingAmount = Math.max(
    0,
    roundMoney(credit.remainingAmount - amount),
  );
  if (credit.policy === "first_invoice_only") remainingAmount = 0;
  await ctx.db.patch(credit._id, {
    remainingAmount,
    reservedAmount,
    status: remainingAmount > reservedAmount ? "available" : "consumed",
    updatedAt: Date.now(),
  });
  await ctx.db.insert("customerCreditLedger", {
    creditId: credit._id,
    companyId: credit.companyId,
    invoiceId: invoice._id,
    type: "consumed",
    amount,
    balanceAfter: remainingAmount,
    actorId,
    reason: "Invoice issued",
    createdAt: Date.now(),
  });
  if (expiredAmount > 0) {
    await ctx.db.insert("customerCreditLedger", {
      creditId: credit._id,
      companyId: credit.companyId,
      invoiceId: invoice._id,
      type: "expired",
      amount: expiredAmount,
      balanceAfter: 0,
      actorId,
      reason: "Unused first-invoice credit expired",
      createdAt: Date.now(),
    });
  }
}

export async function restoreInvoiceCredit(
  ctx: MutationCtx,
  invoice: Doc<"invoices">,
  actorId: Id<"users">,
) {
  if (!invoice.onboardingCreditId || !invoice.onboardingCreditApplied) return;
  const existing = await ctx.db
    .query("customerCreditLedger")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
    .collect();
  if (
    !existing.some((row) => row.type === "consumed") ||
    existing.some((row) => row.type === "restored")
  )
    return;
  const credit = await ctx.db.get(invoice.onboardingCreditId);
  if (!credit) return;
  const consumedForInvoice = sumLedger(existing, "consumed");
  const expiredForInvoice = sumLedger(existing, "expired");
  const restoredAmount = roundMoney(consumedForInvoice + expiredForInvoice);
  const remainingAmount = Math.min(
    credit.originalAmount,
    roundMoney(credit.remainingAmount + restoredAmount),
  );
  const isExpired = credit.expiresAt !== undefined && credit.expiresAt < Date.now();
  await ctx.db.patch(credit._id, {
    remainingAmount,
    status: isExpired ? "expired" : "available",
    updatedAt: Date.now(),
  });
  await ctx.db.insert("customerCreditLedger", {
    creditId: credit._id,
    companyId: credit.companyId,
    invoiceId: invoice._id,
    type: "restored",
    amount: restoredAmount,
    balanceAfter: remainingAmount,
    actorId,
    reason: "Invoice voided",
    createdAt: Date.now(),
  });
}
