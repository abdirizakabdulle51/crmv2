import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertCanManageUsage,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";
import { buildUsageHintsForCompany } from "./manageOneTenants";
import {
  assertSupportedCurrency,
  calculateContractCharges,
  calculateInvoiceTotals,
  calculateMonthProration,
  roundMoney,
  roundQuantity,
  sumMoney,
  withInvoiceMoneyCents,
  withLineMoneyCents,
} from "./money";
import { findApplicableCredit, reserveCredit } from "./customerCredits";
import { contractDiscount, contractOveragePrice } from "./contractPricing";

type CatalogItem = Doc<"serviceCatalog">;
type ManageOneTenant = Doc<"manageOneTenants">;
type ContractLineItem = Doc<"customerContractLineItems">;
type RollupRow = {
  companyId: Id<"companies">;
  companyName: string;
  serviceType: string;
  itemName: string;
  unit: string;
  catalogItemId?: Id<"serviceCatalog">;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
  dailyQuantityTotal: number;
  capturedDays: number;
  billableQuantity: number;
  monthlyUnitPrice?: number;
  estimatedAmount?: number;
  pricingSource?: "catalog" | "contract";
  contractId?: Id<"customerContracts">;
  contractNumber?: string;
  contractLineItemId?: Id<"customerContractLineItems">;
  contractGrossBaseAmount?: number;
  contractDiscountAmount?: number;
  overageQuantity?: number;
  overageUnitPrice?: number;
  contractGrossMonthlyPrice?: number;
};

export type DailyUsageSnapshotInput = {
  companyId: Id<"companies">;
  tenantId: Id<"manageOneTenants">;
  tenantName: string;
  tenantVdcId: string;
  tenantDomainId?: string;
  usageDate: string;
  month: string;
  serviceType: string;
  itemName: string;
  serviceCategory: string;
  quantity: number;
  unit: string;
  catalogItemId?: Id<"serviceCatalog">;
  source: "manageone";
  sourceKey: string;
  sourceSyncedAt?: number;
  capturedAt: number;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

const BUSINESS_TIME_ZONE = "Africa/Mogadishu";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOURLY_STALE_MS = 2 * 60 * 60 * 1000;

function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx) {
  return ctx.auth.getUserIdentity().then(async (identity) => {
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
  });
}

export function dateKeyForTimestamp(
  timestamp: number,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to format daily usage date");
  }

  return `${year}-${month}-${day}`;
}

function assertValidDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "usageDate must use YYYY-MM-DD format",
    });
  }
}

function optionalRegionFields(source: {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return {
    ...(source.regionId ? { regionId: source.regionId } : {}),
    ...(source.regionName ? { regionName: source.regionName } : {}),
    ...(source.dataCenterName ? { dataCenterName: source.dataCenterName } : {}),
  };
}

function stableSegment(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function defaultUnitForService(serviceCategory: string) {
  const normalized = serviceCategory.toLowerCase();
  if (
    normalized.includes("obs") ||
    normalized.includes("evs") ||
    normalized.includes("sfs")
  ) {
    return "GB/day snapshot";
  }
  if (normalized.includes("bandwidth")) {
    return "Mbps/day snapshot";
  }
  if (normalized.includes("eip")) {
    return "IP/day snapshot";
  }
  return "unit/day snapshot";
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) {
    return 30;
  }
  return new Date(year, monthNumber, 0).getDate();
}

function monthEndTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Source month must use YYYY-MM format",
    });
  }
  return Date.UTC(year, monthNumber, 0, 23, 59, 59, 999);
}

function monthStartTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Source month must use YYYY-MM format",
    });
  }
  return Date.UTC(year, monthNumber - 1, 1);
}

function monthBounds(month: string) {
  return {
    start: monthStartTimestamp(month),
    end: monthEndTimestamp(month),
  };
}

function dailyUsageSourceReference(month: string) {
  return `Daily usage ${month}`;
}

function contractCoversMonth(
  contract: Doc<"customerContracts">,
  month: string,
) {
  const start = monthStartTimestamp(month);
  const end = monthEndTimestamp(month);
  return contract.startDate <= end && contract.endDate >= start;
}

function contractLineMatchesUsage(
  row: Pick<RollupRow, "catalogItemId" | "itemName" | "serviceType" | "unit">,
  line: ContractLineItem,
) {
  return Boolean(
    line.catalogItemId && row.catalogItemId === line.catalogItemId,
  );
}

type ContractPricingContext = Map<
  Id<"companies">,
  {
    contract: Doc<"customerContracts">;
    lines: ContractLineItem[];
    groupDiscountByKey: Map<string, number>;
  }
>;

function findContractLineForRollupRow(
  row: Pick<
    RollupRow,
    "companyId" | "catalogItemId" | "itemName" | "serviceType" | "unit"
  >,
  contractPricingByCompany?: ContractPricingContext,
) {
  const context = contractPricingByCompany?.get(row.companyId);
  if (!context) return null;
  const lineIndex = context.lines.findIndex((candidate) =>
    contractLineMatchesUsage(row, candidate),
  );
  if (lineIndex < 0) return null;
  return { contract: context.contract, line: context.lines[lineIndex], lineIndex };
}

async function loadActiveContractPricingForMonth(
  ctx: QueryCtx | MutationCtx,
  companyIds: Id<"companies">[],
  month: string,
) {
  const uniqueCompanyIds = [...new Set(companyIds)];
  const context: ContractPricingContext = new Map();

  for (const companyId of uniqueCompanyIds) {
    const contracts = await ctx.db
      .query("customerContracts")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    const contract = contracts
      .filter(
        (candidate) =>
          candidate.status === "active" &&
          contractCoversMonth(candidate, month),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!contract) continue;

    const lines = await ctx.db
      .query("customerContractLineItems")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();
    const groupDiscounts = await ctx.db
      .query("customerContractGroupDiscounts")
      .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
      .collect();
    context.set(companyId, {
      contract,
      lines: lines.sort((a, b) => a.createdAt - b.createdAt),
      groupDiscountByKey: new Map(
        groupDiscounts.map((rule) => [
          rule.productGroup,
          rule.discountPercent,
        ]),
      ),
    });
  }

  return context;
}

async function resolveInvoiceProfileForCompany(
  ctx: QueryCtx | MutationCtx,
  company: Doc<"companies">,
) {
  const countryProfiles = await ctx.db
    .query("invoiceProfiles")
    .withIndex("by_country", (q) => q.eq("countryId", company.countryId))
    .collect();
  const countryMatch = countryProfiles.find((profile) => profile.isActive);
  if (countryMatch) return countryMatch;

  const defaults = await ctx.db
    .query("invoiceProfiles")
    .withIndex("by_default_active", (q) =>
      q.eq("isDefault", true).eq("isActive", true),
    )
    .collect();
  return defaults[0] ?? null;
}

function sellerSnapshotFromProfile(profile: Doc<"invoiceProfiles">) {
  return {
    sellerLegalName: profile.legalName,
    sellerAddressLines: [...profile.addressLines],
    sellerPhone: profile.phone,
    sellerEmail: profile.email,
    sellerWebsite: profile.website,
    sellerSlogan: profile.slogan,
    sellerTaxId: profile.taxId,
    sellerBankName: profile.bankName,
    sellerBankAccountNumber: profile.bankAccountNumber,
    sellerBankAccountName: profile.bankAccountName,
    sellerBankLocation: profile.bankLocation,
    sellerCurrency: profile.currency,
    sellerCurrencyNote: profile.currencyNote,
    sellerPaymentInstructions: profile.paymentInstructions,
    sellerFooterText: profile.footerText,
  } satisfies Partial<Doc<"invoices">>;
}

