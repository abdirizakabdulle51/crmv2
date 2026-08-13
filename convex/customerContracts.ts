import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type ContractStatus =
  | "draft"
  | "active"
  | "expired"
  | "terminated"
  | "renewed";
type EventType =
  | "created"
  | "updated"
  | "activated"
  | "terminated"
  | "expired"
  | "renewed";
type ContractInput = {
  companyId: Id<"companies">;
  contractNumber: string;
  title: string;
  status: ContractStatus;
  startDate: number;
  endDate: number;
  signedDate?: number;
  currency: string;
  billingFrequency: "monthly" | "quarterly" | "every_3_months" | "yearly";
  paymentTermDays?: number;
  signedDocumentUrl?: string;
  notes?: string;
};
type LineItemInput = {
  contractId: Id<"customerContracts">;
  catalogItemId?: Id<"serviceCatalog">;
  itemName: string;
  serviceCategory: string;
  description?: string;
  includedQuantity: number;
  unit: string;
  catalogUnitPrice?: number;
  contractUnitPrice: number;
  discountType?: "percentage" | "amount";
  discountValue?: number;
  overageUnitPrice?: number;
  billingUnit: string;
  notes?: string;
};

const contractFieldsValidator = {
  companyId: v.id("companies"),
  contractNumber: v.string(),
  title: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("active"),
    v.literal("expired"),
    v.literal("terminated"),
    v.literal("renewed"),
  ),
  startDate: v.number(),
  endDate: v.number(),
  signedDate: v.optional(v.number()),
  currency: v.string(),
  billingFrequency: v.union(
    v.literal("monthly"),
    v.literal("quarterly"),
    v.literal("every_3_months"),
    v.literal("yearly"),
  ),
  paymentTermDays: v.optional(v.number()),
  signedDocumentUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
};

const lineItemFieldsValidator = {
  contractId: v.id("customerContracts"),
  catalogItemId: v.optional(v.id("serviceCatalog")),
  itemName: v.string(),
  serviceCategory: v.string(),
  description: v.optional(v.string()),
  includedQuantity: v.number(),
  unit: v.string(),
  catalogUnitPrice: v.optional(v.number()),
  contractUnitPrice: v.number(),
  discountType: v.optional(
    v.union(v.literal("percentage"), v.literal("amount")),
  ),
  discountValue: v.optional(v.number()),
  overageUnitPrice: v.optional(v.number()),
  billingUnit: v.string(),
  notes: v.optional(v.string()),
};

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
  assertNotMonitoring(user);
  return user;
}

function assertCanManageContracts(user: Doc<"users">) {
  if (isCeoOrHob(user)) return;
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can manage customer contracts",
  });
}

function requiredText(value: string, fieldName: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} is required`,
    });
  }
  return trimmed;
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function getVisibleCompany(
  ctx: Ctx,
  user: Doc<"users">,
  companyId: Id<"companies">,
) {
  const company = await ctx.db.get(companyId);
  if (!company) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
  }
  if (!canViewCompany(user, company)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You do not have permission to view this company",
    });
  }
  return company;
}

function normalizeFields(args: ContractInput) {
  if (args.endDate < args.startDate) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Contract end date must be after the start date",
    });
  }

  return {
    companyId: args.companyId,
    contractNumber: requiredText(args.contractNumber, "Contract number"),
    title: requiredText(args.title, "Contract title"),
    status: args.status,
    startDate: args.startDate,
    endDate: args.endDate,
    signedDate: args.signedDate,
    currency: requiredText(args.currency, "Currency").toUpperCase(),
    billingFrequency: args.billingFrequency,
    paymentTermDays: args.paymentTermDays,
    signedDocumentUrl: optionalText(args.signedDocumentUrl),
    notes: optionalText(args.notes),
  };
}

function assertNonNegative(value: number | undefined, fieldName: string) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be zero or greater`,
    });
  }
  return value;
}

function normalizeLineItemFields(args: LineItemInput) {
  return {
    contractId: args.contractId,
    catalogItemId: args.catalogItemId,
    itemName: requiredText(args.itemName, "Service name"),
    serviceCategory: requiredText(args.serviceCategory, "Service category"),
    description: optionalText(args.description),
    includedQuantity: assertNonNegative(
      args.includedQuantity,
      "Included quantity",
    )!,
    unit: requiredText(args.unit, "Unit"),
    catalogUnitPrice: assertNonNegative(
      args.catalogUnitPrice,
      "Catalog price",
    ),
    contractUnitPrice: assertNonNegative(
      args.contractUnitPrice,
      "Contract price",
    )!,
    discountType: args.discountType,
    discountValue: assertNonNegative(args.discountValue, "Discount"),
    overageUnitPrice: assertNonNegative(
      args.overageUnitPrice,
      "Overage price",
    ),
    billingUnit: requiredText(args.billingUnit, "Billing unit"),
    notes: optionalText(args.notes),
  };
}

