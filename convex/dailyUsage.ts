import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
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
    context.set(companyId, {
      contract,
      lines: lines.sort((a, b) => a.createdAt - b.createdAt),
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

    const visibleRows = [];
    const companyNameById = new Map<Id<"companies">, string>();

    for (const row of rows) {
      const company = args.companyId
        ? await assertCanManageUsage(ctx, user, row.companyId)
        : await ctx.db.get(row.companyId);
      if (!company || !canViewCompany(user, company)) {
        continue;
      }
      visibleRows.push(row);
      companyNameById.set(row.companyId, company.name);
    }

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

    const catalogById = new Map(
      (await ctx.db.query("serviceCatalog").collect()).map((item) => [
        item._id,
        item,
      ]),
    );
    const contractPricingByCompany = await loadActiveContractPricingForMonth(
      ctx,
      [...companyNameById.keys()],
      args.month,
    );
    const monthDayCount = daysInMonth(args.month);
    const rollupRows = buildMonthlyRollupRows({
      rows: visibleRows,
      catalogById,
      companyNameById,
      month: args.month,
      contractPricingByCompany,
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
    };
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

    const dailyRows = args.companyId
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
    const visibleDailyRows = dailyRows.filter((row) =>
      visibleCompanyIds.has(row.companyId),
    );

    const latestDailyUsageDate =
      visibleDailyRows
        .map((row) => row.usageDate)
        .sort((a, b) => b.localeCompare(a))[0] ?? null;
    const latestDailyRows = latestDailyUsageDate
      ? visibleDailyRows.filter((row) => row.usageDate === latestDailyUsageDate)
      : [];
    const missingCatalogRows = visibleDailyRows.filter(
      (row) => !row.catalogItemId,
    );
    const attachedRows = visibleDailyRows.filter(
      (row) => row.invoiceId || row.lockedAt,
    );

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
      dailyBilling: {
        latestUsageDate: latestDailyUsageDate,
        capturedThroughToday: latestDailyUsageDate === businessDate,
        rowCount: visibleDailyRows.length,
        latestDayRowCount: latestDailyRows.length,
        serviceRows: countRowsByService(latestDailyRows),
        attachedRowCount: attachedRows.length,
      },
      catalog: {
        missingPriceRowCount: missingCatalogRows.length,
        missingServices: [
          ...new Set(missingCatalogRows.map((row) => row.serviceType)),
        ].sort((a, b) => a.localeCompare(b)),
      },
    };
  },
});
