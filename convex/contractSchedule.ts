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
    "pricingBasis" | "contractValue" | "startDate" | "endDate"
  >,
) {
  if (contract.pricingBasis !== "total_contract" || !contract.contractValue)
    return null;
  return allocateMoney(
    contract.contractValue,
    contractMonths(contract).map((month) => ({
      month,
      weight: calculateMonthProration({
        startDate: contract.startDate,
        endDate: contract.endDate,
        month,
      }).fraction,
    })),
  );
}