async function insertEvent(
  ctx: MutationCtx,
  contractId: Id<"customerContracts">,
  actorId: Id<"users">,
  type: EventType,
  message: string,
) {
  await ctx.db.insert("customerContractEvents", {
    contractId,
    actorId,
    type,
    message,
    createdAt: Date.now(),
  });
}

function statusEventType(status: ContractStatus): EventType {
  if (status === "active") return "activated";
  if (status === "terminated") return "terminated";
  if (status === "expired") return "expired";
  if (status === "renewed") return "renewed";
  return "updated";
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contracts = await ctx.db.query("customerContracts").collect();
    const visible = [];

    for (const contract of contracts) {
      const company = await ctx.db.get(contract.companyId);
      if (company && canViewCompany(user, company)) {
        visible.push({ ...contract, companyName: company.name });
      }
    }

    return visible.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: { contractId: v.id("customerContracts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    const company = await getVisibleCompany(ctx, user, contract.companyId);
    const events = await ctx.db
      .query("customerContractEvents")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();

    return {
      ...contract,
      companyName: company.name,
      events: events.sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

export const listLineItems = query({
  args: { contractId: v.id("customerContracts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    await getVisibleCompany(ctx, user, contract.companyId);
    const lines = await ctx.db
      .query("customerContractLineItems")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    return lines.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const create = mutation({
  args: contractFieldsValidator,
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    await getVisibleCompany(ctx, user, args.companyId);
    const fields = normalizeFields(args);
    const now = Date.now();
    const contractId = await ctx.db.insert("customerContracts", {
      ...fields,
      activatedAt: fields.status === "active" ? now : undefined,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await insertEvent(
      ctx,
      contractId,
      user._id,
      fields.status === "active" ? "activated" : "created",
      `Customer contract ${fields.contractNumber} created`,
    );
    return contractId;
  },
});

export const update = mutation({
  args: {
    contractId: v.id("customerContracts"),
    ...contractFieldsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const existing = await ctx.db.get(args.contractId);
    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    await getVisibleCompany(ctx, user, args.companyId);
    const fields = normalizeFields(args);
    const activatedAt =
      existing.status !== "active" && fields.status === "active"
        ? Date.now()
        : existing.activatedAt;

    await ctx.db.patch(args.contractId, {
      ...fields,
      activatedAt,
      updatedAt: Date.now(),
    });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      existing.status !== fields.status ? statusEventType(fields.status) : "updated",
      `Customer contract ${fields.contractNumber} updated`,
    );
  },
});

export const createLineItem = mutation({
  args: lineItemFieldsValidator,
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    await getVisibleCompany(ctx, user, contract.companyId);
    const fields = normalizeLineItemFields(args);
    const now = Date.now();
    const lineItemId = await ctx.db.insert("customerContractLineItems", {
      ...fields,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.contractId, { updatedAt: now });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      "updated",
      `Contract service ${fields.itemName} added`,
    );
    return lineItemId;
  },
});

export const updateLineItem = mutation({
  args: {
    lineItemId: v.id("customerContractLineItems"),
    ...lineItemFieldsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const existing = await ctx.db.get(args.lineItemId);
    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contract service line not found",
      });
    }
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    await getVisibleCompany(ctx, user, contract.companyId);
    const fields = normalizeLineItemFields(args);
    const now = Date.now();
    await ctx.db.patch(args.lineItemId, {
      ...fields,
      updatedAt: now,
    });
    await ctx.db.patch(args.contractId, { updatedAt: now });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      "updated",
      `Contract service ${fields.itemName} updated`,
    );
  },
});

export const removeLineItem = mutation({
  args: { lineItemId: v.id("customerContractLineItems") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const existing = await ctx.db.get(args.lineItemId);
    if (!existing) return;
    const contract = await ctx.db.get(existing.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    await getVisibleCompany(ctx, user, contract.companyId);
    await ctx.db.delete(args.lineItemId);
    const now = Date.now();
    await ctx.db.patch(existing.contractId, { updatedAt: now });
    await insertEvent(
      ctx,
      existing.contractId,
      user._id,
      "updated",
      `Contract service ${existing.itemName} removed`,
    );
  },
});
