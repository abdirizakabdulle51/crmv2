import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { calculateMonthProration, roundMoney, sumMoney } from "./money";
import { allocateFlexibleCommitment } from "./flexibleCommitment";

type Ctx = QueryCtx | MutationCtx;
type BillingUsage = {
  _id: string;
  month: string;
  usageDate?: string;
  catalogItemId?: Id<"serviceCatalog">;
  amount: number;
};

export async function priceMonthlyContractUsage(
  ctx: Ctx,
  contract: Doc<"customerContracts">,
  month: string,
) {
  const [legacyUsage, dailyRows, rules, overrides, tenants] = await Promise.all(
    [
      ctx.db
        .query("consumption")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", contract.companyId).eq("month", month),
        )
        .collect(),
      ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", contract.companyId).eq("month", month),
        )
        .collect(),
      ctx.db
        .query("customerContractGroupDiscounts")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
      ctx.db
        .query("customerContractLineItems")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
      ctx.db
        .query("manageOneTenants")
        .withIndex("by_linked_company", (q) =>
          q.eq("linkedCompanyId", contract.companyId),
        )
        .collect(),
    ],
  );
  const fromDaily = tenants.some((tenant) => tenant.enabled !== false);
  const usage: BillingUsage[] = fromDaily
    ? await pricedDailyUsage(
        ctx,
        dailyRows,
        contract.startDate,
        contract.endDate,
      )
    : legacyUsage;
  const monthFraction = calculateMonthProration({
    startDate: contract.startDate,
    endDate: contract.endDate,
    month,
  }).fraction;
  if (
    !fromDaily &&
    monthFraction < 1 &&
    usage.some((entry) => !entry.usageDate)
  ) {
    throw new ConvexError({
      code: "USAGE_PERIOD_REQUIRED",
      message: "Partial-month contracts require dated usage records",
    });
  }
  const activeUsage = usage.filter((entry) => {
    if (!entry.usageDate) return true;
    const timestamp = Date.parse(`${entry.usageDate}T12:00:00.000Z`);
    return timestamp >= contract.startDate && timestamp <= contract.endDate;
  });
  if (activeUsage.some((entry) => !entry.catalogItemId)) {
    throw new ConvexError({
      code: "USAGE_CATALOG_REQUIRED",
      message:
        "Every usage record must be linked to a classified catalogue service before contract invoicing",
    });
  }
  const catalogIds = new Set(activeUsage.map((entry) => entry.catalogItemId!));
  const catalogs = await Promise.all(
    [...catalogIds].map(async (id) => [id, await ctx.db.get(id)] as const),
  );
  const catalogById = new Map(catalogs);
  if (
    catalogs.some(
      ([, catalog]) => !catalog?.productGroup || !catalog.serviceCode,
    )
  ) {
    throw new ConvexError({
      code: "USAGE_CATALOG_REQUIRED",
      message:
        "Every used catalogue service must have a product group and service code before contract invoicing",
    });
  }
  const groupDiscount = new Map(
    rules.map((rule) => [rule.productGroup, rule.discountPercent]),
  );
  const overrideByService = new Map(
    overrides
      .filter(
        (line) =>
          line.serviceCode &&
          line.discountType === "percentage" &&
          line.discountValue !== undefined,
      )
      .map((line) => [line.serviceCode!, line.discountValue!]),
  );
  const grouped = new Map<
    Id<"serviceCatalog">,
    {
      catalogItemId: Id<"serviceCatalog">;
      itemName: string;
      serviceCategory: string;
      billingUnit: string;
      catalogueUsage: number;
      discountedUsage: number;
      discountPercent: number;
    }
  >();
  for (const entry of activeUsage) {
    const catalog = catalogById.get(entry.catalogItemId!)!;
    const discountPercent =
      overrideByService.get(catalog.serviceCode!) ??
      groupDiscount.get(catalog.productGroup!) ??
      0;
    const discountedAmount = roundMoney(
      entry.amount * (1 - discountPercent / 100),
    );
    const current = grouped.get(catalog._id) ?? {
      catalogItemId: catalog._id,
      itemName: catalog.itemName,
      serviceCategory: catalog.serviceCategory,
      billingUnit: catalog.billingUnit,
      catalogueUsage: 0,
      discountedUsage: 0,
      discountPercent,
    };
    current.catalogueUsage = sumMoney([current.catalogueUsage, entry.amount]);
    current.discountedUsage = sumMoney([
      current.discountedUsage,
      discountedAmount,
    ]);
    grouped.set(catalog._id, current);
  }
  const lines = [...grouped.values()];
  const catalogueUsage = sumMoney(lines.map((line) => line.catalogueUsage));
  const discountedUsage = sumMoney(lines.map((line) => line.discountedUsage));
  const minimum =
    contract.pricingModel === "monthly_minimum"
      ? roundMoney((contract.monthlyMinimum ?? 0) * monthFraction)
      : 0;
  return {
    catalogueUsage,
    discountedUsage,
    minimum,
    shortfall: Math.max(0, sumMoney([minimum, -discountedUsage])),
    payable: Math.max(minimum, discountedUsage),
    entries: activeUsage.length,
    totalEntries: usage.length,
    lines,
  };
}

function monthKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function monthEnd(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return Date.UTC(year, monthNumber, 0, 23, 59, 59, 999);
}

async function pricedDailyUsage(
  ctx: Ctx,
  rows: Doc<"dailyUsageSnapshots">[],
  start: number,
  end: number,
): Promise<BillingUsage[]> {
  const catalog = new Map(
    (await ctx.db.query("serviceCatalog").collect()).map((item) => [
      item._id,
      item,
    ]),
  );
  const grouped = new Map<
    string,
    { month: string; catalogItemId?: Id<"serviceCatalog">; quantity: number }
  >();
  for (const row of rows) {
    const timestamp = Date.parse(`${row.usageDate}T00:00:00.000Z`);
    if (timestamp < start || timestamp > end) continue;
    const key = `${row.month}|${row.catalogItemId ?? row.serviceType}`;
    const current = grouped.get(key) ?? {
      month: row.month,
      catalogItemId: row.catalogItemId,
      quantity: 0,
    };
    current.quantity += row.quantity;
    grouped.set(key, current);
  }
  return [...grouped.entries()].map(([key, row]) => {
    const item = row.catalogItemId ? catalog.get(row.catalogItemId) : undefined;
    const [year, monthNumber] = row.month.split("-").map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
      _id: `daily:${key}`,
      month: row.month,
      catalogItemId: row.catalogItemId,
      amount: item ? roundMoney((row.quantity / days) * item.monthlyPrice) : 0,
    };
  });
}

export async function priceFlexibleContractUsage(
  ctx: Ctx,
  contract: Doc<"customerContracts">,
  through: number,
) {
  const [legacyUsage, dailyRows, rules, overrides, tenants] = await Promise.all(
    [
      ctx.db
        .query("consumption")
        .withIndex("by_company", (q) => q.eq("companyId", contract.companyId))
        .collect(),
      ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_company", (q) => q.eq("companyId", contract.companyId))
        .collect(),
      ctx.db
        .query("customerContractGroupDiscounts")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
      ctx.db
        .query("customerContractLineItems")
        .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
        .collect(),
      ctx.db
        .query("manageOneTenants")
        .withIndex("by_linked_company", (q) =>
          q.eq("linkedCompanyId", contract.companyId),
        )
        .collect(),
    ],
  );
  const fromDaily = tenants.some((tenant) => tenant.enabled !== false);
  const usage: BillingUsage[] = fromDaily
    ? await pricedDailyUsage(
        ctx,
        dailyRows,
        contract.startDate,
        Math.min(contract.endDate, through),
      )
    : legacyUsage;
  const boundaryMonths = new Set([
    monthKey(contract.startDate),
    monthKey(contract.endDate),
  ]);
  if (
    !fromDaily &&
    usage.some(
      (entry) =>
        boundaryMonths.has(entry.month) &&
        calculateMonthProration({
          startDate: contract.startDate,
          endDate: contract.endDate,
          month: entry.month,
        }).fraction < 1 &&
        !entry.usageDate,
    )
  ) {
    throw new ConvexError({
      code: "USAGE_PERIOD_REQUIRED",
      message: "Partial-month contracts require dated usage records",
    });
  }
  const dated = usage
    .map((entry) => ({
      entry,
      timestamp: entry.usageDate
        ? Date.parse(`${entry.usageDate}T12:00:00.000Z`)
        : monthEnd(entry.month),
    }))
    .filter(
      ({ timestamp }) =>
        timestamp >= contract.startDate &&
        timestamp <= contract.endDate &&
        timestamp <= through,
    )
    .sort(
      (a, b) =>
        a.timestamp - b.timestamp || a.entry._id.localeCompare(b.entry._id),
    );
  if (dated.some(({ entry }) => !entry.catalogItemId)) {
    throw new ConvexError({
      code: "USAGE_CATALOG_REQUIRED",
      message: "Every contract usage record must be linked to the catalogue",
    });
  }
  const catalogIds = new Set(dated.map(({ entry }) => entry.catalogItemId!));
  const catalogs = await Promise.all(
    [...catalogIds].map(async (id) => [id, await ctx.db.get(id)] as const),
  );
  const catalogById = new Map(catalogs);
  if (
    catalogs.some(
      ([, catalog]) => !catalog?.productGroup || !catalog.serviceCode,
    )
  ) {
    throw new ConvexError({
      code: "USAGE_CATALOG_REQUIRED",
      message:
        "Every used catalogue service must have a product group and service code",
    });
  }
  const groupDiscount = new Map(
    rules.map((rule) => [rule.productGroup, rule.discountPercent]),
  );
  const overrideByService = new Map(
    overrides
      .filter(
        (line) =>
          line.serviceCode &&
          line.discountType === "percentage" &&
          line.discountValue !== undefined,
      )
      .map((line) => [line.serviceCode!, line.discountValue!]),
  );
  return allocateFlexibleCommitment(
    contract.contractValue ?? 0,
    dated.map(({ entry }) => {
      const catalog = catalogById.get(entry.catalogItemId!)!;
      return {
        key: entry._id,
        grossAmount: entry.amount,
        discountPercent:
          overrideByService.get(catalog.serviceCode!) ??
          groupDiscount.get(catalog.productGroup!) ??
          0,
      };
    }),
  );
}
