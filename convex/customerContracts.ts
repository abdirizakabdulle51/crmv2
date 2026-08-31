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
  roundMoney,
  sumMoney,
} from "./money";
import {
  contractDiscount,
  contractOveragePrice,
  isDynamicPricingContract,
} from "./contractPricing";
import {
  priceFlexibleContractUsage,
  priceMonthlyContractUsage,
} from "./contractUsagePricing";
import { PRODUCT_GROUPS } from "../src/lib/product-groups";

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
  contractNumber?: string;
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
  commitmentModel?: "flexible_value";
  pricingModel?:
    | "flexible_total_commitment"
    | "monthly_minimum"
    | "discounted_usage";
  monthlyMinimum?: number;
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
  productGroup?: string;
  serviceCode?: string;
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
  contractNumber: v.optional(v.string()),
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
  commitmentModel: v.optional(v.literal("flexible_value")),
  pricingModel: v.optional(
    v.union(
      v.literal("flexible_total_commitment"),
      v.literal("monthly_minimum"),
      v.literal("discounted_usage"),
    ),
  ),
  monthlyMinimum: v.optional(v.number()),
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
  productGroup: v.optional(v.string()),
  serviceCode: v.optional(v.string()),
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

const productGroupValues = new Set<string>(
  PRODUCT_GROUPS.map((group) => group.value),
);

function normalizeProductGroup(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!productGroupValues.has(normalized)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Select a valid HTGClouds product group",
    });
  }
  return normalized;
}

function normalizeDiscountPercent(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Discount percentage must be between 0 and 100",
    });
  }
  return value;
}

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
  const monthlyMinimum = assertNonNegative(
    args.monthlyMinimum,
    "Monthly minimum",
  );
  if (args.pricingBasis === "total_contract" && !contractValue) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "A positive contract value is required for total-value contracts",
    });
  }
  if (
    args.commitmentModel === "flexible_value" &&
    args.pricingBasis !== "total_contract"
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Flexible commitments require a total contract value",
    });
  }
  if (
    args.pricingModel === "flexible_total_commitment" &&
    (!contractValue || args.pricingBasis !== "total_contract")
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Flexible total commitments require a total contract value",
    });
  }
  if (args.pricingModel === "monthly_minimum" && !monthlyMinimum) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Monthly minimum contracts require a positive monthly minimum",
    });
  }
  if (
    (args.pricingModel === "monthly_minimum" ||
      args.pricingModel === "discounted_usage") &&
    (args.pricingBasis !== "service_lines" ||
      args.commitmentModel !== undefined ||
      contractValue !== undefined)
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Monthly usage contracts cannot have a total commitment balance",
    });
  }
  if (args.pricingModel !== "monthly_minimum" && monthlyMinimum !== undefined) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "A monthly minimum is only valid for monthly minimum contracts",
    });
  }
  if (
    (args.pricingModel === "monthly_minimum" ||
      args.pricingModel === "discounted_usage") &&
    (args.billingFrequency !== "monthly" || args.billingTiming !== "postpaid")
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Monthly usage contracts must be billed monthly and postpaid",
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
    contractNumber: requiredText(args.contractNumber ?? "", "Contract number"),
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
    commitmentModel: args.commitmentModel,
    pricingModel: args.pricingModel,
    monthlyMinimum,
    contractValue,
    defaultDiscountType: args.defaultDiscountType,
    defaultDiscountValue,
    overagePricingPolicy:
      args.pricingModel === "monthly_minimum" ||
      args.pricingModel === "discounted_usage"
        ? undefined
        : (args.overagePricingPolicy ?? "current_catalog"),
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
    productGroup: normalizeProductGroup(args.productGroup),
    serviceCode: optionalText(args.serviceCode),
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
  groupDiscountByKey: Map<string, number>,
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
        const discount = contractDiscount(
          contract,
          line,
          index,
          sorted,
          line.productGroup
            ? groupDiscountByKey.get(line.productGroup)
            : undefined,
        );
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
    .withIndex("by_contract_number", (q) =>
      q.eq("contractNumber", contractNumber),
    )
    .collect();
  if (
    contracts.some(
      (row) => row.companyId === companyId && row._id !== excludeId,
    )
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Contract number already exists for this customer",
    });
  }
}

