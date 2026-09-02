import { describe, expect, it } from "vitest";
import {
  financialDay,
  financialMonth,
  financialMonthStart,
  financialYear,
  historicalDateDay,
  historicalDateMonth,
} from "./financialDates";

describe("financial dates", () => {
  it("uses Nairobi dates for operational timestamps", () => {
    const timestamp = Date.UTC(2025, 11, 31, 21, 30);
    expect(financialDay(timestamp)).toBe("2026-01-01");
    expect(financialMonth(timestamp)).toBe("2026-01");
    expect(financialYear(timestamp)).toBe(2026);
    expect(financialMonthStart("2026-01")).toBe(Date.UTC(2025, 11, 31, 21));
  });

  it("keeps UTC-midnight historical date-only values on their entered dates", () => {
    for (const value of ["2026-01-01", "2026-05-01", "2026-08-01", "2026-08-31"]) {
      const timestamp = Date.parse(`${value}T00:00:00Z`);
      expect(historicalDateDay(timestamp)).toBe(value);
      expect(historicalDateMonth(timestamp)).toBe(value.slice(0, 7));
    }
  });
});
