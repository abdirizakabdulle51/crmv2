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
  | "amended"
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
type UsageComparisonRow = {
  lineItemId: Id<"customerContractLineItems">;
  itemName: string;
  serviceCategory: string;
  includedQuantity: number;
  unit: string;
  contractUnitPrice: number;
  overageUnitPrice?: number;
  actualQuantity: number;
  overageQuantity: number;
  baseAmount: number;
  overageAmount: number;
  projectedAmount: number;
  usageAmount: number;
  matchedEntries: number;
};
type AmendmentType =
  | "upgrade"
  | "downgrade"
  | "renewal"
  | "commercial_change"
  | "correction"
  | "other";

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

function assertDraftContract(contract: Doc<"customerContracts">) {
  if (contract.status === "draft") return;
  throw new ConvexError({
    code: "BAD_REQUEST",
    message:
      "Active contracts are locked. Create a contract amendment instead of editing the original contract.",
  });
}

function assertCanActivateContract(contract: Doc<"customerContracts">) {
  if (contract.status === "draft") return;
  throw new ConvexError({
    code: "BAD_REQUEST",
    message: "Only draft contracts can be activated",
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

function optionalFiniteNumber(value: number | undefined, fieldName: string) {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} must be a valid number`,
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

function amendmentTypeLabel(type: AmendmentType) {
  const labels: Record<AmendmentType, string> = {
    upgrade: "Upgrade",
    downgrade: "Downgrade",
    renewal: "Renewal",
    commercial_change: "Commercial change",
    correction: "Correction",
    other: "Other",
  };
  return labels[type];
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function usageMatchesLine(
  usage: Doc<"consumption">,
  line: Doc<"customerContractLineItems">,
) {
  if (line.catalogItemId && usage.catalogItemId === line.catalogItemId) {
    return true;
  }

  const usageKey = normalizeKey(usage.serviceType);
  const itemKey = normalizeKey(line.itemName);
  const categoryKey = normalizeKey(line.serviceCategory);
  return (
    usageKey === itemKey ||
    usageKey.includes(itemKey) ||
    itemKey.includes(usageKey) ||
    (categoryKey.length > 0 && usageKey.includes(categoryKey))
  );
}

function discountAmount(line: Doc<"customerContractLineItems">, gross: number) {
  if (!line.discountType || line.discountValue === undefined) return 0;
  if (line.discountType === "percentage") {
    return Math.min(gross, gross * (line.discountValue / 100));
  }
  return Math.min(gross, line.discountValue);
}

function contractLineBaseAmount(line: Doc<"customerContractLineItems">) {
  const gross = line.includedQuantity * line.contractUnitPrice;
  return Math.max(0, gross - discountAmount(line, gross));
}

function comparisonRow(
  line: Doc<"customerContractLineItems">,
  usageEntries: Doc<"consumption">[],
): UsageComparisonRow {
  const matchedUsage = usageEntries.filter((usage) =>
    usageMatchesLine(usage, line),
  );
  const actualQuantity = matchedUsage.reduce((total, usage) => {
    if (usage.quantity !== undefined) return total + usage.quantity;
    const price = line.catalogUnitPrice ?? line.contractUnitPrice;
    if (price > 0) return total + usage.amount / price;
    return total;
  }, 0);
  const usageAmount = matchedUsage.reduce(
    (total, usage) => total + usage.amount,
    0,
  );
  const overageQuantity = Math.max(0, actualQuantity - line.includedQuantity);
  const baseAmount = contractLineBaseAmount(line);
  const overageAmount =
    overageQuantity * (line.overageUnitPrice ?? line.contractUnitPrice);

  return {
    lineItemId: line._id,
    itemName: line.itemName,
    serviceCategory: line.serviceCategory,
    includedQuantity: line.includedQuantity,
    unit: line.unit,
    contractUnitPrice: line.contractUnitPrice,
    overageUnitPrice: line.overageUnitPrice,
    actualQuantity,
    overageQuantity,
    baseAmount,
    overageAmount,
    projectedAmount: baseAmount + overageAmount,
    usageAmount,
    matchedEntries: matchedUsage.length,
  };
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
    const actorIds = Array.from(
      new Set(events.map((event) => event.actorId).filter(Boolean)),
    ) as Id<"users">[];
    const actors = await Promise.all(
      actorIds.map(async (actorId) => await ctx.db.get(actorId)),
    );
    const actorMap = new Map(
      actors
        .filter((actor): actor is Doc<"users"> => actor !== null)
        .map((actor) => [actor._id, actor]),
    );

    return {
      ...contract,
      companyName: company.name,
      events: events
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((event) => {
          const actor = actorMap.get(event.actorId);
          return {
            ...event,
            actorEmail: actor?.email,
            actorName: actor?.name,
          };
        }),
    };
  },
});

export const getByContractNumber = query({
  args: { contractNumber: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contractNumber = args.contractNumber.trim();
    if (!contractNumber) return null;
    const contract = await ctx.db
      .query("customerContracts")
      .withIndex("by_contract_number", (q) =>
        q.eq("contractNumber", contractNumber),
      )
      .first();
    if (!contract) return null;
    const company = await ctx.db.get(contract.companyId);
    if (!company || !canViewCompany(user, company)) return null;
    return { ...contract, companyName: company.name };
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

export const listAmendments = query({
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
    const amendments = await ctx.db
      .query("customerContractAmendments")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    return amendments.sort((a, b) => b.effectiveDate - a.effectiveDate);
  },
});

export const usageComparison = query({
  args: {
    contractId: v.id("customerContracts"),
    month: v.string(),
  },
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

    const [lines, usageEntries] = await Promise.all([
      ctx.db
        .query("customerContractLineItems")
        .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
        .collect(),
      ctx.db
        .query("consumption")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", contract.companyId).eq("month", args.month),
        )
        .collect(),
    ]);
    const rows = lines
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((line) => comparisonRow(line, usageEntries));

    return {
      month: args.month,
      rows,
      totals: {
        contractMinimum: rows.reduce((total, row) => total + row.baseAmount, 0),
        overage: rows.reduce((total, row) => total + row.overageAmount, 0),
        projected: rows.reduce(
          (total, row) => total + row.projectedAmount,
          0,
        ),
        usageAmount: usageEntries.reduce(
          (total, usage) => total + usage.amount,
          0,
        ),
        matchedEntries: rows.reduce(
          (total, row) => total + row.matchedEntries,
          0,
        ),
        totalUsageEntries: usageEntries.length,
      },
    };
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
    assertDraftContract(existing);
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

export const activate = mutation({
  args: { contractId: v.id("customerContracts") },
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
    assertCanActivateContract(contract);
    await getVisibleCompany(ctx, user, contract.companyId);
    const lineItems = await ctx.db
      .query("customerContractLineItems")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    if (lineItems.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Add at least one contract service before activating",
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.contractId, {
      status: "active",
      activatedAt: now,
      updatedAt: now,
    });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      "activated",
      `Customer contract ${contract.contractNumber} activated and locked`,
    );
  },
});

export const createAmendment = mutation({
  args: {
    contractId: v.id("customerContracts"),
    type: v.union(
      v.literal("upgrade"),
      v.literal("downgrade"),
      v.literal("renewal"),
      v.literal("commercial_change"),
      v.literal("correction"),
      v.literal("other"),
    ),
    effectiveDate: v.number(),
    summary: v.string(),
    monthlyDelta: v.optional(v.number()),
  },
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
    if (contract.status === "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Draft contracts can be edited directly before activation",
      });
    }
    const summary = requiredText(args.summary, "Amendment summary");
    const monthlyDelta = optionalFiniteNumber(args.monthlyDelta, "Monthly delta");
    const existing = await ctx.db
      .query("customerContractAmendments")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    const amendmentNumber = `${contract.contractNumber}-AMD-${`${existing.length + 1}`.padStart(3, "0")}`;
    const now = Date.now();
    const amendmentId = await ctx.db.insert("customerContractAmendments", {
      contractId: args.contractId,
      amendmentNumber,
      type: args.type,
      effectiveDate: args.effectiveDate,
      summary,
      monthlyDelta,
      status: "approved",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.contractId, { updatedAt: now });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      "amended",
      `${amendmentTypeLabel(args.type)} amendment ${amendmentNumber} recorded`,
    );
    return amendmentId;
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
    assertDraftContract(contract);
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
    assertDraftContract(contract);
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
    assertDraftContract(contract);
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
