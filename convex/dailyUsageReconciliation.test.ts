import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

describe("historical daily usage catalogue reconciliation", () => {
  it("maps unique open rows and refuses ambiguous or locked rows", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "CEO",
        tokenIdentifier: "reconciliation-ceo",
        role: "ceo",
      });
      const countryId = await ctx.db.insert("countries", {
        name: "Somalia",
        region: "East Africa",
      });
      const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
      const companyId = await ctx.db.insert("companies", {
        name: "Historical Customer",
        countryId,
        sectorId,
        accountManagerId: userId,
        contractStatus: "active",
      });
      const tenantId = await ctx.db.insert("manageOneTenants", {
        vdcId: "vdc-history",
        name: "Historical Tenant",
        linkedCompanyId: companyId,
        lastSyncedAt: 1,
      });
      const ecsCatalogId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "ECS",
        serviceCode: "ECS",
        itemName: "C6.large",
        billingUnit: "instance/month",
        monthlyPrice: 100,
      });
      for (const monthlyPrice of [10, 12]) {
        await ctx.db.insert("serviceCatalog", {
          serviceCategory: "NAT",
          serviceCode: "NAT",
          itemName: "Small NAT Gateway",
          billingUnit: "gateway/month",
          monthlyPrice,
        });
      }
      const insertUsage = (args: {
        date: string;
        serviceType: string;
        itemName: string;
        lockedAt?: number;
      }) =>
        ctx.db.insert("dailyUsageSnapshots", {
          companyId,
          tenantId,
          tenantName: "Historical Tenant",
          tenantVdcId: "vdc-history",
          usageDate: args.date,
          month: "2026-08",
          serviceType: args.serviceType,
          itemName: args.itemName,
          serviceCategory: args.serviceType,
          quantity: 1,
          unit: "unit/month",
          source: "manageone",
          sourceKey: `legacy|${args.date}|${args.serviceType}`,
          capturedAt: 1,
          lockedAt: args.lockedAt,
        });
      const openRowId = await insertUsage({
        date: "2026-08-01",
        serviceType: "ECS",
        itemName: "c6.large",
      });
      await insertUsage({
        date: "2026-08-02",
        serviceType: "NAT",
        itemName: "Small NAT Gateway",
      });
      await insertUsage({
        date: "2026-08-03",
        serviceType: "ECS",
        itemName: "C6.large",
        lockedAt: 1,
      });
      return { companyId, openRowId, ecsCatalogId };
    });

    const result = await t
      .withIdentity({ tokenIdentifier: "reconciliation-ceo" })
      .mutation(api.dailyUsage.reconcileCatalogMappings, {
        companyId: seeded.companyId,
        month: "2026-08",
      });

    expect(result.mappedRows).toBe(1);
    expect(result.ambiguous).toEqual([
      expect.objectContaining({ service: "NAT / Small NAT Gateway" }),
    ]);
    expect(result.conflicts[0]).toContain("already attached");
    const mapped = await t.run((ctx) => ctx.db.get(seeded.openRowId));
    expect(mapped).toMatchObject({
      catalogItemId: seeded.ecsCatalogId,
      itemName: "C6.large",
      serviceType: "ECS",
      unit: "instance/month",
    });
    expect(mapped?.sourceKey).toContain(String(seeded.ecsCatalogId));
  });
});
