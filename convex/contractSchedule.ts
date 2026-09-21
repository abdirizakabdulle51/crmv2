import type { Doc } from "./_generated/dataModel.d.ts";
import { allocateMoney, calculateMonthProration } from "./money";

function monthKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function addMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return monthKey(Date.UTC(year, number, 1));
}

export function contractMonths(
  contract: Pick<Doc<"customerContracts">, "startDate" | "endDate">,
) {
  const start = monthKey(contract.startDate);
  const end = monthKey(contract.endDate);
  const months: string[] = [];
  for (let month = start; month <= end; month = addMonth(month))
    months.push(month);
  return months;
}

export function contractValueAllocations(
  contract: Pick<
    Doc<"customerContracts">,
    | "pricingBasis"
    | "contractValue"
    | "startDate"
    | "endDate"
    | "billingFrequency"
  >,
) {
  if (contract.pricingBasis !== "total_contract" || !contract.contractValue)
    return null;
  const months = contractMonths(contract).map((month) => ({
    month,
    weight: calculateMonthProration({
      startDate: contract.startDate,
      endDate: contract.endDate,
      month,
    }).fraction,
  }));
  const cycleSize =
    contract.billingFrequency === "quarterly" ||
    contract.billingFrequency === "every_3_months"
      ? 3
      : contract.billingFrequency === "semiannual"
        ? 6
        : contract.billingFrequency === "yearly"
          ? 12
          : 1;
  const cycles = Array.from(
    { length: Math.ceil(months.length / cycleSize) },
    (_, index) => {
      const cycleMonths = months.slice(index * cycleSize, (index + 1) * cycleSize);
      return {
        index,
        months: cycleMonths,
        weight: cycleMonths.reduce((sum, month) => sum + month.weight, 0),
      };
    },
  );
  return allocateMoney(contract.contractValue, cycles).flatMap((cycle) =>
    allocateMoney(
      cycle.amount,
      cycle.months.map((month) => ({
        ...month,
      })),
    ).map(({ month, weight, amount }) => ({
      month,
      weight,
      amount,
    })),
  );
}