export function buildMonthlyRollupRows(args: {
  rows: Doc<"dailyUsageSnapshots">[];
  catalogById: Map<Id<"serviceCatalog">, CatalogItem>;
  companyNameById: Map<Id<"companies">, string>;
  month: string;
  contractPricingByCompany?: ContractPricingContext;
}) {
  const monthDayCount = daysInMonth(args.month);
  const rollupByKey = new Map<
    string,
    Omit<RollupRow, "capturedDays" | "billableQuantity" | "estimatedAmount"> & {
      capturedDays: Set<string>;
      quantityByDate: Map<string, number>;
    }
  >();

  for (const row of args.rows) {
    const groupKey = [
      row.companyId,
      row.catalogItemId ?? row.itemName,
      row.serviceType,
      row.unit,
      row.regionName ?? row.dataCenterName ?? "",
    ].join("|");
    const existing = rollupByKey.get(groupKey) ?? {
      companyId: row.companyId,
      companyName: args.companyNameById.get(row.companyId) ?? "Unknown",
      serviceType: row.serviceType,
      itemName: row.itemName,
      unit: row.unit,
      ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
      ...(row.regionId ? { regionId: row.regionId } : {}),
      ...(row.regionName ? { regionName: row.regionName } : {}),
      ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
      dailyQuantityTotal: 0,
      capturedDays: new Set<string>(),
      quantityByDate: new Map<string, number>(),
      monthlyUnitPrice: row.catalogItemId
        ? args.catalogById.get(row.catalogItemId)?.monthlyPrice
        : undefined,
      pricingSource:
        row.catalogItemId && args.catalogById.get(row.catalogItemId)
          ? "catalog"
          : undefined,
    };

    existing.dailyQuantityTotal += row.quantity;
    existing.capturedDays.add(row.usageDate);
    existing.quantityByDate.set(
      row.usageDate,
      (existing.quantityByDate.get(row.usageDate) ?? 0) + row.quantity,
    );
    rollupByKey.set(groupKey, existing);
  }

  return [...rollupByKey.values()]
    .flatMap((row) => {
      const capturedDayCount = row.capturedDays.size;
      const contractMatch = findContractLineForRollupRow(
        row,
        args.contractPricingByCompany,
      );
      const contractLine = contractMatch?.line;
      const activeEntries = contractMatch
        ? [...row.quantityByDate.entries()].filter(([date]) => {
            const timestamp = Date.parse(`${date}T00:00:00.000Z`);
            return (
              timestamp >= contractMatch.contract.startDate &&
              timestamp <= contractMatch.contract.endDate
            );
          })
        : [...row.quantityByDate.entries()];
      const activeUsageQuantity = contractMatch
        ? activeEntries.reduce((sum, [, quantity]) => sum + quantity, 0)
        : row.dailyQuantityTotal;
      const activeCapturedDayCount = contractMatch
        ? new Set(activeEntries.map(([date]) => date)).size
        : capturedDayCount;
      const capturedMonthFraction = activeCapturedDayCount / monthDayCount;
      const proratedMonthFraction = contractMatch
        ? Math.min(
            capturedMonthFraction,
            calculateMonthProration({
              startDate: contractMatch.contract.startDate,
              endDate: contractMatch.contract.endDate,
              month: args.month,
            }).fraction,
          )
        : capturedMonthFraction;
      const usageBillableQuantity = activeUsageQuantity / monthDayCount;
      const discount = contractMatch
        ? contractDiscount(
            contractMatch.contract,
            contractMatch.line,
            contractMatch.lineIndex,
            args.contractPricingByCompany?.get(row.companyId)?.lines,
            contractMatch.line.productGroup
              ? args.contractPricingByCompany
                  ?.get(row.companyId)
                  ?.groupDiscountByKey.get(contractMatch.line.productGroup)
              : undefined,
          )
        : undefined;
      const currentCatalogPrice = contractLine?.catalogItemId
        ? args.catalogById.get(contractLine.catalogItemId)?.monthlyPrice
        : undefined;
      const contractCharges = contractLine
        ? calculateContractCharges({
            includedQuantity: contractLine.includedQuantity,
            contractUnitPrice: contractLine.contractUnitPrice,
            discountType: discount?.type,
            discountValue: discount?.value,
            overageUnitPrice: contractOveragePrice(
              contractMatch!.contract,
              contractLine,
              currentCatalogPrice,
            ),
            actualQuantity: usageBillableQuantity,
            monthFraction: proratedMonthFraction,
          })
        : undefined;
      const contractGrossBaseAmount = contractCharges?.grossBaseAmount;
      const contractDiscountAmount = contractCharges?.discountAmount;
      const contractEstimatedAmount = contractCharges?.total;
      const overageQuantity = contractCharges?.overageQuantity ?? 0;
      const billableQuantity = contractLine
        ? proratedMonthFraction
        : usageBillableQuantity;
      const monthlyUnitPrice = contractLine
        ? calculateContractCharges({
            includedQuantity: contractLine.includedQuantity,
            contractUnitPrice: contractLine.contractUnitPrice,
            discountType: contractLine.discountType,
            discountValue: contractLine.discountValue,
            overageUnitPrice: contractLine.overageUnitPrice,
            actualQuantity: 0,
            monthFraction: 1,
          }).total
        : row.monthlyUnitPrice;
      const estimatedAmount =
        contractEstimatedAmount ??
        (monthlyUnitPrice === undefined
          ? undefined
          : roundMoney(billableQuantity * monthlyUnitPrice));

      const contractRow = {
        companyId: row.companyId,
        companyName: row.companyName,
        serviceType: row.serviceType,
        itemName: row.itemName,
        unit: contractLine ? "contract/month" : row.unit,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
        capturedDays: activeCapturedDayCount,
        dailyQuantityTotal: activeUsageQuantity,
        billableQuantity,
        monthlyUnitPrice,
        estimatedAmount,
        pricingSource: contractLine ? "contract" : row.pricingSource,
        ...(contractMatch
          ? {
              contractId: contractMatch.contract._id,
              contractNumber: contractMatch.contract.contractNumber,
              contractLineItemId: contractMatch.line._id,
              contractGrossBaseAmount,
              contractDiscountAmount,
              contractGrossMonthlyPrice: calculateContractCharges({
                includedQuantity: contractMatch.line.includedQuantity,
                contractUnitPrice: contractMatch.line.contractUnitPrice,
                actualQuantity: 0,
                monthFraction: 1,
              }).grossBaseAmount,
              overageQuantity: roundQuantity(overageQuantity),
              overageUnitPrice:
                contractOveragePrice(
                  contractMatch.contract,
                  contractMatch.line,
                  currentCatalogPrice,
                ),
            }
          : {}),
      } satisfies RollupRow;
      if (!contractMatch) return [contractRow];

      const preContractEntries = [...row.quantityByDate.entries()].filter(
        ([date]) => {
          const timestamp = Date.parse(`${date}T00:00:00.000Z`);
          return timestamp < contractMatch.contract.startDate;
        },
      );
      const preContractQuantity = preContractEntries.reduce(
        (sum, [, quantity]) => sum + quantity,
        0,
      );
      if (preContractQuantity <= 0) return [contractRow];
      const catalogPrice = row.catalogItemId
        ? args.catalogById.get(row.catalogItemId)?.monthlyPrice
        : undefined;
      const preContractBillableQuantity = preContractQuantity / monthDayCount;
      const preContractRow: RollupRow = {
        companyId: row.companyId,
        companyName: row.companyName,
        serviceType: row.serviceType,
        itemName: `${row.itemName} (pre-contract)`,
        unit: row.unit,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
        capturedDays: new Set(preContractEntries.map(([date]) => date)).size,
        dailyQuantityTotal: preContractQuantity,
        billableQuantity: preContractBillableQuantity,
        monthlyUnitPrice: catalogPrice,
        estimatedAmount:
          catalogPrice === undefined
            ? undefined
            : roundMoney(preContractBillableQuantity * catalogPrice),
        pricingSource: catalogPrice === undefined ? undefined : "catalog",
      };
      return [preContractRow, contractRow];
    })
    .sort((a, b) => {
      const companyCompare = a.companyName.localeCompare(b.companyName);
      if (companyCompare !== 0) return companyCompare;
      const serviceCompare = a.serviceType.localeCompare(b.serviceType);
      if (serviceCompare !== 0) return serviceCompare;
      return a.itemName.localeCompare(b.itemName);
    });
}

