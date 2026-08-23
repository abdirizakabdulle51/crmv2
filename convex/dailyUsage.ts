import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertCanManageUsage,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";
import {
  buildUsageHintsForCompany,
  tenantsWithLatestHourlyUsage,
} from "./manageOneTenants";
import { buildContractUsageBilling } from "./contractBilling";

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
const BILLABLE_DAILY_USAGE_REGIONS = new Set([
  "Mogadishu-region-hq3",
  "Hoa-Mogadishu-2",
]);

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isBillableDailyUsageRegion(
  row: Pick<Doc<"dailyUsageSnapshots">, "regionName" | "dataCenterName">,
) {
  const region = (row.regionName ?? row.dataCenterName)?.trim();
  return region ? BILLABLE_DAILY_USAGE_REGIONS.has(region) : false;
}

function billableDailyUsageRows(rows: Doc<"dailyUsageSnapshots">[]) {
  return rows.filter(isBillableDailyUsageRegion);
}

function averageHourlyPrice(items: CatalogItem[]) {
  const prices = items
    .map((item) => item.hourlyPrice)
    .filter((price): price is number => price !== undefined);
  if (prices.length === 0) return 0;
  return prices.reduce((total, price) => total + price, 0) / prices.length;
}

function hourlyPriceForCategory(
  catalog: CatalogItem[],
  category: string,
  preferredItemName?: string,
) {
  const categoryItems = catalog.filter((item) => item.serviceCategory === category);
  if (preferredItemName) {
    const preferred = categoryItems.find(
      (item) => normalizedKey(item.itemName) === normalizedKey(preferredItemName),
    );
    if (preferred?.hourlyPrice !== undefined) return preferred.hourlyPrice;
  }
  return averageHourlyPrice(categoryItems);
}

function estimateHourlySnapshotCost(
  rows: Doc<"manageOneHourlySnapshots">[],
  catalog: CatalogItem[],
) {
  const totals = rows.reduce(
    (sum, row) => ({
      ecs: sum.ecs + row.ecsInstances,
      cce: sum.cce + (row.cceNodes ?? 0),
      bms: sum.bms + (row.bmsInstances ?? 0),
      evsGb: sum.evsGb + row.evsGb,
      sfsGb: sum.sfsGb + (row.sfsGb ?? 0),
      csbsGb: sum.csbsGb + (row.csbsGb ?? 0),
      vbsGb: sum.vbsGb + (row.vbsGb ?? 0),
      obsGb: sum.obsGb + row.obsGb,
      eip: sum.eip + row.publicIps,
      elb: sum.elb + row.loadBalancers,
      vpn: sum.vpn + row.vpnGateways,
      vpcep: sum.vpcep + (row.vpcepEndpoints ?? 0),
      nat: sum.nat + row.natGateways,
      waf: sum.waf + row.wafInstances,
      wafBasic: sum.wafBasic + (row.wafBasicInstances ?? 0),
      wafEnterprise: sum.wafEnterprise + (row.wafEnterpriseInstances ?? 0),
    }),
    {
      ecs: 0,
      cce: 0,
      bms: 0,
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
      wafBasic: 0,
      wafEnterprise: 0,
    },
  );
  const wafWithTierBreakdown = totals.wafBasic > 0 || totals.wafEnterprise > 0;
  const untieredWaf = wafWithTierBreakdown ? 0 : totals.waf;

  return roundMoney(
    totals.ecs * hourlyPriceForCategory(catalog, "ECS") +
      totals.cce * hourlyPriceForCategory(catalog, "ECS-CCE") +
      totals.bms * hourlyPriceForCategory(catalog, "BMS") +
      totals.evsGb * hourlyPriceForCategory(catalog, "EVS") +
      totals.sfsGb * hourlyPriceForCategory(catalog, "SFS") +
      totals.csbsGb * hourlyPriceForCategory(catalog, "CSBS") +
      totals.vbsGb * hourlyPriceForCategory(catalog, "VBS") +
      totals.obsGb * hourlyPriceForCategory(catalog, "OBS") +
      totals.eip * hourlyPriceForCategory(catalog, "EIP", "EIP - Active") +
      totals.elb * hourlyPriceForCategory(catalog, "ELB", "ELB - Shared") +
      totals.vpn * hourlyPriceForCategory(catalog, "VPN") +
      totals.vpcep * hourlyPriceForCategory(catalog, "VPCEP") +
      totals.nat * hourlyPriceForCategory(catalog, "NAT") +
      untieredWaf * hourlyPriceForCategory(catalog, "WAF") +
      totals.wafBasic * hourlyPriceForCategory(catalog, "WAF", "Basic WAF") +
      totals.wafEnterprise *
        hourlyPriceForCategory(catalog, "WAF", "Enterprise WAF"),
  );
}

