import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

type Ctx = QueryCtx | MutationCtx;
type ContractLine = Doc<"customerContractLineItems">;
type DailyUsageRow = Doc<"dailyUsageSnapshots">;
type CatalogItem = Doc<"serviceCatalog">;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeKey(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function discountAmount(line: ContractLine, gross: number) {
  if (!line.discountType || line.discountValue === undefined) return 0;
  if (line.discountType === "percentage") {
    return Math.min(gross, gross * (line.discountValue / 100));
  }
  return Math.min(gross, line.discountValue);
}

export function contractLineBaseAmount(line: ContractLine) {
  const gross = line.includedQuantity * line.contractUnitPrice;
  return Math.max(0, roundMoney(gross - discountAmount(line, gross)));
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

function monthInputValue(timestamp: number) {
  const date = new Date(timestamp);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return monthInputValue(date.getTime());
}

function monthDiff(fromMonth: string, toMonth: string) {
  const [fromYear, fromMonthNumber] = fromMonth.split("-").map(Number);
  const [toYear, toMonthNumber] = toMonth.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonthNumber - fromMonthNumber);
}

function monthsBetween(startMonth: string, endMonth: string) {
  const count = monthDiff(startMonth, endMonth);
  return Array.from({ length: count + 1 }, (_, index) =>
    addMonths(startMonth, index),
  );
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function billingFrequencyMonths(
  frequency: Doc<"customerContracts">["billingFrequency"],
) {
  if (frequency === "quarterly" || frequency === "every_3_months") return 3;
  if (frequency === "yearly") return 12;
  return 1;
}

function billingPeriodForContract(
  contract: Doc<"customerContracts">,
  sourceMonth: string,
) {
  const frequencyMonthCount = billingFrequencyMonths(contract.billingFrequency);
  const contractStartMonth = monthInputValue(contract.startDate);
  const contractEndMonth = monthInputValue(contract.endDate);

  if (monthDiff(contractStartMonth, sourceMonth) < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Contract does not cover the selected invoice month",
    });
  }

  const offset = monthDiff(contractStartMonth, sourceMonth);
  const periodOffset = Math.floor(offset / frequencyMonthCount) * frequencyMonthCount;
  const periodStartMonth = addMonths(contractStartMonth, periodOffset);
  const periodEndMonth = addMonths(periodStartMonth, frequencyMonthCount - 1);
  const cappedEndMonth =
    monthDiff(periodEndMonth, contractEndMonth) > 0
      ? contractEndMonth
      : periodEndMonth;

  return {
    frequencyMonthCount,
    periodStartMonth,
    periodEndMonth: cappedEndMonth,
    effectiveEndMonth:
      monthDiff(sourceMonth, cappedEndMonth) > 0 ? sourceMonth : cappedEndMonth,
  };
}

function contractLineMatchesDailyRow(row: DailyUsageRow, line: ContractLine) {
  if (line.catalogItemId && row.catalogItemId === line.catalogItemId) {
    return true;
  }

  const itemMatches = normalizeKey(row.itemName) === normalizeKey(line.itemName);
  const categoryMatches =
    normalizeKey(row.serviceType) === normalizeKey(line.serviceCategory) ||
    normalizeKey(row.serviceCategory) === normalizeKey(line.serviceCategory);
  const unitMatches =
    normalizeKey(row.unit) === normalizeKey(line.unit) ||
    normalizeKey(row.unit) === normalizeKey(line.billingUnit);

  return itemMatches && categoryMatches && unitMatches;
}

function rowGroupKey(row: DailyUsageRow) {
  return [
    row.catalogItemId ?? normalizeKey(row.itemName),
    normalizeKey(row.serviceType),
    normalizeKey(row.unit),
    normalizeKey(row.regionId ?? row.regionName ?? row.dataCenterName),
  ].join("|");
}

function allocatedLineShare(args: {
  line: ContractLine;
  matchedLines: ContractLine[];
  value: number;
  by: "base" | "quantity";
}) {
  const weights = args.matchedLines.map((line) =>
    args.by === "base" ? contractLineBaseAmount(line) : line.includedQuantity,
  );
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  if (totalWeight <= 0) return args.value / args.matchedLines.length;
  const index = args.matchedLines.findIndex((line) => line._id === args.line._id);
  return args.value * ((weights[index] ?? 0) / totalWeight);
}