async function nextContractNumber(ctx: MutationCtx, now = Date.now()) {
  const year = new Date(now).getUTCFullYear();
  const prefix = `CTR-${year}-`;
  const highest = (await ctx.db.query("customerContracts").collect()).reduce(
    (max, contract) => {
      if (!contract.contractNumber.startsWith(prefix)) return max;
      const sequence = Number(contract.contractNumber.slice(prefix.length));
      return Number.isInteger(sequence) ? Math.max(max, sequence) : max;
    },
    0,
  );
  return `${prefix}${String(highest + 1).padStart(5, "0")}`;
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
  groupDiscountPercent: number | undefined,
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
  const discount = contractDiscount(
    contract,
    line,
    lineIndex,
    allLines,
    groupDiscountPercent,
  );
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

export const performance = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const [contracts, allInvoices, allPayments] = await Promise.all([
      ctx.db
        .query("customerContracts")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
      ctx.db.query("invoices").collect(),
      ctx.db.query("invoicePayments").collect(),
    ]);
    const paymentsByInvoice = new Map<Id<"invoices">, number>();
    for (const payment of allPayments)
      paymentsByInvoice.set(
        payment.invoiceId,
        sumMoney([
          paymentsByInvoice.get(payment.invoiceId) ?? 0,
          payment.amount,
        ]),
      );
    const rows = [];
    for (const contract of contracts) {
      const company = await ctx.db.get(contract.companyId);
      if (!company || !canViewCompany(user, company)) continue;
      const invoices = allInvoices.filter(
        (invoice) =>
          invoice.companyId === company._id &&
          (invoice.contractId === contract._id ||
            invoice.sourceReference === contract.contractNumber) &&
          invoice.status !== "void" &&
          invoice.status !== "cancelled",
      );
      const billed = invoices.filter((invoice) => invoice.status !== "draft");
      const invoiced = sumMoney(billed.map((invoice) => invoice.grandTotal));
      const collected = sumMoney(
        invoices.map((invoice) => paymentsByInvoice.get(invoice._id) ?? 0),
      );
      let consumed: number | undefined;
      let overage = 0;
      if (
        contract.pricingModel === "flexible_total_commitment" &&
        Date.now() >= contract.startDate
      ) {
        const allocations = await priceFlexibleContractUsage(
          ctx,
          contract,
          Math.min(Date.now(), contract.endDate),
        );
        consumed = sumMoney(
          allocations.map((allocation) => allocation.commitmentConsumed),
        );
        overage = sumMoney(
          allocations.map((allocation) => allocation.overageAmount),
        );
      } else {
        overage = sumMoney(
          invoices
            .filter(
              (invoice) => invoice.contractInvoiceKind === "overage_settlement",
            )
            .map((invoice) => invoice.grandTotal),
        );
      }
      const duration = Math.max(1, contract.endDate - contract.startDate);
      const elapsedPercent = Math.max(
        0,
        Math.min(100, ((Date.now() - contract.startDate) / duration) * 100),
      );
      const utilizationPercent =
        consumed !== undefined && contract.contractValue
          ? (consumed / contract.contractValue) * 100
          : undefined;
      const outstanding = Math.max(0, sumMoney([invoiced, -collected]));
      const hasOverdue = billed.some((invoice) => invoice.status === "overdue");
      const signal =
        hasOverdue && outstanding > 0
          ? "Collection risk"
          : utilizationPercent !== undefined &&
              utilizationPercent > elapsedPercent + 20
            ? "Over-consuming"
            : utilizationPercent !== undefined &&
                utilizationPercent + 20 < elapsedPercent
              ? "Underutilized"
              : "On track";
      rows.push({
        contractId: contract._id,
        contractNumber: contract.contractNumber,
        companyName: company.name,
        contractValue: contract.contractValue,
        elapsedPercent,
        utilizationPercent,
        consumed,
        invoiced,
        collected,
        outstanding,
        overage,
        signal,
      });
    }
    return rows.sort((a, b) => b.outstanding - a.outstanding);
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

    const [lines, usageEntries, groupDiscounts] = await Promise.all([
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
      ctx.db
        .query("customerContractGroupDiscounts")
        .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
        .collect(),
    ]);
    const groupDiscountByKey = new Map(
      groupDiscounts.map((rule) => [rule.productGroup, rule.discountPercent]),
    );
    if (
      contract.pricingModel === "monthly_minimum" ||
      contract.pricingModel === "discounted_usage"
    ) {
      const pricing = await priceMonthlyContractUsage(
        ctx,
        contract,
        args.month,
      );
      const invoice = (
        await ctx.db
          .query("invoices")
          .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
          .collect()
      )
        .filter(
          (candidate) =>
            candidate.sourceMonth === args.month &&
            candidate.status !== "void" &&
            candidate.status !== "cancelled",
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const invoicedPayable = invoice?.contractUsageSummary?.payable;
      return {
        month: args.month,
        rows: [],
        totals: {
          contractMinimum: pricing.minimum,
          overage: 0,
          projected: pricing.payable,
          usageAmount: pricing.catalogueUsage,
          matchedEntries: pricing.entries,
          totalUsageEntries: pricing.totalEntries,
        },
        monthlyPricing: {
          catalogueUsage: pricing.catalogueUsage,
          discountedUsage: pricing.discountedUsage,
          minimum: pricing.minimum,
          shortfall: pricing.shortfall,
          payable: pricing.payable,
          reconciliation: invoice
            ? {
                invoiceId: invoice._id,
                invoiceStatus: invoice.status,
                invoicedPayable,
                difference:
                  invoicedPayable === undefined
                    ? undefined
                    : sumMoney([pricing.payable, -invoicedPayable]),
              }
            : undefined,
        },
      };
    }
    if (
      contract.commitmentModel === "flexible_value" ||
      contract.pricingModel === "flexible_total_commitment"
    ) {
      const through = monthEndTimestamp(args.month);
      const allocations = await priceFlexibleContractUsage(
        ctx,
        contract,
        through,
      );
      const remainingCommitment =
        allocations[allocations.length - 1]?.remainingCommitment ?? contract.contractValue ?? 0;
      return {
        month: args.month,
        rows: [],
        totals: {
          contractMinimum: contract.contractValue ?? 0,
          overage: sumMoney(allocations.map((row) => row.overageAmount)),
          projected: sumMoney([
            contract.contractValue ?? 0,
            ...allocations.map((row) => row.overageAmount),
          ]),
          usageAmount: sumMoney(allocations.map((row) => row.grossAmount)),
          matchedEntries: allocations.length,
          totalUsageEntries: allocations.length,
        },
        flexible: {
          commitmentValue: contract.contractValue ?? 0,
          consumed: sumMoney(allocations.map((row) => row.commitmentConsumed)),
          remaining: remainingCommitment,
          discountedUsage: sumMoney(
            allocations.map((row) => row.discountedAmount),
          ),
          catalogueUsage: sumMoney(allocations.map((row) => row.grossAmount)),
          overage: sumMoney(allocations.map((row) => row.overageAmount)),
        },
      };
    }
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
          line.productGroup
            ? groupDiscountByKey.get(line.productGroup)
            : undefined,
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
    const fields = normalizeFields({
      ...args,
      contractNumber: await nextContractNumber(ctx),
    });
    if (fields.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "New contracts must be saved as drafts and activated after services are added",
      });
    }
    await assertUniqueContractNumber(
      ctx,
      fields.companyId,
      fields.contractNumber,
    );
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