function monthBounds(month: string) {
  return {
    start: monthStartTimestamp(month),
    end: monthEndTimestamp(month),
  };
}

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

function normalizedKey(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function discountAmount(line: ContractLineItem, gross: number) {
  if (!line.discountType || line.discountValue === undefined) return 0;
  if (line.discountType === "percentage") {
    return Math.min(gross, gross * (line.discountValue / 100));
  }
  return Math.min(gross, line.discountValue);
}

function contractLineBaseAmount(line: ContractLineItem) {
  const gross = line.includedQuantity * line.contractUnitPrice;
  return Math.max(0, roundMoney(gross - discountAmount(line, gross)));
}

function contractLineMatchesUsage(
  row: Pick<RollupRow, "catalogItemId" | "itemName" | "serviceType" | "unit">,
  line: ContractLineItem,
) {
  if (line.catalogItemId && row.catalogItemId === line.catalogItemId) {
    return true;
  }

  const itemMatches =
    normalizedKey(row.itemName) === normalizedKey(line.itemName);
  const categoryMatches =
    normalizedKey(row.serviceType) === normalizedKey(line.serviceCategory);
  const unitMatches =
    normalizedKey(row.unit) === normalizedKey(line.unit) ||
    normalizedKey(row.unit) === normalizedKey(line.billingUnit);

  return itemMatches && categoryMatches && unitMatches;
}

type ContractPricingContext = Map<
  Id<"companies">,
  {
    contract: Doc<"customerContracts">;
    lines: ContractLineItem[];
  }
>;

function billingFrequencyMonths(
  frequency: Doc<"customerContracts">["billingFrequency"],
) {
  if (frequency === "quarterly" || frequency === "every_3_months") return 3;
  if (frequency === "yearly") return 12;
  return 1;
}

function findContractLineForRollupRow(
  row: Pick<
    RollupRow,
    "companyId" | "catalogItemId" | "itemName" | "serviceType" | "unit"
  >,
  contractPricingByCompany?: ContractPricingContext,
) {
  const context = contractPricingByCompany?.get(row.companyId);
  if (!context) return null;
  const line = context.lines.find((candidate) =>
    contractLineMatchesUsage(row, candidate),
  );
  if (!line) return null;
  return { contract: context.contract, line };
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
    context.set(companyId, { contract, lines });
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
    rollupByKey.set(groupKey, existing);
  }

  return [...rollupByKey.values()]
    .map((row) => {
      const capturedDayCount = row.capturedDays.size;
      const contractMatch = findContractLineForRollupRow(
        row,
        args.contractPricingByCompany,
      );
      const contractLine = contractMatch?.line;
      const proratedMonthFraction = capturedDayCount / monthDayCount;
      const usageBillableQuantity = row.dailyQuantityTotal / monthDayCount;
      const proratedIncludedQuantity = contractLine
        ? contractLine.includedQuantity * proratedMonthFraction
        : 0;
      const overageQuantity = contractLine
        ? Math.max(0, usageBillableQuantity - proratedIncludedQuantity)
        : 0;

      const contractBaseAmount = contractLine
        ? contractLineBaseAmount(contractLine)
        : undefined;
      const contractEstimatedAmount =
        contractLine && contractBaseAmount !== undefined
          ? roundMoney(
              contractBaseAmount * proratedMonthFraction +
                overageQuantity *
                  (contractLine.overageUnitPrice ??
                    contractLine.contractUnitPrice),
            )
          : undefined;
      const billableQuantity = contractLine
        ? proratedMonthFraction
        : usageBillableQuantity;
      const monthlyUnitPrice = contractLine
        ? contractBaseAmount
        : row.monthlyUnitPrice;
      const estimatedAmount =
        contractEstimatedAmount ??
        (monthlyUnitPrice === undefined
          ? undefined
          : roundMoney(billableQuantity * monthlyUnitPrice));

      return {
        companyId: row.companyId,
        companyName: row.companyName,
        serviceType: row.serviceType,
        itemName: row.itemName,
        unit: contractLine ? "contract/month" : row.unit,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
        capturedDays: capturedDayCount,
        dailyQuantityTotal: row.dailyQuantityTotal,
        billableQuantity,
        monthlyUnitPrice,
        estimatedAmount,
        pricingSource: contractLine ? "contract" : row.pricingSource,
        ...(contractMatch
          ? {
              contractId: contractMatch.contract._id,
              contractNumber: contractMatch.contract.contractNumber,
              contractLineItemId: contractMatch.line._id,
            }
          : {}),
      } satisfies RollupRow;
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
  const rowsBySourceKey = new Map<string, DailyUsageSnapshotInput>();

  for (const tenant of tenants) {
    if (!tenant.linkedCompanyId) {
      continue;
    }

    const hints = buildUsageHintsForCompany([tenant], catalog);
    for (const hint of hints) {
      const lineItems =
        hint.lineItems ??
        (hint.quantity > 0
          ? [
              {
                label: hint.serviceCategory,
                serviceCategory: hint.serviceCategory,
                quantity: hint.quantity,
                pricing: hint.pricing,
                ...(hint.suggestedCatalogItemId
                  ? { suggestedCatalogItemId: hint.suggestedCatalogItemId }
                  : {}),
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

        const row: DailyUsageSnapshotInput = {
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
        };
        const existing = rowsBySourceKey.get(row.sourceKey);
        if (existing) {
          existing.quantity += row.quantity;
          existing.capturedAt = Math.max(existing.capturedAt, row.capturedAt);
          existing.sourceSyncedAt = Math.max(
            existing.sourceSyncedAt ?? 0,
            row.sourceSyncedAt ?? 0,
          );
        } else {
          rowsBySourceKey.set(row.sourceKey, row);
        }
      }
    }
  }

  return [...rowsBySourceKey.values()];
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
    const month = usageDate.slice(0, 7);

    const tenants = await ctx.db.query("manageOneTenants").collect();
    const tenantVdcIdFilter =
      args.tenantVdcIds && args.tenantVdcIds.length > 0
        ? new Set(args.tenantVdcIds)
        : null;
    const selectedTenants = tenantVdcIdFilter
      ? tenants.filter((tenant) => tenantVdcIdFilter.has(tenant.vdcId))
      : tenants;
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const selectedTenantsWithUsage = await tenantsWithLatestHourlyUsage(
      ctx,
      selectedTenants,
      { forBilling: true },
    );
    const rows = buildDailyUsageRowsFromManageOneTenants(
      selectedTenantsWithUsage,
      catalog,
      usageDate,
      capturedAt,
    );
    const currentSourceKeys = new Set(rows.map((row) => row.sourceKey));

    let inserted = 0;
    let updated = 0;
    let skippedLocked = 0;
    let removedStale = 0;

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

    for (const tenant of selectedTenants) {
      if (!tenant.linkedCompanyId) {
        continue;
      }
      const existingRows = await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", tenant.linkedCompanyId as Id<"companies">).eq(
            "month",
            month,
          ),
        )
        .collect();
      for (const existing of existingRows) {
        if (
          existing.source !== "manageone" ||
          existing.usageDate !== usageDate ||
          existing.tenantId !== tenant._id ||
          currentSourceKeys.has(existing.sourceKey)
        ) {
          continue;
        }
        if (existing.lockedAt || existing.invoiceId) {
          skippedLocked++;
          continue;
        }
        await ctx.db.delete(existing._id);
        removedStale++;
      }
    }

    return {
      usageDate,
      inspectedTenants: selectedTenants.length,
      capturedRows: rows.length,
      inserted,
      updated,
      skippedLocked,
      removedStale,
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

    const rows = billableDailyUsageRows(
      await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", args.companyId).eq("month", args.month),
        )
        .collect(),
    );
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

    const lineItems = rollupRows.map((row) => {
      const monthlyTotal = roundMoney(row.estimatedAmount ?? 0);
      return {
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        itemName: row.itemName,
        serviceCategory: row.serviceType,
        billingUnit: row.unit,
        quantity: roundMoney(row.billableQuantity),
        monthlyUnitPrice: row.monthlyUnitPrice ?? 0,
        monthlyTotal,
        yearlyTotal: roundMoney(monthlyTotal * 12),
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
      };
    });
    const grandTotal = roundMoney(
      lineItems.reduce((total, line) => total + line.monthlyTotal, 0),
    );
    const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
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
      sourceType: "daily_usage",
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
      lineItems,
      subtotal: grandTotal,
      monthlyTotal: grandTotal,
      yearlyTotal: roundMoney(grandTotal * 12),
      grandTotal,
      amountPaid: 0,
      balanceDue: grandTotal,
      notes: `Draft invoice from daily usage snapshots for ${args.month}. Review before issuing.`,
      createdAt: now,
      updatedAt: now,
    });

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
    includeRows: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const companyRows = args.companyId
      ? [await assertCanManageUsage(ctx, user, args.companyId)]
      : (await ctx.db.query("companies").collect()).filter((company) =>
          canViewCompany(user, company),
        );
    const companyNameById = new Map(
      companyRows.map((company) => [company._id, company.name]),
    );

    const rows = billableDailyUsageRows(
      args.companyId
        ? await ctx.db
            .query("dailyUsageSnapshots")
            .withIndex("by_company_month", (q) =>
              q.eq("companyId", args.companyId!).eq("month", args.month),
            )
            .collect()
        : await ctx.db
            .query("dailyUsageSnapshots")
            .withIndex("by_month", (q) => q.eq("month", args.month))
            .collect(),
    );

    const visibleRows = rows.filter((row) => companyNameById.has(row.companyId));

    const serviceTypes = [...new Set(visibleRows.map((row) => row.serviceType))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const usageDates = [...new Set(visibleRows.map((row) => row.usageDate))]
      .filter(Boolean)
      .sort();
    const companies = [...companyNameById.entries()]
      .map(([companyId, companyName]) => ({ companyId, companyName }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));

    const sortedRows = args.includeRows
      ? [...visibleRows].sort((a, b) => {
          const dateCompare = b.usageDate.localeCompare(a.usageDate);
          if (dateCompare !== 0) return dateCompare;
          const companyCompare = (
            companyNameById.get(a.companyId) ?? ""
          ).localeCompare(companyNameById.get(b.companyId) ?? "");
          if (companyCompare !== 0) return companyCompare;
          return a.serviceType.localeCompare(b.serviceType);
        })
      : [];

    const catalog = await ctx.db.query("serviceCatalog").collect();
    const catalogById = new Map(catalog.map((item) => [item._id, item]));
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
          estimatedAmount: rollupRows.reduce(
            (total, row) => total + (row.estimatedAmount ?? 0),
            0,
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

    const dailyRows = billableDailyUsageRows(
      await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", args.companyId).eq("month", args.month),
        )
        .collect(),
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
    const upcomingCharges = roundMoney(
      upcomingRollupRows.reduce(
        (total, row) => total + (row.estimatedAmount ?? 0),
        0,
      ),
    );
    const activeContractContext = contractPricingByCompany.get(company._id);
    const activeContractId = activeContractContext?.contract._id;
    const currentBalanceForActiveContract =
      activeContractId === undefined
        ? 0
        : roundMoney(
            openInvoices.reduce((total, invoice) => {
              const contract = resolveInvoiceContract(invoice);
              return contract?._id === activeContractId
                ? total + invoice.balanceDue
                : total;
            }, 0),
          );
    const paidThisMonthForActiveContract =
      activeContractId === undefined
        ? 0
        : roundMoney(
            recentPayments.reduce(
              (total, payment) =>
                payment.sourceContractId === activeContractId
                  ? total + payment.amount
                  : total,
              0,
            ),
          );
    const sharedContractCoverage =
      activeContractContext === undefined
        ? null
        : await buildContractUsageBilling(ctx, {
            contract: activeContractContext.contract,
            sourceMonth: args.month,
          });
    const normalizedContractCoverage =
      sharedContractCoverage === null
        ? null
        : {
            contractId: sharedContractCoverage.contract._id,
            contractNumber: sharedContractCoverage.contract.contractNumber,
            title: sharedContractCoverage.contract.title,
            billingFrequency: sharedContractCoverage.contract.billingFrequency,
            capturedDays: sharedContractCoverage.capturedDays,
            monthDayCount: daysInMonth(args.month),
            contractPeriodAmount: sharedContractCoverage.contractPeriodAmount,
            frequencyMonthCount: sharedContractCoverage.frequencyMonthCount,
            coverageBasis: "contract_period" as const,
            monthlyMinimum: roundMoney(
              sharedContractCoverage.contractPeriodAmount /
                sharedContractCoverage.frequencyMonthCount,
            ),
            includedToDate: sharedContractCoverage.contractPeriodAmount,
            usageToDate: sharedContractCoverage.usageToDate,
            extraToDate: sharedContractCoverage.overageAmount,
            status:
              sharedContractCoverage.contractPeriodAmount <= 0
                ? ("pricing_not_configured" as const)
                : sharedContractCoverage.overageAmount > 0
                  ? ("overage" as const)
                  : ("within_contract" as const),
            rows: sharedContractCoverage.rows
              .filter((row) => row.pricingSource === "contract")
              .map((row) => ({
                lineItemId: row.lineItemId as Id<"customerContractLineItems">,
                itemName: row.itemName,
                serviceCategory: row.serviceCategory,
                includedQuantity: row.includedQuantity,
                unit: row.unit,
                amount: row.usageAmount,
                includedAmount: row.baseAmount,
                extraAmount: 0,
              })),
          };

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
      const dailyCharge = roundMoney(
        dayRollup.reduce((total, row) => total + (row.estimatedAmount ?? 0), 0),
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
    const hourlyRowsForMonth = hourlyRows.filter(
      (row) => row.capturedHour <= monthEnd,
    );
    const hourlyRowsByHour = new Map<number, Doc<"manageOneHourlySnapshots">[]>();
    for (const row of hourlyRowsForMonth) {
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
      existing.billableQuantity = roundMoney(
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
      currentBalance: roundMoney(
        openInvoices.reduce((total, invoice) => total + invoice.balanceDue, 0),
      ),
      currentBalanceForActiveContract,
      upcomingCharges,
      paidThisMonth,
      paidThisMonthForActiveContract,
      projectedMonthEnd,
      contractCoverage: normalizedContractCoverage,
      dailyUsageReady: dailyRows.length > 0,
      latestUsageDate: usageDates[usageDates.length - 1] ?? null,
      dailySeries,
      hourlySeries,
      chargeBreakdown: [...chargeBreakdownByService.values()]
        .sort((a, b) => b.amount - a.amount),
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

function latestSnapshotsByTenantRegion(rows: Doc<"manageOneHourlySnapshots">[]) {
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

    const dailyRows = billableDailyUsageRows(
      args.companyId
        ? await ctx.db
            .query("dailyUsageSnapshots")
            .withIndex("by_company_month", (q) =>
              q.eq("companyId", args.companyId!).eq("month", args.month),
            )
            .collect()
        : await ctx.db
            .query("dailyUsageSnapshots")
            .withIndex("by_month", (q) => q.eq("month", args.month))
            .collect(),
    );
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
