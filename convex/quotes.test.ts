import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { modules } from "./test.setup";
import { api } from "./_generated/api";

describe("buildQuotePreviewFromUsage", () => {
  it("builds quote line items from resolvable usage and warns for skipped entries", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(async (ctx) => {
      const countryId = await ctx.db.insert("countries", {
        name: "Somalia",
        region: "East Africa",
      });
      const sectorId = await ctx.db.insert("sectors", { name: "Banking" });
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "ceo-token",
        name: "CEO",
        role: "ceo",
      });
      const companyId = await ctx.db.insert("companies", {
        name: "AICC",
        sectorId,
        countryId,
        accountManagerId: userId,
        contractStatus: "active",
      });
      const eipCatalogId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "EIP",
        itemName: "EIP - Active",
        billingUnit: "per IP",
        monthlyPrice: 3,
        yearlyPrice: 30,
      });
      const evsCatalogId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "EVS",
        itemName: "SSD (Block Storage / NVMe)",
        billingUnit: "per GB",
        monthlyPrice: 0.072,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "EIP",
        amount: 6,
        quantity: 2,
        catalogItemId: eipCatalogId,
        isManualOverride: false,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "EVS",
        amount: 7.2,
        quantity: 100,
        catalogItemId: evsCatalogId,
        isManualOverride: false,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "WAF",
        amount: 50,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "VPN",
        amount: 20,
        catalogItemId: eipCatalogId,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-08",
        serviceType: "EIP",
        amount: 3,
        quantity: 1,
        catalogItemId: eipCatalogId,
      });

      return { companyId };
    });

    const preview = await t
      .withIdentity({ tokenIdentifier: "ceo-token" })
      .query(api.quotes.buildQuotePreviewFromUsage, {
        companyId: seed.companyId,
        month: "2026-07",
      });

    expect(preview.lineItems).toEqual([
      {
        catalogItemId: expect.any(String),
        itemName: "EIP - Active",
        serviceCategory: "EIP",
        billingUnit: "per IP",
        quantity: 2,
        monthlyUnitPrice: 3,
        monthlyTotal: 6,
        yearlyTotal: 60,
      },
      {
        catalogItemId: expect.any(String),
        itemName: "SSD (Block Storage / NVMe)",
        serviceCategory: "EVS",
        billingUnit: "per GB",
        quantity: 100,
        monthlyUnitPrice: 0.072,
        monthlyTotal: 7.199999999999999,
        yearlyTotal: 86.39999999999999,
      },
    ]);
    expect(preview.warnings).toEqual([
      {
        serviceType: "WAF",
        amount: 50,
        reason: "No catalog item linked",
      },
      {
        serviceType: "VPN",
        amount: 20,
        reason: "Missing quantity",
      },
    ]);
    expect(preview.monthlyGrandTotal).toBe(13.2);
    expect(preview.yearlyGrandTotal).toBe(146.39999999999998);
  });
});
