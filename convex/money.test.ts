import { describe, expect, it } from "vitest";
import {
  allocateMoney,
  calculateContractCharges,
  calculateInvoiceTotals,
  calculateLineItems,
  calculateMonthProration,
  calculateTaxedLine,
  fromCents,
  normalizeRate,
  sumMoney,
  toCents,
} from "./money";

describe("money", () => {
  it("keeps canonical monetary amounts as integer cents", () => {
    expect(toCents(13.2)).toBe(1320);
    expect(fromCents(1320)).toBe(13.2);
    expect(Number.isInteger(toCents(13.2))).toBe(true);
  });

  it("rounds extended cloud rates only after multiplying quantity", () => {
    const [line] = calculateLineItems([
      { quantity: 100, monthlyUnitPrice: 0.072 },
    ]);
    expect(line.monthlyTotal).toBe(7.2);
    expect(line.yearlyTotal).toBe(86.4);
  });

  it("derives invoice totals exclusively from calculated lines", () => {
    const lines = calculateLineItems([
      {
        quantity: 3,
        monthlyUnitPrice: 1.005,
        monthlyTotal: 999,
        yearlyTotal: 999,
      },
    ]);
    expect(lines[0]).toMatchObject({ monthlyTotal: 3.02, yearlyTotal: 36.24 });
    expect(calculateInvoiceTotals(lines)).toEqual({
      subtotal: 3.02,
      monthlyTotal: 3.02,
      yearlyTotal: 36.24,
      grandTotal: 3.02,
    });
  });

  it("calculates discounts and tax in cents", () => {
    expect(
      calculateTaxedLine({
        quantity: 3,
        unitPrice: 10,
        discountPercent: 10,
        taxRate: 5,
      }),
    ).toEqual({ subtotal: 30, discount: 3, tax: 1.35, total: 28.35 });
  });

  it("prorates using explicit inclusive contract days", () => {
    expect(
      calculateMonthProration({
        startDate: Date.UTC(2026, 6, 16),
        endDate: Date.UTC(2026, 11, 31),
        month: "2026-07",
      }),
    ).toEqual({ activeDays: 16, totalDays: 31, fraction: 16 / 31 });
  });

  it("centralizes contract base, discount, and overage charges", () => {
    expect(
      calculateContractCharges({
        includedQuantity: 10,
        contractUnitPrice: 10,
        discountType: "percentage",
        discountValue: 20,
        overageUnitPrice: 15,
        actualQuantity: 7,
        monthFraction: 16 / 31,
      }),
    ).toEqual({
      proratedIncludedQuantity: 5.16129,
      grossBaseAmount: 51.61,
      discountAmount: 10.32,
      overageQuantity: 1.83871,
      overageUnitPrice: 15,
      overageAmount: 27.58,
      total: 68.87,
    });
  });

  it("sums and allocates cents without losing the remainder", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(
      allocateMoney(10, [
        { region: "A", weight: 1 },
        { region: "B", weight: 1 },
        { region: "C", weight: 1 },
      ]).map(({ region, amount }) => ({ region, amount })),
    ).toEqual([
      { region: "A", amount: 3.33 },
      { region: "B", amount: 3.33 },
      { region: "C", amount: 3.34 },
    ]);
  });

  it("normalizes sub-cent rates while rejecting negative prices", () => {
    expect(normalizeRate(0.0720004)).toBe(0.072);
    expect(() => normalizeRate(-1)).toThrow("cannot be negative");
  });
});