export async function buildContractUsageBilling(
  ctx: Ctx,
  args: {
    contract: Doc<"customerContracts">;
    sourceMonth: string;
  },
) {
  monthStartTimestamp(args.sourceMonth);
  const period = billingPeriodForContract(args.contract, args.sourceMonth);
  const periodStart = monthStartTimestamp(period.periodStartMonth);
  const effectiveEnd = Math.min(
    monthEndTimestamp(period.effectiveEndMonth),
    args.contract.endDate,
  );

  const lines = (
    await ctx.db
      .query("customerContractLineItems")
      .withIndex("by_contract", (q) => q.eq("contractId", args.contract._id))
      .collect()
  ).sort((a, b) => a.createdAt - b.createdAt);

  const catalog = await ctx.db.query("serviceCatalog").collect();
  const catalogById = new Map<Id<"serviceCatalog">, CatalogItem>(
    catalog.map((item) => [item._id, item]),
  );

  const dailyRows: DailyUsageRow[] = [];
  for (const month of monthsBetween(period.periodStartMonth, period.effectiveEndMonth)) {
    const rows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.contract.companyId).eq("month", month),
      )
      .collect();
    dailyRows.push(
      ...rows.filter((row) => {
        const timestamp = Date.parse(`${row.usageDate}T00:00:00.000Z`);
        return timestamp >= periodStart && timestamp <= effectiveEnd;
      }),
    );
  }

  const lineRows = new Map<
    Id<"customerContractLineItems">,
    {
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
      pricingSource: "contract";
    }
  >();

  for (const line of lines) {
    const baseAmount = contractLineBaseAmount(line);
    lineRows.set(line._id, {
      lineItemId: line._id,
      itemName: line.itemName,
      serviceCategory: line.serviceCategory,
      includedQuantity: line.includedQuantity,
      unit: line.unit,
      contractUnitPrice: line.contractUnitPrice,
      overageUnitPrice: line.overageUnitPrice,
      actualQuantity: 0,
      overageQuantity: 0,
      baseAmount,
      overageAmount: 0,
      projectedAmount: 0,
      usageAmount: 0,
      matchedEntries: 0,
      pricingSource: "contract",
    });
  }

  const catalogRows = new Map<
    string,
    {
      lineItemId: string;
      itemName: string;
      serviceCategory: string;
      includedQuantity: number;
      unit: string;
      contractUnitPrice: number;
      actualQuantity: number;
      overageQuantity: number;
      baseAmount: number;
      overageAmount: number;
      projectedAmount: number;
      usageAmount: number;
      matchedEntries: number;
      pricingSource: "catalog" | "unpriced";
    }
  >();

  let usageToDate = 0;
  let unpricedCount = 0;

  for (const row of dailyRows) {
    const monthDayCount = daysInMonth(row.month);
    const billableQuantity = row.quantity / monthDayCount;
    const matchedLines = lines.filter((line) =>
      contractLineMatchesDailyRow(row, line),
    );

    if (matchedLines.length > 0) {
      const totalIncludedQuantity = matchedLines.reduce(
        (total, line) => total + line.includedQuantity,
        0,
      );
      const totalBaseAmount = matchedLines.reduce(
        (total, line) => total + contractLineBaseAmount(line),
        0,
      );
      const effectiveContractUnitPrice =
        totalIncludedQuantity > 0 ? totalBaseAmount / totalIncludedQuantity : 0;
      const amount = roundMoney(billableQuantity * effectiveContractUnitPrice);
      usageToDate = roundMoney(usageToDate + amount);

      for (const line of matchedLines) {
        const displayRow = lineRows.get(line._id);
        if (!displayRow) continue;
        displayRow.actualQuantity = roundMoney(
          displayRow.actualQuantity +
            allocatedLineShare({
              line,
              matchedLines,
              value: billableQuantity,
              by: "quantity",
            }),
        );
        displayRow.usageAmount = roundMoney(
          displayRow.usageAmount +
            allocatedLineShare({
              line,
              matchedLines,
              value: amount,
              by: "base",
            }),
        );
        displayRow.matchedEntries += 1;
      }
      continue;
    }

    const catalogItem = row.catalogItemId
      ? catalogById.get(row.catalogItemId)
      : undefined;
    const key = rowGroupKey(row);
    const displayRow = catalogRows.get(key) ?? {
      lineItemId: `catalog:${key}`,
      itemName: row.itemName,
      serviceCategory: row.serviceType,
      includedQuantity: 0,
      unit: row.unit,
      contractUnitPrice: catalogItem?.monthlyPrice ?? 0,
      actualQuantity: 0,
      overageQuantity: 0,
      baseAmount: 0,
      overageAmount: 0,
      projectedAmount: 0,
      usageAmount: 0,
      matchedEntries: 0,
      pricingSource: catalogItem ? ("catalog" as const) : ("unpriced" as const),
    };

    displayRow.actualQuantity = roundMoney(
      displayRow.actualQuantity + billableQuantity,
    );
    displayRow.matchedEntries += 1;
    if (catalogItem) {
      const amount = roundMoney(billableQuantity * catalogItem.monthlyPrice);
      usageToDate = roundMoney(usageToDate + amount);
      displayRow.usageAmount = roundMoney(displayRow.usageAmount + amount);
      displayRow.projectedAmount = displayRow.usageAmount;
    } else {
      unpricedCount++;
    }
    catalogRows.set(key, displayRow);
  }

  const contractPeriodAmount = roundMoney(
    lines.reduce((total, line) => total + contractLineBaseAmount(line), 0),
  );
  const overageAmount = roundMoney(Math.max(0, usageToDate - contractPeriodAmount));
  const capturedDays = [...new Set(dailyRows.map((row) => row.usageDate))].length;

  return {
    contract: args.contract,
    lines,
    sourceMonth: args.sourceMonth,
    periodStartMonth: period.periodStartMonth,
    periodEndMonth: period.periodEndMonth,
    effectiveEndMonth: period.effectiveEndMonth,
    frequencyMonthCount: period.frequencyMonthCount,
    contractPeriodAmount,
    usageToDate,
    overageAmount,
    capturedDays,
    dailyRowCount: dailyRows.length,
    unpricedCount,
    rows: [...lineRows.values(), ...catalogRows.values()].map((row) => ({
      ...row,
      projectedAmount: row.pricingSource === "contract" ? row.usageAmount : row.projectedAmount,
    })),
    totals: {
      contractMinimum: contractPeriodAmount,
      credit: contractPeriodAmount,
      usageAmount: usageToDate,
      overage: overageAmount,
      projected: overageAmount,
      matchedEntries: dailyRows.length - unpricedCount,
      totalUsageEntries: dailyRows.length,
      unpricedCount,
    },
  };
}