export function buildDailyUsageReviewResult(args: {
  month: string;
  rows: Doc<"dailyUsageSnapshots">[];
  visibleCompanyById: Map<Id<"companies">, Doc<"companies">>;
  catalogById: Map<Id<"serviceCatalog">, CatalogItem>;
  contractPricingByCompany?: ContractPricingContext;
  businessDate: string;
}) {
  const visibleRows = args.rows.filter((row) =>
    args.visibleCompanyById.has(row.companyId),
  );
  const billingHealth = buildDailyUsageBillingHealth(
    visibleRows,
    args.businessDate,
  );
  const companyNameById = new Map<Id<"companies">, string>(
    [...args.visibleCompanyById.values()].map((company) => [
      company._id,
      company.name,
    ]),
  );

  const serviceTypes = [...new Set(visibleRows.map((row) => row.serviceType))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const usageDates = [...new Set(visibleRows.map((row) => row.usageDate))]
    .filter(Boolean)
    .sort();
  const companies = [...companyNameById.entries()]
    .map(([companyId, companyName]) => ({ companyId, companyName }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  const sortedRows = [...visibleRows].sort((a, b) => {
    const dateCompare = b.usageDate.localeCompare(a.usageDate);
    if (dateCompare !== 0) return dateCompare;
    const companyCompare = (
      companyNameById.get(a.companyId) ?? ""
    ).localeCompare(companyNameById.get(b.companyId) ?? "");
    if (companyCompare !== 0) return companyCompare;
    return a.serviceType.localeCompare(b.serviceType);
  });

  const monthDayCount = daysInMonth(args.month);
  const rollupRows = buildMonthlyRollupRows({
    rows: visibleRows,
    catalogById: args.catalogById,
    companyNameById,
    month: args.month,
    contractPricingByCompany: args.contractPricingByCompany,
  });

  return {
    month: args.month,
    rows: sortedRows.map((row) => ({
      ...row,
      companyName: companyNameById.get(row.companyId) ?? "Unknown",
    })),
    rollup: {
      daysInMonth: monthDayCount,
      rows: rollupRows,
      totals: {
        estimatedAmount: sumMoney(
          rollupRows.map((row) => row.estimatedAmount ?? 0),
        ),
        unpricedCount: rollupRows.filter(
          (row) => row.estimatedAmount === undefined,
        ).length,
        attachedCount: visibleRows.filter(
          (row) => row.invoiceId || row.lockedAt,
        ).length,
      },
    },
    summary: {
      rowCount: visibleRows.length,
      companyCount: companies.length,
      serviceCount: serviceTypes.length,
      dayCount: usageDates.length,
      capturedCount: visibleRows.filter((row) => !row.lockedAt).length,
      lockedCount: visibleRows.filter((row) => row.lockedAt).length,
    },
    filters: {
      companies,
      serviceTypes,
      usageDates,
    },
    billingHealth,
  };
}

export const DAILY_USAGE_BILLING_SNAPSHOT_CALCULATION_VERSION =
  "daily-usage-review-v1";

type DailyUsageReviewResult = ReturnType<typeof buildDailyUsageReviewResult>;

type DailyUsageBillingSnapshotCandidate = {
  companyId: Id<"companies">;
  month: string;
  calculationVersion: string;
  inputDigest: string;
  billingResultDigest: string;
  computedAt: number;
  sourceLatestCapturedAt?: number;
  rowCount: number;
  serviceCount: number;
  dayCount: number;
  capturedCount: number;
  lockedCount: number;
  attachedCount: number;
  unpricedCount: number;
  rollupRowCount: number;
  estimatedAmount: number;
  catalogPricedRowCount: number;
  contractPricedRowCount: number;
  latestUsageDate?: string;
  capturedThroughToday: boolean;
  latestDayRowCount: number;
  missingPriceRowCount: number;
  missingServiceCount: number;
};

function canonicalizeForDigest(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForDigest);
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [
        String(key),
        canonicalizeForDigest(entryValue),
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalizeForDigest(entryValue)]),
    );
  }
  return value;
}

