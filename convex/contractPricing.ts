import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel.d.ts";
import { allocateMoney } from "./money";

type Contract = Pick<
  Doc<"customerContracts">,
  "defaultDiscountType" | "defaultDiscountValue" | "overagePricingPolicy"
>;
type Line = Pick<
  Doc<"customerContractLineItems">,
  | "discountType"
  | "discountValue"
  | "overageUnitPrice"
  | "catalogUnitPrice"
  | "contractUnitPrice"
  | "includedQuantity"
>;

export function contractDiscount(
  contract: Contract,
  line: Line,
  lineIndex: number,
  allLines?: Line[],
  groupDiscountPercent?: number,
) {
  if (line.discountType) {
    return { type: line.discountType, value: line.discountValue };
  }
  if (groupDiscountPercent !== undefined) {
    return { type: "percentage" as const, value: groupDiscountPercent };
  }
  let value = contract.defaultDiscountValue;
  if (
    contract.defaultDiscountType === "amount" &&
    value !== undefined &&
    allLines?.length
  ) {
    value = allocateMoney(
      value,
      allLines.map((candidate, index) => ({
        index,
        weight: candidate.discountType
          ? 0
          : candidate.contractUnitPrice * candidate.includedQuantity,
      })),
    ).find((row) => row.index === lineIndex)?.amount;
  }
  return {
    type: contract.defaultDiscountType,
    value:
      contract.defaultDiscountType === "amount" && lineIndex > 0
        ? allLines?.length
          ? value
          : undefined
        : value,
  };
}

export function contractOveragePrice(
  contract: Contract,
  line: Line,
  currentCatalogPrice?: number,
) {
  const policy = contract.overagePricingPolicy ?? "current_catalog";
  const price =
    policy === "current_catalog"
      ? currentCatalogPrice
      : policy === "frozen_catalog"
        ? line.catalogUnitPrice
        : line.overageUnitPrice;
  if (price === undefined) {
    throw new ConvexError({
      code: "CONTRACT_PRICING_INCOMPLETE",
      message:
        policy === "current_catalog"
          ? "Current-catalog overage pricing requires a linked catalog item with a price"
          : policy === "frozen_catalog"
            ? "Frozen-catalog overage pricing requires a catalog price snapshot"
            : "Custom overage pricing requires an explicit overage price",
    });
  }
  return price;
}

export function usageBelongsToContract(
  usage: Pick<Doc<"consumption">, "catalogItemId" | "usageDate">,
  contract: Pick<Doc<"customerContracts">, "startDate" | "endDate">,
  catalogItemIds: Set<string>,
) {
  if (!usage.catalogItemId || !catalogItemIds.has(usage.catalogItemId)) {
    return false;
  }
  if (!usage.usageDate) return true;
  const timestamp = Date.parse(`${usage.usageDate}T12:00:00Z`);
  return timestamp >= contract.startDate && timestamp <= contract.endDate;
}
