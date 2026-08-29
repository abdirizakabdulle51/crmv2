import { describe, expect, it } from "vitest";
import type { Doc } from "./_generated/dataModel.d.ts";
import { contractDiscount, contractOveragePrice } from "./contractPricing";

const contract = {
  defaultDiscountType: "amount",
  defaultDiscountValue: 200,
  overagePricingPolicy: "current_catalog",
} as Doc<"customerContracts">;
const line = {
  contractUnitPrice: 100,
  catalogUnitPrice: 120,
} as Doc<"customerContractLineItems">;

describe("contract pricing policy", () => {
  it("applies a fixed contract-wide discount exactly once", () => {
    expect(contractDiscount(contract, line, 0)).toEqual({
      type: "amount",
      value: 200,
    });
    expect(contractDiscount(contract, line, 1)).toEqual({
      type: "amount",
      value: undefined,
    });
  });

  it("requires the selected overage price source instead of falling back", () => {
    expect(contractOveragePrice(contract, line, 140)).toBe(140);
    expect(() => contractOveragePrice(contract, line)).toThrow(
      /linked catalog item/i,
    );
    expect(
      contractOveragePrice(
        { ...contract, overagePricingPolicy: "frozen_catalog" },
        line,
        140,
      ),
    ).toBe(120);
  });

  it("gives line-specific discounts precedence", () => {
    expect(
      contractDiscount(
        contract,
        { ...line, discountType: "percentage", discountValue: 10 },
        2,
      ),
    ).toEqual({ type: "percentage", value: 10 });
  });

  it("uses a service override before its product-group discount", () => {
    expect(contractDiscount(contract, line, 0, undefined, 15)).toEqual({
      type: "percentage",
      value: 15,
    });
    expect(
      contractDiscount(
        contract,
        { ...line, discountType: "percentage", discountValue: 22 },
        0,
        undefined,
        15,
      ),
    ).toEqual({ type: "percentage", value: 22 });
    expect(
      contractDiscount(
        contract,
        { ...line, discountType: "percentage", discountValue: 0 },
        0,
        undefined,
        15,
      ),
    ).toEqual({ type: "percentage", value: 0 });
  });
});