function deterministicDigest(value: unknown) {
  const serialized = JSON.stringify(canonicalizeForDigest(value));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `d1:${(first >>> 0).toString(16).padStart(8, "0")}${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
}

function sortDocumentsForDigest<T extends { _id: string }>(documents: T[]) {
  return [...documents].sort((left, right) =>
    String(left._id).localeCompare(String(right._id)),
  );
}

export function buildDailyUsageBillingInputDigest(args: {
  month: string;
  businessDate: string;
  rows: Doc<"dailyUsageSnapshots">[];
  companies: Doc<"companies">[];
  catalogItems: CatalogItem[];
  contractPricingByCompany?: ContractPricingContext;
}) {
  const contractPricing = [...(args.contractPricingByCompany?.entries() ?? [])]
    .map(([companyId, context]) => ({
      companyId,
      contract: context.contract,
      lines: sortDocumentsForDigest(context.lines),
      groupDiscounts: [...context.groupDiscountByKey.entries()].sort(
        ([left], [right]) => left.localeCompare(right),
      ),
    }))
    .sort((left, right) =>
      String(left.companyId).localeCompare(String(right.companyId)),
    );

  return deterministicDigest({
    month: args.month,
    businessDate: args.businessDate,
    rows: sortDocumentsForDigest(args.rows),
    companies: sortDocumentsForDigest(args.companies),
    catalogItems: sortDocumentsForDigest(args.catalogItems),
    contractPricing,
  });
}

function compactBillingResult(reviewResult: DailyUsageReviewResult) {
  const rollupRows = [...reviewResult.rollup.rows]
    .map((row) => ({
      companyId: row.companyId,
      serviceType: row.serviceType,
      itemName: row.itemName,
      unit: row.unit,
      catalogItemId: row.catalogItemId,
      regionId: row.regionId,
      regionName: row.regionName,
      dataCenterName: row.dataCenterName,
      dailyQuantityTotal: row.dailyQuantityTotal,
      capturedDays: row.capturedDays,
      billableQuantity: row.billableQuantity,
      monthlyUnitPrice: row.monthlyUnitPrice,
      estimatedAmount: row.estimatedAmount,
      pricingSource: row.pricingSource,
      contractId: row.contractId,
      contractLineItemId: row.contractLineItemId,
      contractGrossBaseAmount: row.contractGrossBaseAmount,
      contractDiscountAmount: row.contractDiscountAmount,
      overageQuantity: row.overageQuantity,
      overageUnitPrice: row.overageUnitPrice,
      contractGrossMonthlyPrice: row.contractGrossMonthlyPrice,
    }))
    .sort((left, right) =>
      [
        String(left.companyId),
        left.serviceType,
        left.itemName,
        left.unit,
        left.regionId ?? "",
      ]
        .join("|")
        .localeCompare(
          [
            String(right.companyId),
            right.serviceType,
            right.itemName,
            right.unit,
            right.regionId ?? "",
          ].join("|"),
        ),
    );

  return {
    month: reviewResult.month,
    rollupRows,
    rollupTotals: reviewResult.rollup.totals,
    summary: reviewResult.summary,
    billingHealth: reviewResult.billingHealth,
  };
}

export function buildDailyUsageBillingSnapshotCandidate(args: {
  companyId: Id<"companies">;
  month: string;
  rows: Doc<"dailyUsageSnapshots">[];
  reviewResult: DailyUsageReviewResult;
  inputDigest: string;
  computedAt: number;
  calculationVersion?: string;
}) {
  const rollupRows = args.reviewResult.rollup.rows;
  const latestCapturedAt = args.rows.reduce<number | undefined>(
    (latest, row) =>
      latest === undefined || row.capturedAt > latest
        ? row.capturedAt
        : latest,
    undefined,
  );
  const candidate: DailyUsageBillingSnapshotCandidate = {
    companyId: args.companyId,
    month: args.month,
    calculationVersion:
      args.calculationVersion ??
      DAILY_USAGE_BILLING_SNAPSHOT_CALCULATION_VERSION,
    inputDigest: args.inputDigest,
    billingResultDigest: deterministicDigest(
      compactBillingResult(args.reviewResult),
    ),
    computedAt: args.computedAt,
    ...(latestCapturedAt === undefined
      ? {}
      : { sourceLatestCapturedAt: latestCapturedAt }),
    rowCount: args.reviewResult.summary.rowCount,
    serviceCount: args.reviewResult.summary.serviceCount,
    dayCount: args.reviewResult.summary.dayCount,
    capturedCount: args.reviewResult.summary.capturedCount,
    lockedCount: args.reviewResult.summary.lockedCount,
    attachedCount: args.reviewResult.rollup.totals.attachedCount,
    unpricedCount: args.reviewResult.rollup.totals.unpricedCount,
    rollupRowCount: rollupRows.length,
    estimatedAmount: args.reviewResult.rollup.totals.estimatedAmount,
    catalogPricedRowCount: rollupRows.filter(
      (row) => row.pricingSource === "catalog",
    ).length,
    contractPricedRowCount: rollupRows.filter(
      (row) => row.pricingSource === "contract",
    ).length,
    ...(args.reviewResult.billingHealth.latestUsageDate
      ? { latestUsageDate: args.reviewResult.billingHealth.latestUsageDate }
      : {}),
    capturedThroughToday:
      args.reviewResult.billingHealth.capturedThroughToday,
    latestDayRowCount: args.reviewResult.billingHealth.latestDayRowCount,
    missingPriceRowCount:
      args.reviewResult.billingHealth.missingPriceRowCount,
    missingServiceCount:
      args.reviewResult.billingHealth.missingServices.length,
  };
  return candidate;
}

export function compareDailyUsageBillingSnapshot(
  persisted: Pick<
    DailyUsageBillingSnapshotCandidate,
    "calculationVersion" | "inputDigest" | "billingResultDigest"
  > | null,
  candidate: Pick<
    DailyUsageBillingSnapshotCandidate,
    "calculationVersion" | "inputDigest" | "billingResultDigest"
  >,
) {
  if (!persisted) {
    return { status: "missing" as const, reason: "snapshot_missing" as const };
  }
  if (persisted.calculationVersion !== candidate.calculationVersion) {
    return {
      status: "stale" as const,
      reason: "calculation_version_changed" as const,
    };
  }
  if (persisted.inputDigest !== candidate.inputDigest) {
    return { status: "stale" as const, reason: "inputs_changed" as const };
  }
  if (persisted.billingResultDigest !== candidate.billingResultDigest) {
    return {
      status: "mismatch" as const,
      reason: "billing_result_changed" as const,
    };
  }
  return { status: "match" as const, reason: "identical" as const };
}

export function shouldWriteDailyUsageBillingSnapshot(
  persisted: Pick<
    DailyUsageBillingSnapshotCandidate,
    "calculationVersion" | "inputDigest" | "billingResultDigest"
  > | null,
  candidate: Pick<
    DailyUsageBillingSnapshotCandidate,
    "calculationVersion" | "inputDigest" | "billingResultDigest"
  >,
) {
  return compareDailyUsageBillingSnapshot(persisted, candidate).status !== "match";
}

async function buildCompanyMonthBillingSnapshotCandidate(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  month: string,
  computedAt: number,
) {
  const [company, rows, catalogItems] = await Promise.all([
    ctx.db.get(companyId),
    ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", companyId).eq("month", month),
      )
      .collect(),
    ctx.db.query("serviceCatalog").collect(),
  ]);
  if (!company) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Company not found",
    });
  }

  const businessDate = dateKeyForTimestamp(computedAt);
  const companies = [company];
  const visibleCompanyById = new Map([[company._id, company]]);
  const catalogById = new Map(
    catalogItems.map((item) => [item._id, item] as const),
  );
  const contractPricingByCompany = await loadActiveContractPricingForMonth(
    ctx,
    [companyId],
    month,
  );
  const reviewResult = buildDailyUsageReviewResult({
    month,
    rows,
    visibleCompanyById,
    catalogById,
    contractPricingByCompany,
    businessDate,
  });
  const inputDigest = buildDailyUsageBillingInputDigest({
    month,
    businessDate,
    rows,
    companies,
    catalogItems,
    contractPricingByCompany,
  });

  return buildDailyUsageBillingSnapshotCandidate({
    companyId,
    month,
    rows,
    reviewResult,
    inputDigest,
    computedAt,
  });
}

export const rebuildCompanyMonthBillingSnapshot = internalMutation({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const candidate = await buildCompanyMonthBillingSnapshotCandidate(
      ctx,
      args.companyId,
      args.month,
      Date.now(),
    );
    const existing = await ctx.db
      .query("dailyUsageBillingSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .unique();

    if (!shouldWriteDailyUsageBillingSnapshot(existing, candidate)) {
      return { action: "unchanged" as const, snapshotId: existing!._id };
    }
    if (existing) {
      await ctx.db.patch(existing._id, candidate);
      return { action: "updated" as const, snapshotId: existing._id };
    }
    const snapshotId = await ctx.db.insert(
      "dailyUsageBillingSnapshots",
      candidate,
    );
    return { action: "inserted" as const, snapshotId };
  },
});

export const compareCompanyMonthBillingSnapshot = internalQuery({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const computedAt = Date.now();
    const [candidate, existing] = await Promise.all([
      buildCompanyMonthBillingSnapshotCandidate(
        ctx,
        args.companyId,
        args.month,
        computedAt,
      ),
      ctx.db
        .query("dailyUsageBillingSnapshots")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", args.companyId).eq("month", args.month),
        )
        .unique(),
    ]);
    return {
      ...compareDailyUsageBillingSnapshot(existing, candidate),
      companyId: args.companyId,
      month: args.month,
      calculationVersion: candidate.calculationVersion,
      inputDigest: candidate.inputDigest,
      liveBillingResultDigest: candidate.billingResultDigest,
      persistedBillingResultDigest: existing?.billingResultDigest,
      comparedAt: computedAt,
    };
  },
});


export const findCompanyForMonthBillingSnapshotTest = internalQuery({
  args: {
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_month", (q) => q.eq("month", args.month))
      .take(25);

    const seenCompanyIds = new Set<Id<"companies">>();
    for (const row of rows) {
      if (seenCompanyIds.has(row.companyId)) {
        continue;
      }
      seenCompanyIds.add(row.companyId);
      const company = await ctx.db.get(row.companyId);
      if (company) {
        return {
          companyId: company._id,
          companyName: company.name,
          month: args.month,
        };
      }
    }

    return null;
  },
});


export const findCompaniesForMonthBillingSnapshotTest = internalQuery({
  args: {
    month: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 5, 10));
    const rows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_month", (q) => q.eq("month", args.month))
      .take(250);

    const seenCompanyIds = new Set<Id<"companies">>();
    const companies: Array<{
      companyId: Id<"companies">;
      companyName: string;
      month: string;
    }> = [];

    for (const row of rows) {
      if (seenCompanyIds.has(row.companyId)) {
        continue;
      }
      seenCompanyIds.add(row.companyId);
      const company = await ctx.db.get(row.companyId);
      if (!company) {
        continue;
      }
      companies.push({
        companyId: company._id,
        companyName: company.name,
        month: args.month,
      });
      if (companies.length >= limit) {
        break;
      }
    }

    return companies;
  },
});


export const findCompaniesForMonthBillingSnapshotTestPage = internalQuery({
  args: {
    month: v.string(),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? 100, 250));
    const page = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_month", (q) => q.eq("month", args.month))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: batchSize,
      });

    const seenCompanyIds = new Set<Id<"companies">>();
    const companies: Array<{
      companyId: Id<"companies">;
      companyName: string;
      month: string;
    }> = [];

    for (const row of page.page) {
      if (seenCompanyIds.has(row.companyId)) {
        continue;
      }
      seenCompanyIds.add(row.companyId);
      const company = await ctx.db.get(row.companyId);
      if (!company) {
        continue;
      }
      companies.push({
        companyId: company._id,
        companyName: company.name,
        month: args.month,
      });
    }

    return {
      companies,
      cursor: page.continueCursor,
      isDone: page.isDone,
      rowsRead: page.page.length,
    };
  },
});

function sourceKeyFor(input: {
  companyId: Id<"companies">;
  tenantId: Id<"manageOneTenants">;
  usageDate: string;
  serviceType: string;
  itemName: string;
  catalogItemId?: Id<"serviceCatalog">;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return [
    "manageone",
    input.usageDate,
    input.companyId,
    input.tenantId,
    stableSegment(input.serviceType),
    input.catalogItemId ?? stableSegment(input.itemName),
    stableSegment(input.regionId ?? input.regionName ?? input.dataCenterName),
  ].join("|");
}

export function buildDailyUsageRowsFromManageOneTenants(
  tenants: ManageOneTenant[],
  catalog: CatalogItem[],
  usageDate: string,
  capturedAt: number,
): DailyUsageSnapshotInput[] {
  const month = usageDate.slice(0, 7);
  const rows: DailyUsageSnapshotInput[] = [];

  for (const tenant of tenants) {
    if (!tenant.linkedCompanyId) {
      continue;
    }

    const hints = buildUsageHintsForCompany([tenant], catalog);
    for (const hint of hints) {
      const lineItems =
        hint.lineItems ??
        (hint.suggestedCatalogItemId
          ? [
              {
                label: hint.serviceCategory,
                serviceCategory: hint.serviceCategory,
                quantity: hint.quantity,
                pricing: hint.pricing,
                suggestedCatalogItemId: hint.suggestedCatalogItemId,
                ...optionalRegionFields(hint),
              },
            ]
          : []);

      for (const lineItem of lineItems) {
        if (lineItem.quantity <= 0) {
          continue;
        }

        const serviceCategory =
          lineItem.serviceCategory ?? hint.serviceCategory;
        const catalogItem = lineItem.suggestedCatalogItemId
          ? catalog.find((item) => item._id === lineItem.suggestedCatalogItemId)
          : undefined;
        const itemName = catalogItem?.itemName ?? lineItem.label;
        const regionFields = optionalRegionFields({
          ...optionalRegionFields(hint),
          ...optionalRegionFields(lineItem),
        });

        rows.push({
          companyId: tenant.linkedCompanyId,
          tenantId: tenant._id,
          tenantName: tenant.name,
          tenantVdcId: tenant.vdcId,
          ...(tenant.domainId ? { tenantDomainId: tenant.domainId } : {}),
          usageDate,
          month,
          serviceType: serviceCategory,
          itemName,
          serviceCategory,
          quantity: lineItem.quantity,
          unit:
            catalogItem?.billingUnit ?? defaultUnitForService(serviceCategory),
          ...(catalogItem ? { catalogItemId: catalogItem._id } : {}),
          source: "manageone",
          sourceKey: sourceKeyFor({
            companyId: tenant.linkedCompanyId,
            tenantId: tenant._id,
            usageDate,
            serviceType: serviceCategory,
            itemName,
            catalogItemId: catalogItem?._id,
            ...regionFields,
          }),
          sourceSyncedAt: tenant.lastSyncedAt,
          capturedAt,
          ...regionFields,
        });
      }
    }
  }

  return rows;
}

export const captureFromManageOneSnapshots = internalMutation({
  args: {
    usageDate: v.optional(v.string()),
    capturedAt: v.optional(v.number()),
    tenantVdcIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const capturedAt = args.capturedAt ?? Date.now();
    const usageDate = args.usageDate ?? dateKeyForTimestamp(capturedAt);
    assertValidDateKey(usageDate);

    const tenants = await ctx.db.query("manageOneTenants").collect();
    const tenantVdcIdFilter =
      args.tenantVdcIds && args.tenantVdcIds.length > 0
        ? new Set(args.tenantVdcIds)
        : null;
    const selectedTenants = tenantVdcIdFilter
      ? tenants.filter((tenant) => tenantVdcIdFilter.has(tenant.vdcId))
      : tenants;
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const rows = buildDailyUsageRowsFromManageOneTenants(
      selectedTenants,
      catalog,
      usageDate,
      capturedAt,
    );

    let inserted = 0;
    let updated = 0;
    let skippedLocked = 0;

    for (const row of rows) {
      const existing = await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_source_key", (q) => q.eq("sourceKey", row.sourceKey))
        .unique();

      if (existing?.lockedAt || existing?.invoiceId) {
        skippedLocked++;
        continue;
      }

      if (existing) {
        await ctx.db.patch(existing._id, row);
        updated++;
      } else {
        await ctx.db.insert("dailyUsageSnapshots", row);
        inserted++;
      }
    }

    return {
      usageDate,
      inspectedTenants: selectedTenants.length,
      capturedRows: rows.length,
      inserted,
      updated,
      skippedLocked,
    };
  },
});

export const listByCompanyMonth = query({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, user, args.companyId);

    return await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
  },
});

export const listPage = query({
  args: {
    month: v.string(),
    companyId: v.optional(v.id("companies")),
    usageDate: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const companies = args.companyId
      ? [await assertCanManageUsage(ctx, user, args.companyId)]
      : (await ctx.db.query("companies").collect()).filter((company) =>
          canViewCompany(user, company),
        );
    const visibleCompanyIds = new Set(companies.map((company) => company._id));
    const companyNameById = new Map(
      companies.map((company) => [company._id, company.name]),
    );
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(args.paginationOpts.numItems, 100),
    };
    const query = args.companyId
      ? ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_company_month_date", (q) => {
            const scoped = q
              .eq("companyId", args.companyId!)
              .eq("month", args.month);
            return args.usageDate
              ? scoped.eq("usageDate", args.usageDate)
              : scoped;
          })
      : args.usageDate
        ? ctx.db
            .query("dailyUsageSnapshots")
            .withIndex("by_month_date", (q) =>
              q.eq("month", args.month).eq("usageDate", args.usageDate!),
            )
        : ctx.db
            .query("dailyUsageSnapshots")
            .withIndex("by_month", (q) => q.eq("month", args.month));
    const page = await query.order("desc").paginate(paginationOpts);
    const rows = page.page
      .filter(
        (row) =>
          row.month === args.month &&
          visibleCompanyIds.has(row.companyId) &&
          (!args.serviceType || row.serviceType === args.serviceType),
      )
      .map((row) => ({
        ...row,
        companyName: companyNameById.get(row.companyId) ?? "Unknown",
      }));
    return { ...page, page: rows, pageSize: rows.length };
  },
});

export const status = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    const now = Date.now();
    const businessDate = dateKeyForTimestamp(now);
    const latestDailyRow = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_month_date", (q) => q.eq("month", args.month))
      .order("desc")
      .first();
    const latestHourlyRow = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_hour")
      .order("desc")
      .first();
    const latestHourlyCapturedAt = latestHourlyRow?.capturedAt ?? null;
    return {
      month: args.month,
      businessDate,
      latestDailyUsageDate: latestDailyRow?.usageDate ?? null,
      capturedThroughToday: latestDailyRow?.usageDate === businessDate,
      latestHourlyCapturedAt,
      hourlyStale:
        latestHourlyCapturedAt === null ||
        now - latestHourlyCapturedAt > HOURLY_STALE_MS,
    };
  },
});

export const createDraftInvoiceFromRollup = mutation({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await assertCanManageUsage(ctx, user, args.companyId);
    const sourceReference = dailyUsageSourceReference(args.month);

    const existingInvoice = (
      await ctx.db
        .query("invoices")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .collect()
    ).find(
      (invoice) =>
        invoice.sourceMonth === args.month &&
        invoice.sourceReference === sourceReference &&
        invoice.status !== "cancelled" &&
        invoice.status !== "void",
    );
    if (existingInvoice) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `A daily usage invoice already exists for ${company.name} and ${args.month}`,
      });
    }

    const rows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
    if (rows.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "No daily usage rows found for this customer and month",
      });
    }
    const attachedRows = rows.filter((row) => row.invoiceId || row.lockedAt);
    if (attachedRows.length > 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Some daily usage rows are already attached to an invoice for this month",
      });
    }

    const catalogById = new Map(
      (await ctx.db.query("serviceCatalog").collect()).map((item) => [
        item._id,
        item,
      ]),
    );
    const companyNameById = new Map<Id<"companies">, string>([
      [company._id, company.name],
    ]);
    const contractPricingByCompany = await loadActiveContractPricingForMonth(
      ctx,
      [company._id],
      args.month,
    );
    const activeContract = contractPricingByCompany.get(company._id)?.contract;
    if (activeContract?.commitmentModel === "flexible_value" || activeContract?.pricingModel) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Dynamic-pricing contracts must be invoiced from the contract schedule so discounts and commitments are calculated once",
      });
    }
    const rollupRows = buildMonthlyRollupRows({
      rows,
      catalogById,
      companyNameById,
      month: args.month,
      contractPricingByCompany,
    });
    const unpriced = rollupRows.filter(
      (row) =>
        row.monthlyUnitPrice === undefined || row.estimatedAmount === undefined,
    );
    if (unpriced.length > 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "All daily usage rollup rows must have catalog pricing before creating an invoice",
      });
    }

    let lineItems = rollupRows.flatMap((row) => {
      const monthlyTotal = roundMoney(row.estimatedAmount ?? 0);
      const common = {
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        serviceCategory: row.serviceType,
        billingUnit: row.unit,
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
      };
      if (row.pricingSource !== "contract") {
        return [
          {
            ...common,
            itemName: row.itemName,
            quantity: roundQuantity(row.billableQuantity),
            monthlyUnitPrice: row.monthlyUnitPrice ?? 0,
            monthlyTotal,
            yearlyTotal: roundMoney(monthlyTotal * 12),
          },
        ];
      }

      const lines = [
        {
          ...common,
          itemName: `${row.itemName} base`,
          quantity:
            (row.contractGrossMonthlyPrice ?? 0) > 0
              ? roundQuantity(
                  (row.contractGrossBaseAmount ?? 0) /
                    (row.contractGrossMonthlyPrice ?? 1),
                )
              : 0,
          monthlyUnitPrice: row.contractGrossMonthlyPrice ?? 0,
          monthlyTotal: row.contractGrossBaseAmount ?? 0,
          yearlyTotal: roundMoney((row.contractGrossBaseAmount ?? 0) * 12),
        },
      ];
      if ((row.contractDiscountAmount ?? 0) > 0) {
        lines.push({
          ...common,
          itemName: `${row.itemName} contract discount`,
          quantity: 1,
          monthlyUnitPrice: -(row.contractDiscountAmount ?? 0),
          monthlyTotal: -(row.contractDiscountAmount ?? 0),
          yearlyTotal: -roundMoney((row.contractDiscountAmount ?? 0) * 12),
        });
      }
      if ((row.overageQuantity ?? 0) > 0) {
        const overageTotal = roundMoney(
          (row.overageQuantity ?? 0) * (row.overageUnitPrice ?? 0),
        );
        lines.push({
          ...common,
          itemName: `${row.itemName} overage`,
          quantity: roundQuantity(row.overageQuantity ?? 0),
          monthlyUnitPrice: row.overageUnitPrice ?? 0,
          monthlyTotal: overageTotal,
          yearlyTotal: roundMoney(overageTotal * 12),
        });
      }
      return lines;
    });
    const grossTotals = calculateInvoiceTotals(lineItems);
    const applicableCredit = await findApplicableCredit(
      ctx,
      company._id,
      rollupRows.some((row) => row.pricingSource === "contract"),
      grossTotals.grandTotal,
    );
    if (applicableCredit) {
      lineItems = [
        ...lineItems,
        {
          itemName: "Onboarding credit",
          serviceCategory: "Credit",
          billingUnit: "one-time credit",
          quantity: 1,
          monthlyUnitPrice: -applicableCredit.amount,
          monthlyTotal: -applicableCredit.amount,
          yearlyTotal: -applicableCredit.amount,
        },
      ];
    }
    const totals = calculateInvoiceTotals(lineItems);
    const grandTotal = totals.grandTotal;
    const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
    assertSupportedCurrency(invoiceProfile?.currency);
    const sellerSnapshot = invoiceProfile
      ? sellerSnapshotFromProfile(invoiceProfile)
      : {};
    const now = Date.now();
    const dueDate =
      company.paymentTermDays === undefined
        ? undefined
        : monthEndTimestamp(args.month) + company.paymentTermDays * MS_PER_DAY;

    const invoiceId = await ctx.db.insert("invoices", {
      companyId: company._id,
      sourceMonth: args.month,
      sourceReference,
      invoiceProfileId: invoiceProfile?._id,
      ...sellerSnapshot,
      createdBy: user._id,
      status: "draft",
      dueDate,
      companyName: company.name,
      contactName: company.contactName,
      contactEmail: company.contactEmail,
      billingEmail: company.contactEmail,
      lineItems: lineItems.map(withLineMoneyCents),
      ...withInvoiceMoneyCents(totals),
      grossBeforeCredit: grossTotals.grandTotal,
      onboardingCreditId: applicableCredit?.credit._id,
      onboardingCreditApplied: applicableCredit?.amount,
      notes: `Draft invoice from daily usage snapshots for ${args.month}. Review before issuing.`,
      createdAt: now,
      updatedAt: now,
    });

    if (applicableCredit) {
      await reserveCredit(
        ctx,
        applicableCredit.credit,
        invoiceId,
        applicableCredit.amount,
        user._id,
      );
    }

    for (const row of rows) {
      await ctx.db.patch(row._id, { invoiceId });
    }

    await ctx.db.insert("invoiceEvents", {
      invoiceId,
      type: "draft_created",
      actorId: user._id,
      message: `Draft invoice created from daily usage ${args.month}.`,
      createdAt: now,
    });

    return { invoiceId, companyName: company.name, grandTotal };
  },
});

export const review = query({
  args: {
    month: v.string(),
    companyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);

    const rows = args.companyId
      ? await ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_company_month", (q) =>
            q.eq("companyId", args.companyId!).eq("month", args.month),
          )
          .collect()
      : await ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_month", (q) => q.eq("month", args.month))
          .collect();

    const visibleCompanyById = new Map<Id<"companies">, Doc<"companies">>();
    if (args.companyId) {
      const company = await assertCanManageUsage(ctx, user, args.companyId);
      visibleCompanyById.set(company._id, company);
    } else {
      const accessibleCompanies = (await ctx.db.query("companies").collect())
        .filter((company) => canViewCompany(user, company));
      for (const company of accessibleCompanies) {
        visibleCompanyById.set(company._id, company);
      }
    }

    const catalogById = new Map(
      (await ctx.db.query("serviceCatalog").collect()).map((item) => [
        item._id,
        item,
      ]),
    );
    const contractPricingByCompany = await loadActiveContractPricingForMonth(
      ctx,
      [...visibleCompanyById.keys()],
      args.month,
    );
    return buildDailyUsageReviewResult({
      month: args.month,
      rows,
      catalogById,
      visibleCompanyById,
      contractPricingByCompany,
      businessDate: dateKeyForTimestamp(Date.now()),
    });
  },
});

function latestSnapshotsByTenantRegion(
  rows: Doc<"manageOneHourlySnapshots">[],
) {
  const latest = new Map<string, Doc<"manageOneHourlySnapshots">>();

  for (const row of rows) {
    const key = [
      row.vdcId,
      row.regionId ?? row.regionName ?? "unknown-region",
    ].join("|");
    const existing = latest.get(key);
    if (!existing || row.capturedAt > existing.capturedAt) {
      latest.set(key, row);
    }
  }

  return [...latest.values()];
}

function sumHourly(rows: Doc<"manageOneHourlySnapshots">[]) {
  return rows.reduce(
    (totals, row) => ({
      ecs: totals.ecs + row.ecsInstances,
      cce: totals.cce + (row.cceNodes ?? 0),
      bms: totals.bms + (row.bmsInstances ?? 0),
      vcpu: totals.vcpu + row.ecsCores,
      ramGb: totals.ramGb + row.ecsRamGb,
      evsGb: totals.evsGb + row.evsGb,
      sfsGb: totals.sfsGb + (row.sfsGb ?? 0),
      csbsGb: totals.csbsGb + (row.csbsGb ?? 0),
      vbsGb: totals.vbsGb + (row.vbsGb ?? 0),
      obsGb: totals.obsGb + row.obsGb,
      eip: totals.eip + row.publicIps,
      elb: totals.elb + row.loadBalancers,
      vpn: totals.vpn + row.vpnGateways,
      vpcep: totals.vpcep + (row.vpcepEndpoints ?? 0),
      nat: totals.nat + row.natGateways,
      waf: totals.waf + row.wafInstances,
    }),
    {
      ecs: 0,
      cce: 0,
      bms: 0,
      vcpu: 0,
      ramGb: 0,
      evsGb: 0,
      sfsGb: 0,
      csbsGb: 0,
      vbsGb: 0,
      obsGb: 0,
      eip: 0,
      elb: 0,
      vpn: 0,
      vpcep: 0,
      nat: 0,
      waf: 0,
    },
  );
}

function countRowsByService(rows: Doc<"dailyUsageSnapshots">[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.serviceType, (counts.get(row.serviceType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([serviceType, rowCount]) => ({ serviceType, rowCount }))
    .sort((a, b) => a.serviceType.localeCompare(b.serviceType));
}

export function buildDailyUsageBillingHealth(
  rows: Doc<"dailyUsageSnapshots">[],
  businessDate: string,
) {
  const latestUsageDate = rows.reduce<string | null>(
    (latest, row) =>
      latest === null || row.usageDate > latest ? row.usageDate : latest,
    null,
  );
  const latestDayRows = latestUsageDate
    ? rows.filter((row) => row.usageDate === latestUsageDate)
    : [];
  const missingCatalogRows = rows.filter((row) => !row.catalogItemId);
  const attachedRows = rows.filter((row) => row.invoiceId || row.lockedAt);

  return {
    latestUsageDate,
    capturedThroughToday: latestUsageDate === businessDate,
    rowCount: rows.length,
    latestDayRowCount: latestDayRows.length,
    serviceRows: countRowsByService(latestDayRows),
    attachedRowCount: attachedRows.length,
    missingPriceRowCount: missingCatalogRows.length,
    missingServices: [
      ...new Set(missingCatalogRows.map((row) => row.serviceType)),
    ].sort((a, b) => a.localeCompare(b)),
  };
}

function averageMonthlyCatalogPrice(
  catalog: CatalogItem[],
  serviceHints: string[],
) {
  const normalizedHints = serviceHints.map((hint) => hint.toLowerCase());
  const matches = catalog.filter((item) => {
    const haystack = [
      item.serviceCategory,
      item.itemName,
      item.serviceCode,
      item.productGroup,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return normalizedHints.some((hint) => haystack.includes(hint));
  });
  if (matches.length === 0) return 0;
  return (
    matches.reduce((total, item) => total + item.monthlyPrice, 0) /
    matches.length
  );
}

function estimateHourlySnapshotCost(
  rows: Doc<"manageOneHourlySnapshots">[],
  catalog: CatalogItem[],
) {
  const monthlyCost = rows.reduce((total, row) => {
    const ecsPrice = averageMonthlyCatalogPrice(catalog, ["ecs", "compute"]);
    const evsPrice = averageMonthlyCatalogPrice(catalog, ["evs", "storage"]);
    const obsPrice = averageMonthlyCatalogPrice(catalog, ["obs"]);
    const sfsPrice = averageMonthlyCatalogPrice(catalog, ["sfs"]);
    const eipPrice = averageMonthlyCatalogPrice(catalog, ["eip", "public ip"]);
    const elbPrice = averageMonthlyCatalogPrice(catalog, ["elb", "load balancer"]);
    const vpnPrice = averageMonthlyCatalogPrice(catalog, ["vpn"]);
    const natPrice = averageMonthlyCatalogPrice(catalog, ["nat"]);
    const wafPrice = averageMonthlyCatalogPrice(catalog, ["waf"]);

    return (
      total +
      row.ecsInstances * ecsPrice +
      row.evsGb * evsPrice +
      row.obsGb * obsPrice +
      (row.sfsGb ?? 0) * sfsPrice +
      row.publicIps * eipPrice +
      row.loadBalancers * elbPrice +
      row.vpnGateways * vpnPrice +
      row.natGateways * natPrice +
      row.wafInstances * wafPrice
    );
  }, 0);

  return roundMoney(monthlyCost / (30 * 24));
}

export const companyBillingSnapshot = query({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await assertCanManageUsage(ctx, user, args.companyId);
    const { start: monthStart, end: monthEnd } = monthBounds(args.month);

    const invoices = (
      await ctx.db
        .query("invoices")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .collect()
    ).filter((invoice) => !(invoice.isTest || invoice.hiddenAt));
    const openInvoices = invoices.filter((invoice) =>
      ["issued", "sent", "partially_paid", "overdue"].includes(invoice.status),
    );

    const contracts = await ctx.db
      .query("customerContracts")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
    const contractById = new Map(contracts.map((contract) => [contract._id, contract]));
    const contractByNumber = new Map(
      contracts.map((contract) => [contract.contractNumber, contract]),
    );
    const resolveInvoiceContract = (invoice: Doc<"invoices">) => {
      if (invoice.sourceContractId) {
        const contract = contractById.get(invoice.sourceContractId);
        if (contract) return contract;
      }
      if (invoice.sourceReference) {
        return contractByNumber.get(invoice.sourceReference) ?? null;
      }
      return null;
    };
    const invoiceSourceDetails = (invoice: Doc<"invoices">) => {
      const contract = resolveInvoiceContract(invoice);
      return {
        sourceType: invoice.sourceType,
        sourceMonth: invoice.sourceMonth,
        sourceReference: invoice.sourceReference,
        sourceContractId: contract?._id ?? invoice.sourceContractId,
        contractNumber: contract?.contractNumber,
        contractTitle: contract?.title,
        contractPeriodStartMonth: invoice.contractPeriodStartMonth,
        contractPeriodEndMonth: invoice.contractPeriodEndMonth,
      };
    };

    let paidThisMonth = 0;
    const recentPayments = [];
    for (const invoice of invoices) {
      const sourceDetails = invoiceSourceDetails(invoice);
      const payments = await ctx.db
        .query("invoicePayments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
        .collect();
      for (const payment of payments) {
        if (payment.paidAt >= monthStart && payment.paidAt <= monthEnd) {
          paidThisMonth = roundMoney(paidThisMonth + payment.amount);
          recentPayments.push({
            _id: payment._id,
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            amount: payment.amount,
            paidAt: payment.paidAt,
            method: payment.method,
            reference: payment.reference,
            ...sourceDetails,
          });
        }
      }
    }

    const dailyRows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
    const billingHealth = buildDailyUsageBillingHealth(
      dailyRows,
      dateKeyForTimestamp(Date.now()),
    );
    const uninvoicedRows = dailyRows.filter(
      (row) => !row.invoiceId && !row.lockedAt,
    );

    const catalog = await ctx.db.query("serviceCatalog").collect();
    const catalogById = new Map(catalog.map((item) => [item._id, item]));
    const companyNameById = new Map<Id<"companies">, string>([
      [company._id, company.name],
    ]);
    const contractPricingByCompany = await loadActiveContractPricingForMonth(
      ctx,
      [company._id],
      args.month,
    );
    const upcomingRollupRows = buildMonthlyRollupRows({
      rows: uninvoicedRows,
      catalogById,
      companyNameById,
      month: args.month,
      contractPricingByCompany,
    });
    const upcomingCharges = sumMoney(
      upcomingRollupRows.map((row) => row.estimatedAmount ?? 0),
    );
    const activeContractId = contractPricingByCompany.get(company._id)?.contract._id;
    const currentBalanceForActiveContract =
      activeContractId === undefined
        ? 0
        : sumMoney(
            openInvoices.map((invoice) => {
              const contract = resolveInvoiceContract(invoice);
              return contract?._id === activeContractId
                ? invoice.balanceDue
                : 0;
            }),
          );
    const paidThisMonthForActiveContract =
      activeContractId === undefined
        ? 0
        : sumMoney(
            recentPayments.map((payment) =>
              payment.sourceContractId === activeContractId
                ? payment.amount
                : 0,
            ),
          );

    const usageDates = [...new Set(dailyRows.map((row) => row.usageDate))]
      .filter(Boolean)
      .sort();
    let cumulative = 0;
    const dailySeries = usageDates.map((usageDate) => {
      const rowsForDay = dailyRows.filter((row) => row.usageDate === usageDate);
      const dayRollup = buildMonthlyRollupRows({
        rows: rowsForDay,
        catalogById,
        companyNameById,
        month: args.month,
        contractPricingByCompany,
      });
      const dailyCharge = sumMoney(
        dayRollup.map((row) => row.estimatedAmount ?? 0),
      );
      cumulative = roundMoney(cumulative + dailyCharge);
      return {
        usageDate,
        dailyCharge,
        cumulativeCharge: cumulative,
      };
    });
    const projectedMonthEnd =
      dailySeries.length === 0
        ? null
        : roundMoney((cumulative / dailySeries.length) * daysInMonth(args.month));

    const hourlyRows = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_company_hour", (q) =>
        q.eq("linkedCompanyId", args.companyId).gte("capturedHour", monthStart),
      )
      .collect();
    const hourlyRowsByHour = new Map<number, Doc<"manageOneHourlySnapshots">[]>();
    for (const row of hourlyRows.filter((row) => row.capturedHour <= monthEnd)) {
      const rowsForHour = hourlyRowsByHour.get(row.capturedHour) ?? [];
      rowsForHour.push(row);
      hourlyRowsByHour.set(row.capturedHour, rowsForHour);
    }
    const hourlySeries = [...hourlyRowsByHour.entries()]
      .sort(([left], [right]) => left - right)
      .slice(-24)
      .map(([capturedHour, rows]) => ({
        capturedHour,
        estimatedHourlyCost: estimateHourlySnapshotCost(rows, catalog),
      }));

    const chargeBreakdownByService = new Map<
      string,
      {
        serviceType: string;
        amount: number;
        billableQuantity: number;
        capturedDays: number;
        unpricedCount: number;
      }
    >();
    for (const row of upcomingRollupRows) {
      const existing = chargeBreakdownByService.get(row.serviceType) ?? {
        serviceType: row.serviceType,
        amount: 0,
        billableQuantity: 0,
        capturedDays: 0,
        unpricedCount: 0,
      };
      existing.amount = roundMoney(existing.amount + (row.estimatedAmount ?? 0));
      existing.billableQuantity = roundQuantity(
        existing.billableQuantity + row.billableQuantity,
      );
      existing.capturedDays = Math.max(existing.capturedDays, row.capturedDays);
      existing.unpricedCount += row.estimatedAmount === undefined ? 1 : 0;
      chargeBreakdownByService.set(row.serviceType, existing);
    }

    return {
      month: args.month,
      companyId: args.companyId,
      companyName: company.name,
      currentBalance: sumMoney(
        openInvoices.map((invoice) => invoice.balanceDue),
      ),
      currentBalanceForActiveContract,
      upcomingCharges,
      paidThisMonth,
      paidThisMonthForActiveContract,
      projectedMonthEnd,
      contractCoverage: null,
      dailyUsageReady: dailyRows.length > 0,
      latestUsageDate: usageDates[usageDates.length - 1] ?? null,
      billingHealth,
      dailySeries,
      hourlySeries,
      chargeBreakdown: [...chargeBreakdownByService.values()].sort(
        (a, b) => b.amount - a.amount,
      ),
      openInvoices: openInvoices
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map((invoice) => ({
          _id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          grandTotal: invoice.grandTotal,
          amountPaid: invoice.amountPaid,
          balanceDue: invoice.balanceDue,
          ...invoiceSourceDetails(invoice),
        })),
      recentPayments: recentPayments
        .sort((a, b) => b.paidAt - a.paidAt)
        .slice(0, 5),
      unpricedCount: upcomingRollupRows.filter(
        (row) => row.estimatedAmount === undefined,
      ).length,
      uninvoicedRowCount: uninvoicedRows.length,
      dailyRowCount: dailyRows.length,
    };
  },
});

export const health = query({
  args: {
    month: v.string(),
    companyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const now = Date.now();
    const businessDate = dateKeyForTimestamp(now);

    const companies = args.companyId
      ? [await assertCanManageUsage(ctx, user, args.companyId)]
      : (await ctx.db.query("companies").collect()).filter((company) =>
          canViewCompany(user, company),
        );
    const visibleCompanyIds = new Set(companies.map((company) => company._id));

    const tenantRows = await ctx.db.query("manageOneTenants").collect();
    const visibleTenantRows = tenantRows.filter(
      (tenant) =>
        tenant.linkedCompanyId && visibleCompanyIds.has(tenant.linkedCompanyId),
    );
    const unlinkedTenantCount = args.companyId
      ? 0
      : tenantRows.filter((tenant) => !tenant.linkedCompanyId).length;

    const hourlyRows = args.companyId
      ? await ctx.db
          .query("manageOneHourlySnapshots")
          .withIndex("by_company_hour", (q) =>
            q.eq("linkedCompanyId", args.companyId),
          )
          .order("desc")
          .take(500)
      : await ctx.db
          .query("manageOneHourlySnapshots")
          .withIndex("by_hour")
          .order("desc")
          .take(500);
    const visibleHourlyRows = args.companyId
      ? hourlyRows
      : hourlyRows.filter(
          (row) =>
            row.linkedCompanyId && visibleCompanyIds.has(row.linkedCompanyId),
        );
    const latestHourlyRows = latestSnapshotsByTenantRegion(visibleHourlyRows);
    const latestHourlyCapturedAt =
      latestHourlyRows.reduce(
        (latest, row) => Math.max(latest, row.capturedAt),
        0,
      ) || null;
    const staleHourly =
      latestHourlyCapturedAt === null ||
      now - latestHourlyCapturedAt > HOURLY_STALE_MS;

    return {
      month: args.month,
      scope: args.companyId ? "company" : "all",
      businessDate,
      companyCount: companies.length,
      linkedTenantCount: visibleTenantRows.length,
      unlinkedTenantCount,
      latestHourly: {
        capturedAt: latestHourlyCapturedAt,
        tenantCount: latestHourlyRows.length,
        stale: staleHourly,
        totals: sumHourly(latestHourlyRows),
      },
    };
  },
});