export const createConfigured = mutation({
  args: {
    ...contractFieldsValidator,
    groupDiscounts: v.array(
      v.object({ productGroup: v.string(), discountPercent: v.number() }),
    ),
    services: v.array(
      v.object({
        catalogItemId: v.id("serviceCatalog"),
        includedQuantity: v.number(),
        serviceDiscountPercent: v.optional(v.number()),
        overageUnitPrice: v.optional(v.number()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    await getVisibleCompany(ctx, user, args.companyId);
    const { groupDiscounts, services, ...contractArgs } = args;
    const fields = normalizeFields({
      ...contractArgs,
      contractNumber: await nextContractNumber(ctx),
    });
    if (fields.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Configured contracts must be created as drafts",
      });
    }
    const isDynamic =
      fields.commitmentModel === "flexible_value" ||
      fields.pricingModel !== undefined;
    if (!isDynamic && services.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select at least one contract service",
      });
    }
    await assertUniqueContractNumber(
      ctx,
      fields.companyId,
      fields.contractNumber,
    );
    const discountByGroup = new Map<string, number>();
    for (const rule of groupDiscounts) {
      const group = normalizeProductGroup(rule.productGroup)!;
      if (discountByGroup.has(group)) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: `Duplicate discount rule for ${group}`,
        });
      }
      discountByGroup.set(
        group,
        normalizeDiscountPercent(rule.discountPercent),
      );
    }

    const catalogs = [];
    const seenCatalogIds = new Set<string>();
    for (const service of services) {
      if (
        !Number.isFinite(service.includedQuantity) ||
        (!isDynamic && service.includedQuantity <= 0) ||
        service.includedQuantity < 0
      ) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: isDynamic
            ? "Service override quantity must be zero or greater"
            : "Included quantity must be greater than zero",
        });
      }
      if (seenCatalogIds.has(service.catalogItemId)) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "A catalogue item can only be selected once",
        });
      }
      seenCatalogIds.add(service.catalogItemId);
      const catalog = await ctx.db.get(service.catalogItemId);
      if (!catalog) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Catalogue item not found",
        });
      }
      const productGroup = normalizeProductGroup(catalog.productGroup);
      if (!productGroup) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: `${catalog.itemName} must be assigned to a product group before contracting`,
        });
      }
      catalogs.push({ service, catalog, productGroup });
    }

    const now = Date.now();
    const contractId = await ctx.db.insert("customerContracts", {
      ...fields,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    for (const [productGroup, discountPercent] of discountByGroup) {
      await ctx.db.insert("customerContractGroupDiscounts", {
        contractId,
        productGroup,
        discountPercent,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const { service, catalog, productGroup } of catalogs) {
      await ctx.db.insert("customerContractLineItems", {
        contractId,
        catalogItemId: catalog._id,
        itemName: catalog.itemName,
        serviceCategory: catalog.serviceCategory,
        productGroup,
        serviceCode: catalog.serviceCode ?? catalog.serviceCategory,
        description: catalog.specs,
        includedQuantity: assertNonNegative(
          service.includedQuantity,
          "Included quantity",
        )!,
        unit: catalog.billingUnit,
        catalogUnitPrice: catalog.monthlyPrice,
        contractUnitPrice: catalog.monthlyPrice,
        discountType:
          service.serviceDiscountPercent === undefined
            ? undefined
            : "percentage",
        discountValue:
          service.serviceDiscountPercent === undefined
            ? undefined
            : normalizeDiscountPercent(service.serviceDiscountPercent),
        overageUnitPrice: assertNonNegative(
          service.overageUnitPrice,
          "Overage price",
        ),
        billingUnit: catalog.billingUnit,
        notes: optionalText(service.notes),
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await insertEvent(
      ctx,
      contractId,
      user._id,
      "created",
      isDynamic
        ? `Dynamic-pricing customer contract ${fields.contractNumber} created with ${services.length} service overrides`
        : `Customer contract ${fields.contractNumber} created with ${services.length} services`,
    );
    return contractId;
  },
});

export const updateConfigured = mutation({
  args: {
    contractId: v.id("customerContracts"),
    ...contractFieldsValidator,
    groupDiscounts: v.array(
      v.object({ productGroup: v.string(), discountPercent: v.number() }),
    ),
    services: v.array(
      v.object({
        catalogItemId: v.id("serviceCatalog"),
        serviceDiscountPercent: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const existing = await ctx.db.get(args.contractId);
    if (!existing)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contract not found",
      });
    assertDraftContract(existing);
    if (!existing.pricingModel)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Legacy service-line contracts must be edited from their service lines or converted explicitly",
      });
    await getVisibleCompany(ctx, user, args.companyId);
    const { contractId, groupDiscounts, services, ...rawFields } = args;
    const fields = normalizeFields({
      ...rawFields,
      contractNumber: existing.contractNumber,
      commitmentModel: rawFields.commitmentModel ?? existing.commitmentModel,
      pricingModel: rawFields.pricingModel ?? existing.pricingModel,
      monthlyMinimum: rawFields.monthlyMinimum ?? existing.monthlyMinimum,
    });
    if (fields.status !== "draft")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only draft contracts can be edited",
      });
    await assertUniqueContractNumber(
      ctx,
      fields.companyId,
      fields.contractNumber,
      contractId,
    );

    const discounts = new Map<string, number>();
    for (const rule of groupDiscounts) {
      const group = normalizeProductGroup(rule.productGroup)!;
      if (discounts.has(group))
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: `Duplicate discount rule for ${group}`,
        });
      discounts.set(group, normalizeDiscountPercent(rule.discountPercent));
    }
    const prepared = [];
    const codes = new Set<string>();
    for (const service of services) {
      const catalog = await ctx.db.get(service.catalogItemId);
      if (!catalog?.productGroup || !catalog.serviceCode)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Service overrides require a classified catalogue service and code",
        });
      if (codes.has(catalog.serviceCode))
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: `Duplicate service override for ${catalog.serviceCode}`,
        });
      codes.add(catalog.serviceCode);
      prepared.push({
        catalog,
        discount: normalizeDiscountPercent(service.serviceDiscountPercent),
      });
    }

    const [oldGroups, oldLines] = await Promise.all([
      ctx.db
        .query("customerContractGroupDiscounts")
        .withIndex("by_contract", (q) => q.eq("contractId", contractId))
        .collect(),
      ctx.db
        .query("customerContractLineItems")
        .withIndex("by_contract", (q) => q.eq("contractId", contractId))
        .collect(),
    ]);
    for (const row of [...oldGroups, ...oldLines]) await ctx.db.delete(row._id);
    const now = Date.now();
    await ctx.db.patch(contractId, {
      ...fields,
      activatedAt: existing.activatedAt,
      updatedAt: now,
    });
    for (const [productGroup, discountPercent] of discounts)
      await ctx.db.insert("customerContractGroupDiscounts", {
        contractId,
        productGroup,
        discountPercent,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    for (const { catalog, discount } of prepared)
      await ctx.db.insert("customerContractLineItems", {
        contractId,
        catalogItemId: catalog._id,
        itemName: catalog.itemName,
        serviceCategory: catalog.serviceCategory,
        productGroup: catalog.productGroup,
        serviceCode: catalog.serviceCode,
        description: catalog.specs,
        includedQuantity: 0,
        unit: catalog.billingUnit,
        catalogUnitPrice: catalog.monthlyPrice,
        contractUnitPrice: catalog.monthlyPrice,
        discountType: "percentage",
        discountValue: discount,
        billingUnit: catalog.billingUnit,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    await insertEvent(
      ctx,
      contractId,
      user._id,
      "updated",
      "Contract terms and discount rules updated",
    );
  },
});

export const listGroupDiscounts = query({
  args: { contractId: v.id("customerContracts") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) return [];
    await getVisibleCompany(ctx, user, contract.companyId);
    return await ctx.db
      .query("customerContractGroupDiscounts")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
  },
});

