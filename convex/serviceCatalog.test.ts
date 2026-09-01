import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

describe("legacy service catalogue metadata migration", () => {
  it("fills only explicit mappings and preserves catalogue prices", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const ecs = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "ECS",
        itemName: "ECS legacy",
        billingUnit: "instance/month",
        monthlyPrice: 120,
      });
      const lts = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "LTS",
        itemName: "LTS Compliance",
        billingUnit: "instance/month",
        monthlyPrice: 45,
      });
      const user = await ctx.db.insert("users", {
        tokenIdentifier: "migration-test-user",
        role: "ceo",
      });
      const company = await ctx.db.insert("companies", {
        name: "Migration test",
        sectorId: await ctx.db.insert("sectors", { name: "Test" }),
        countryId: await ctx.db.insert("countries", { name: "Test", region: "Test" }),
        contractStatus: "active",
      });
      const contract = await ctx.db.insert("customerContracts", {
        companyId: company,
        contractNumber: "MIGRATION-1",
        title: "Migration test contract",
        status: "draft",
        currency: "USD",
        billingFrequency: "monthly",
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
        pricingBasis: "total_contract",
        contractValue: 120,
        createdBy: user,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const line = await ctx.db.insert("customerContractLineItems", {
        contractId: contract,
        catalogItemId: ecs,
        itemName: "ECS legacy",
        serviceCategory: "ECS",
        includedQuantity: 1,
        unit: "instance/month",
        contractUnitPrice: 120,
        billingUnit: "instance/month",
        createdBy: user,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { ecs, lts, line };
    });

    const result = await t.mutation(internal.serviceCatalog.migrateLegacyMetadata, {});
    expect(result.migratedRows).toBe(1);
    expect(result.migratedContractLines).toBe(1);
    expect(result.ambiguous).toEqual([
      expect.objectContaining({ itemName: "LTS Compliance", serviceCategory: "LTS" }),
    ]);

    await t.run(async (ctx) => {
      const ecs = await ctx.db.get(seeded.ecs);
      const lts = await ctx.db.get(seeded.lts);
      const line = await ctx.db.get(seeded.line);
      expect(ecs).toMatchObject({
        productGroup: "compute",
        serviceCode: "ECS",
        monthlyPrice: 120,
        billingUnit: "instance/month",
      });
      expect(lts).not.toHaveProperty("productGroup");
      expect(lts).not.toHaveProperty("serviceCode");
      expect(line).toMatchObject({
        productGroup: "compute",
        serviceCode: "ECS",
        contractUnitPrice: 120,
      });
    });
  });

  it("is idempotent and does not overwrite existing metadata", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("serviceCatalog", {
        serviceCategory: "EVS",
        itemName: "EVS custom",
        productGroup: "storage",
        serviceCode: "EVS-CUSTOM",
        billingUnit: "GB/month",
        monthlyPrice: 1,
      });
    });
    const first = await t.mutation(internal.serviceCatalog.migrateLegacyMetadata, {});
    const second = await t.mutation(internal.serviceCatalog.migrateLegacyMetadata, {});
    expect(first.migratedRows).toBe(0);
    expect(second.migratedRows).toBe(0);
  });
});
