import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

describe("revenue assurance", () => {
  it("detects a missing invoice and reconciles a matching PAYG invoice", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "CEO",
        tokenIdentifier: "assurance-ceo",
        role: "ceo",
      });
      const countryId = await ctx.db.insert("countries", {
        name: "Somalia",
        region: "East Africa",
      });
      const sectorId = await ctx.db.insert("sectors", { name: "Banking" });
      const companyId = await ctx.db.insert("companies", {
        name: "Assured Customer",
        countryId,
        sectorId,
        accountManagerId: userId,
        commercialModel: "payg",
        contractStatus: "expired",
      });
      const tenantId = await ctx.db.insert("manageOneTenants", {
        vdcId: "assurance-vdc",
        name: "Assured Tenant",
        linkedCompanyId: companyId,
        lastSyncedAt: Date.now(),
      });
      const catalogItemId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "ECS",
        itemName: "ECS Standard",
        billingUnit: "instance/month",
        monthlyPrice: 310,
      });
      await ctx.db.insert("dailyUsageSnapshots", {
        companyId,
        tenantId,
        tenantName: "Assured Tenant",
        tenantVdcId: "assurance-vdc",
        usageDate: "2026-08-01",
        month: "2026-08",
        serviceType: "ECS",
        itemName: "ECS Standard",
        serviceCategory: "ECS",
        quantity: 1,
        unit: "instance/month",
        catalogItemId,
        source: "manageone",
        sourceKey: "assurance-usage",
        capturedAt: Date.now(),
      });
      return { userId, companyId, catalogItemId };
    });

    const refresh = await t.action(
      internal.dailyUsage.refreshBillingSnapshots,
      {
        months: ["2026-08"],
      },
    );
    expect(refresh).toMatchObject({
      rebuilt: 1,
      months: ["2026-08"],
    });
    const authed = t.withIdentity({ tokenIdentifier: "assurance-ceo" });
    const missing = await authed.query(api.dailyUsage.revenueAssurance, {
      month: "2026-08",
    });
    expect(missing.rows[0]).toMatchObject({
      companyName: "Assured Customer",
      expectedUsageAmount: 10,
      status: "missing_invoice",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        companyId: seeded.companyId,
        sourceType: "daily_usage",
        sourceMonth: "2026-08",
        createdBy: seeded.userId,
        status: "draft",
        companyName: "Assured Customer",
        lineItems: [
          {
            catalogItemId: seeded.catalogItemId,
            itemName: "ECS Standard",
            serviceCategory: "ECS",
            billingUnit: "instance/month",
            quantity: 1 / 31,
            monthlyUnitPrice: 310,
            monthlyTotal: 10,
            yearlyTotal: 120,
          },
        ],
        subtotal: 10,
        monthlyTotal: 10,
        yearlyTotal: 120,
        grandTotal: 10,
        amountPaid: 0,
        balanceDue: 10,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const reconciled = await authed.query(api.dailyUsage.revenueAssurance, {
      month: "2026-08",
    });
    expect(reconciled.rows[0]).toMatchObject({
      invoiceAmount: 10,
      variance: 0,
      status: "reconciled",
    });
  });
});
