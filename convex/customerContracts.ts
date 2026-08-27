import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";
import {
  assertSupportedCurrency,
  calculateContractCharges,
  calculateMonthProration,
  sumMoney,
} from "./money";
import { contractDiscount, contractOveragePrice } from "./contractPricing";

type Ctx = QueryCtx | MutationCtx;
type ContractStatus = "draft" | "active" | "expired" | "terminated" | "renewed";
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
  billingFrequency:
    | "monthly"
    | "quarterly"
    | "every_3_months"
    | "semiannual"
    | "yearly";
  billingTiming?: "prepaid" | "postpaid";
  pricingBasis?: "service_lines" | "total_contract";
  contractValue?: number;
  defaultDiscountType?: "percentage" | "amount";
  defaultDiscountValue?: number;
  overagePricingPolicy?: "current_catalog" | "frozen_catalog" | "custom";
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_SIGNED_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_SIGNED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

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
    v.literal("semiannual"),
    v.literal("yearly"),
  ),
  billingTiming: v.optional(
    v.union(v.literal("prepaid"), v.literal("postpaid")),
  ),
  pricingBasis: v.optional(
    v.union(v.literal("service_lines"), v.literal("total_contract")),
  ),
  contractValue: v.optional(v.number()),
  defaultDiscountType: v.optional(
    v.union(v.literal("percentage"), v.literal("amount")),
  ),
  defaultDiscountValue: v.optional(v.number()),
  overagePricingPolicy: v.optional(
    v.union(
      v.literal("current_catalog"),
      v.literal("frozen_catalog"),
      v.literal("custom"),
    ),
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

function cleanFileName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "signed-contract";
  return trimmed.replace(/[^\w.\- ()]/g, "_").slice(0, 180);
}

function assertAllowedSignedDocument(mimeType: string, size: number) {
  if (!ALLOWED_SIGNED_DOCUMENT_MIME_TYPES.has(mimeType)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Signed document must be a PDF, JPG, or PNG file",
    });
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Signed document file size is invalid",
    });
  }
  if (size > MAX_SIGNED_DOCUMENT_SIZE_BYTES) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Signed document must be 20 MB or less",
    });
  }
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
  const contractValue = assertNonNegative(args.contractValue, "Contract value");
  if (args.pricingBasis === "total_contract" && !contractValue) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "A positive contract value is required for total-value contracts",
    });
  }
  const defaultDiscountValue = assertNonNegative(
    args.defaultDiscountValue,
    "Default discount",
  );
  if (
    args.defaultDiscountType === "percentage" &&
    defaultDiscountValue !== undefined &&
    defaultDiscountValue > 100
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Default percentage discount must be between 0 and 100",
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
    currency: assertSupportedCurrency(
      requiredText(args.currency, "Currency").toUpperCase(),
    ),
    billingFrequency: args.billingFrequency,
    billingTiming: args.billingTiming ?? "postpaid",
    pricingBasis: args.pricingBasis ?? "service_lines",
    contractValue,
    defaultDiscountType: args.defaultDiscountType,
    defaultDiscountValue,
    overagePricingPolicy: args.overagePricingPolicy ?? "current_catalog",
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
  if (
    args.discountType === "percentage" &&
    args.discountValue !== undefined &&
    args.discountValue > 100
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Percentage discount must be between 0 and 100",
    });
  }
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
    catalogUnitPrice: assertNonNegative(args.catalogUnitPrice, "Catalog price"),
    contractUnitPrice: assertNonNegative(
      args.contractUnitPrice,
      "Contract price",
    )!,
    discountType: args.discountType,
    discountValue: assertNonNegative(args.discountValue, "Discount"),
    overageUnitPrice: assertNonNegative(args.overageUnitPrice, "Overage price"),
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

