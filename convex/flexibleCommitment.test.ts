import { describe, expect, it } from "vitest";
import { allocateFlexibleCommitment } from "./flexibleCommitment";

describe("allocateFlexibleCommitment", () => {
  it("shares one commitment across changing services", () => {
    const rows = allocateFlexibleCommitment(1_000, [
      { key: "compute", grossAmount: 800, discountPercent: 15 },
      { key: "storage", grossAmount: 500, discountPercent: 40 },
      { key: "network", grossAmount: 200, discountPercent: 10 },
    ]);
    expect(rows.map((row) => row.commitmentConsumed)).toEqual([680, 300, 20]);
    expect(rows.map((row) => row.overageAmount)).toEqual([0, 0, 177.78]);
    expect(rows[rows.length - 1]?.remainingCommitment).toBe(0);
  });

  it("charges the uncovered part at full catalogue value", () => {
    const [row] = allocateFlexibleCommitment(300, [
      { key: "ECS", grossAmount: 500, discountPercent: 20 },
    ]);
    expect(row.discountedAmount).toBe(400);
    expect(row.commitmentConsumed).toBe(300);
    expect(row.overageAmount).toBe(125);
  });

  it("does not consume commitment for a 100 percent discounted service", () => {
    const [row] = allocateFlexibleCommitment(200, [
      { key: "trial", grossAmount: 50, discountPercent: 100 },
    ]);
    expect(row.commitmentConsumed).toBe(0);
    expect(row.overageAmount).toBe(0);
    expect(row.remainingCommitment).toBe(200);
  });
});
