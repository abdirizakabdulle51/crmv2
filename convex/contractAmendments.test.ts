import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { contractValueAllocations } from "./contractSchedule";
import schema from "./schema";
import { modules } from "./test.setup";

describe("contract value amendments", () => {
  it("applies an existing +75k amendment to a 25k annual contract", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "CEO",
        tokenIdentifier: "amendment-ceo",
        role: "ceo",
      });
      const countryId = await ctx.db.insert("countries", {
        name: "Somalia",
        region: "East Africa",
      });
      const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
      const companyId = await ctx.db.insert("companies", {
        name: "Amendment Customer",
        countryId,
        sectorId,
        accountManagerId: userId,
        contractStatus: "active",
      });
      const contractId = await ctx.db.insert("customerContracts", {
        companyId,
        contractNumber: "AMD-CTR-001",
        title: "Annual cloud commitment",
        status: "active",
        startDate: Date.UTC(2026, 0, 1),
        endDate: Date.UTC(2026, 11, 31, 23, 59, 59, 999),
        currency: "USD",
        billingFrequency: "quarterly",
        pricingBasis: "total_contract",
        commitmentModel: "flexible_value",
        pricingModel: "flexible_total_commitment",
        contractValue: 25_000,
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      const amendmentId = await ctx.db.insert("customerContractAmendments", {
        contractId,
        amendmentNumber: "AMD-CTR-001-AMD-001",
        type: "upgrade",
        effectiveDate: Date.UTC(2026, 0, 1),
        summary: "Correct total annual commitment",
        monthlyDelta: 75_000,
        status: "approved",
        createdBy: userId,
        createdAt: 2,
        updatedAt: 2,
      });
      return { contractId, amendmentId };
    });

    const result = await t
      .withIdentity({ tokenIdentifier: "amendment-ceo" })
      .mutation(api.customerContracts.applyAmendment, {
        amendmentId: seeded.amendmentId,
      });

    expect(result.contractValue).toBe(100_000);
    const stored = await t.run(async (ctx) => ({
      contract: await ctx.db.get(seeded.contractId),
      amendment: await ctx.db.get(seeded.amendmentId),
    }));
    expect(stored.contract?.contractValue).toBe(100_000);
    expect(stored.amendment).toMatchObject({
      status: "effective",
      previousContractValue: 25_000,
      resultingContractValue: 100_000,
    });
    const allocations = contractValueAllocations(stored.contract!);
    expect(allocations?.slice(0, 3).reduce((sum, row) => sum + row.amount, 0)).toBe(
      25_000,
    );
  });
});