async function assertNoOverlappingActiveContract(
  ctx: MutationCtx,
  contract: Pick<
    Doc<"customerContracts">,
    "companyId" | "startDate" | "endDate"
  >,
  excludeId?: Id<"customerContracts">,
) {
  const contracts = await ctx.db
    .query("customerContracts")
    .withIndex("by_company", (q) => q.eq("companyId", contract.companyId))
    .collect();
  const overlap = contracts.find(
    (candidate) =>
      candidate._id !== excludeId &&
      candidate.status === "active" &&
      candidate.startDate <= contract.endDate &&
      candidate.endDate >= contract.startDate,
  );
  if (overlap) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Customer already has overlapping active contract ${overlap.contractNumber}`,
    });
  }
}

function assertContractValueMatchesServices(
  contract: Doc<"customerContracts">,
  lines: Doc<"customerContractLineItems">[],
) {
  if (contract.pricingBasis !== "total_contract" || !contract.contractValue) {
    return;
  }
  const sorted = [...lines].sort((a, b) => a.createdAt - b.createdAt);
  const start = new Date(contract.startDate);
  const end = new Date(contract.endDate);
  const months: string[] = [];
  for (
    let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    cursor <= Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
    cursor = new Date(cursor).setUTCMonth(new Date(cursor).getUTCMonth() + 1)
  ) {
    months.push(new Date(cursor).toISOString().slice(0, 7));
  }
  const serviceValue = sumMoney(
    months.flatMap((month) => {
      const fraction = calculateMonthProration({
        startDate: contract.startDate,
        endDate: contract.endDate,
        month,
      }).fraction;
      return sorted.map((line, index) => {
        const discount = contractDiscount(contract, line, index, sorted);
        return calculateContractCharges({
          includedQuantity: line.includedQuantity,
          contractUnitPrice: line.contractUnitPrice,
          discountType: discount.type,
          discountValue: discount.value,
          actualQuantity: 0,
          monthFraction: fraction,
        }).total;
      });
    }),
  );
  if (Math.abs(serviceValue - contract.contractValue) > 0.01) {
    throw new ConvexError({
      code: "CONTRACT_VALUE_MISMATCH",
      message: `Service pricing after discounts totals $${serviceValue.toFixed(2)}, but contract value is $${contract.contractValue.toFixed(2)}. Adjust service prices or discounts before activation.`,
    });
  }
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

function usageMatchesLine(
  usage: Doc<"consumption">,
  line: Doc<"customerContractLineItems">,
) {
  return Boolean(
    line.catalogItemId && usage.catalogItemId === line.catalogItemId,
  );
}

async function assertUniqueContractNumber(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  contractNumber: string,
  excludeId?: Id<"customerContracts">,
) {
  const contracts = await ctx.db
    .query("customerContracts")
    .withIndex("by_contract_number", (q) => q.eq("contractNumber", contractNumber))
    .collect();
  if (contracts.some((row) => row.companyId === companyId && row._id !== excludeId)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Contract number already exists for this customer" });
  }
}

function monthInputValue(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function monthStartTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Month must use YYYY-MM format",
    });
  }
  return Date.UTC(year, monthNumber - 1, 1);
}

function monthEndTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Month must use YYYY-MM format",
    });
  }
  return Date.UTC(year, monthNumber, 0, 23, 59, 59, 999);
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return monthInputValue(date.getTime());
}

function frequencyMonths(frequency: ContractInput["billingFrequency"]) {
  if (frequency === "quarterly" || frequency === "every_3_months") return 3;
  if (frequency === "yearly") return 12;
  if (frequency === "semiannual") return 6;
  return 1;
}

function invoiceIsOpen(status: Doc<"invoices">["status"]) {
  return status !== "cancelled" && status !== "void";
}

function contractCoversMonth(
  contract: Doc<"customerContracts">,
  month: string,
) {
  const start = monthStartTimestamp(month);
  const end = monthEndTimestamp(month);
  return contract.startDate <= end && contract.endDate >= start;
}

function comparisonRow(
  line: Doc<"customerContractLineItems">,
  usageEntries: Doc<"consumption">[],
  contract: Doc<"customerContracts">,
  lineIndex: number,
  allLines: Doc<"customerContractLineItems">[],
  monthFraction: number,
  currentCatalogPrice?: number,
): UsageComparisonRow {
  const matchedUsage = usageEntries.filter((usage) => {
    if (!usageMatchesLine(usage, line)) return false;
    if (!usage.usageDate) return true;
    const timestamp = Date.parse(`${usage.usageDate}T12:00:00Z`);
    return timestamp >= contract.startDate && timestamp <= contract.endDate;
  });
  const actualQuantity = matchedUsage.reduce((total, usage) => {
    if (usage.quantity !== undefined) return total + usage.quantity;
    const price = line.catalogUnitPrice ?? line.contractUnitPrice;
    if (price > 0) return total + usage.amount / price;
    return total;
  }, 0);
  const usageAmount = sumMoney(matchedUsage.map((usage) => usage.amount));
  const discount = contractDiscount(contract, line, lineIndex, allLines);
  const charges = calculateContractCharges({
    includedQuantity: line.includedQuantity,
    contractUnitPrice: line.contractUnitPrice,
    discountType: discount.type,
    discountValue: discount.value,
    overageUnitPrice: contractOveragePrice(contract, line, currentCatalogPrice),
    actualQuantity,
    monthFraction,
  });
  const baseAmount = sumMoney([
    charges.grossBaseAmount,
    -charges.discountAmount,
  ]);

  return {
    lineItemId: line._id,
    itemName: line.itemName,
    serviceCategory: line.serviceCategory,
    includedQuantity: line.includedQuantity,
    unit: line.unit,
    contractUnitPrice: line.contractUnitPrice,
    overageUnitPrice: charges.overageUnitPrice,
    actualQuantity,
    overageQuantity: charges.overageQuantity,
    baseAmount,
    overageAmount: charges.overageAmount,
    projectedAmount: charges.total,
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
    const rows = [];
    const monthFraction = calculateMonthProration({
      startDate: contract.startDate,
      endDate: contract.endDate,
      month: args.month,
    }).fraction;
    for (const [lineIndex, line] of lines
      .sort((a, b) => a.createdAt - b.createdAt)
      .entries()) {
      const catalogItem = line.catalogItemId
        ? await ctx.db.get(line.catalogItemId)
        : null;
      rows.push(
        comparisonRow(
          line,
          usageEntries,
          contract,
          lineIndex,
          lines,
          monthFraction,
          catalogItem?.monthlyPrice,
        ),
      );
    }

    return {
      month: args.month,
      rows,
      totals: {
        contractMinimum: sumMoney(rows.map((row) => row.baseAmount)),
        overage: sumMoney(rows.map((row) => row.overageAmount)),
        projected: sumMoney(rows.map((row) => row.projectedAmount)),
        usageAmount: sumMoney(usageEntries.map((usage) => usage.amount)),
        matchedEntries: rows.reduce(
          (total, row) => total + row.matchedEntries,
          0,
        ),
        totalUsageEntries: usageEntries.length,
      },
    };
  },
});

export const invoiceSchedule = query({
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
    const invoices = (
      await ctx.db
        .query("invoices")
        .withIndex("by_company", (q) => q.eq("companyId", contract.companyId))
        .collect()
    )
      .filter(
        (invoice) =>
          invoice.sourceReference === contract.contractNumber &&
          (invoice.contractInvoiceKind ?? "cycle") === "cycle" &&
          invoiceIsOpen(invoice.status),
      )
      .sort((a, b) => (b.sourceMonth ?? "").localeCompare(a.sourceMonth ?? ""));
    const currentMonth = monthInputValue();
    const currentInvoice =
      invoices.find((invoice) => invoice.sourceMonth === currentMonth) ?? null;
    const lastInvoice = invoices[0] ?? null;
    const startMonth = monthInputValue(contract.startDate);
    const nextSourceMonth =
      lastInvoice?.sourceMonth !== undefined
        ? addMonths(
            lastInvoice.sourceMonth,
            frequencyMonths(contract.billingFrequency),
          )
        : startMonth;
    const nextInvoiceDate =
      (contract.billingTiming ?? "postpaid") === "prepaid"
        ? monthStartTimestamp(nextSourceMonth)
        : monthEndTimestamp(nextSourceMonth);
    const nextDueDate =
      (contract.billingTiming ?? "postpaid") === "prepaid"
        ? nextInvoiceDate
        : contract.paymentTermDays === undefined
          ? undefined
          : nextInvoiceDate + contract.paymentTermDays * MS_PER_DAY;

    return {
      billingFrequency: contract.billingFrequency,
      currentMonth,
      currentMonthInvoiced: currentInvoice !== null,
      currentInvoice: currentInvoice
        ? {
            _id: currentInvoice._id,
            invoiceNumber: currentInvoice.invoiceNumber,
            status: currentInvoice.status,
            sourceMonth: currentInvoice.sourceMonth,
            createdAt: currentInvoice.createdAt,
            issueDate: currentInvoice.issueDate,
          }
        : null,
      lastInvoice: lastInvoice
        ? {
            _id: lastInvoice._id,
            invoiceNumber: lastInvoice.invoiceNumber,
            status: lastInvoice.status,
            sourceMonth: lastInvoice.sourceMonth,
            createdAt: lastInvoice.createdAt,
            issueDate: lastInvoice.issueDate,
          }
        : null,
      nextSourceMonth,
      nextInvoiceDate,
      nextDueDate,
      nextInvoiceCovered: contractCoversMonth(contract, nextSourceMonth),
    };
  },
});

export const generateSignedDocumentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveSignedDocument = mutation({
  args: {
    contractId: v.id("customerContracts"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
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
    assertAllowedSignedDocument(args.mimeType, args.size);
    const now = Date.now();
    await ctx.db.patch(args.contractId, {
      signedDocumentStorageId: args.storageId,
      signedDocumentFileName: cleanFileName(args.fileName),
      signedDocumentMimeType: args.mimeType,
      signedDocumentSize: args.size,
      signedDocumentUploadedBy: user._id,
      signedDocumentUploadedAt: now,
      signedDocumentUrl: undefined,
      updatedAt: now,
    });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      "updated",
      `Signed document ${cleanFileName(args.fileName)} uploaded`,
    );
  },
});

export const getSignedDocumentDownloadUrl = query({
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
    if (!contract.signedDocumentStorageId) return null;
    return await ctx.storage.getUrl(contract.signedDocumentStorageId);
  },
});

export const create = mutation({
  args: contractFieldsValidator,
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    await getVisibleCompany(ctx, user, args.companyId);
    const fields = normalizeFields(args);
    if (fields.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "New contracts must be saved as drafts and activated after services are added",
      });
    }
    await assertUniqueContractNumber(ctx, fields.companyId, fields.contractNumber);
    const now = Date.now();
    const contractId = await ctx.db.insert("customerContracts", {
      ...fields,
      activatedAt: undefined,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await insertEvent(
      ctx,
      contractId,
      user._id,
      "created",
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
    if (fields.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Use the Activate action after saving the draft contract",
      });
    }
    await assertUniqueContractNumber(
      ctx,
      fields.companyId,
      fields.contractNumber,
      args.contractId,
    );

    await ctx.db.patch(args.contractId, {
      ...fields,
      activatedAt: existing.activatedAt,
      updatedAt: Date.now(),
    });
    await insertEvent(
      ctx,
      args.contractId,
      user._id,
      existing.status !== fields.status
        ? statusEventType(fields.status)
        : "updated",
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
    await assertUniqueContractNumber(
      ctx,
      contract.companyId,
      contract.contractNumber,
      contract._id,
    );
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

    assertContractValueMatchesServices(contract, lineItems);

    await assertNoOverlappingActiveContract(ctx, contract, contract._id);

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
    const monthlyDelta = optionalFiniteNumber(
      args.monthlyDelta,
      "Monthly delta",
    );
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
