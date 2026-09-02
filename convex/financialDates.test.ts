import { describe, expect, it } from "vitest";
import { financialDay, financialMonth, financialMonthStart, financialYear } from "./financialDates";

describe("Nairobi financial dates", () => {
  it("assigns Nairobi midnight to the intended month and year", () => {
    const timestamp = Date.UTC(2025, 11, 31, 21, 30);
    expect(financialDay(timestamp)).toBe("2026-01-01");
    expect(financialMonth(timestamp)).toBe("2026-01");
    expect(financialYear(timestamp)).toBe(2026);
  });

  it("returns the UTC instant for Nairobi month start", () => {
    expect(financialMonthStart("2026-09")).toBe(Date.UTC(2026, 7, 31, 21));
  });
});