export const setGroupDiscounts = mutation({
  args: {
    contractId: v.id("customerContracts"),
    discounts: v.array(
      v.object({ productGroup: v.string(), discountPercent: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const contract = await ctx.db.get(args.contractId);
    if (!contract)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contract not found",
      });
    assertDraftContract(contract);
    await getVisibleCompany(ctx, user, contract.companyId);
    const normalized = new Map<string, number>();
    for (const rule of args.discounts) {
      const group = normalizeProductGroup(rule.productGroup)!;
      if (normalized.has(group))
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: `Duplicate discount rule for ${group}`,
        });
      normalized.set(group, normalizeDiscountPercent(rule.discountPercent));
    }
    const existing = await ctx.db
      .query("customerContractGroupDiscounts")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const [productGroup, discountPercent] of normalized) {
      await ctx.db.insert("customerContractGroupDiscounts", {
        contractId: args.contractId,
        productGroup,
        discountPercent,
        createdBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(args.contractId, { updatedAt: now });
  },
});

export const setServiceDiscountOverride = mutation({
  args: {
    contractId: v.id("customerContracts"),
    catalogItemId: v.id("serviceCatalog"),
    discountPercent: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageContracts(user);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contract not found",
      });
    }
    assertDraftContract(contract);
    await getVisibleCompany(ctx, user, contract.companyId);
    if (!isDynamicPricingContract(contract)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Service discount overrides are only valid for dynamic-pricing contracts",
      });
    }
    const catalog = await ctx.db.get(args.catalogItemId);
    if (!catalog?.productGroup || !catalog.serviceCode) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select a classified catalogue service with a service code",
      });
    }
    const discountPercent = normalizeDiscountPercent(args.discountPercent);
    const existing = await ctx.db
      .query("customerContractLineItems")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    for (const line of existing.filter(
      (line) => line.serviceCode === catalog.serviceCode,
    )) {
      await ctx.db.delete(line._id);
    }
    const now = Date.now();
    await ctx.db.insert("customerContractLineItems", {
      contractId: args.contractId,
      catalogItemId: catalog._id,
      itemName: catalog.itemName,
      serviceCategory: catalog.serviceCategory,
      productGroup: catalog.productGroup,
      serviceCode: catalog.serviceCode,
      description: catalog.specs,
      includedQuantity: 0,
      unit: catalog.billingUnit,
      catalogUnitPrice: catalog.monthlyPrice,
      contractUnitPrice: catalog.monthlyPrice,
      discountType: "percentage",
      discountValue: discountPercent,
      billingUnit: catalog.billingUnit,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.contractId, { updatedAt: now });
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
    const fields = normalizeFields({
      ...args,
      contractNumber: existing.contractNumber,
      commitmentModel: args.commitmentModel ?? existing.commitmentModel,
      pricingModel: args.pricingModel ?? existing.pricingModel,
      monthlyMinimum: args.monthlyMinimum ?? existing.monthlyMinimum,
    });
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
    const groupDiscounts = await ctx.db
      .query("customerContractGroupDiscounts")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contractId))
      .collect();
    const isDynamic =
      contract.commitmentModel === "flexible_value" ||
      contract.pricingModel !== undefined;
    if (!isDynamic && lineItems.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Add at least one contract service before activating",
      });
    }

    if (!isDynamic) {
      assertContractValueMatchesServices(
        contract,
        lineItems,
        new Map(
          groupDiscounts.map((rule) => [
            rule.productGroup,
            rule.discountPercent,
          ]),
        ),
      );
    }

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
    const catalog = args.catalogItemId
      ? await ctx.db.get(args.catalogItemId)
      : null;
    const now = Date.now();
    const lineItemId = await ctx.db.insert("customerContractLineItems", {
      ...fields,
      productGroup: catalog?.productGroup ?? fields.productGroup,
      serviceCode:
        catalog?.serviceCode ?? catalog?.serviceCategory ?? fields.serviceCode,
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
    const catalog = args.catalogItemId
      ? await ctx.db.get(args.catalogItemId)
      : null;
    const now = Date.now();
    await ctx.db.patch(args.lineItemId, {
      ...fields,
      productGroup: catalog?.productGroup ?? fields.productGroup,
      serviceCode:
        catalog?.serviceCode ?? catalog?.serviceCategory ?? fields.serviceCode,
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
