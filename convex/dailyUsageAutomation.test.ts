import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

describe("automated PAYG billing", () => {
  it("creates one draft from completed ManageOne daily usage and remains idempotent", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const countryId = await ctx.db.insert("countries", {
        name: "Somalia",
        region: "East Africa",
      });
      const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
      const userId = await ctx.db.insert("users", {
        name: "CEO",
        tokenIdentifier: "payg-billing-ceo",
        role: "ceo",
      });
      const companyId = await ctx.db.insert("companies", {
        name: "PAYG Customer",
        sectorId,
        countryId,
        accountManagerId: userId,
        contractStatus: "active",
        lifecycleStatus: "customer",
        commercialModel: "contracted",
        paymentTermDays: 7,
      });
      const catalogItemId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "Storage",
        itemName: "EVS Storage",
        billingUnit: "GB/month",
        monthlyPrice: 10,
      });
      const tenantId = await ctx.db.insert("manageOneTenants", {
        vdcId: "vdc-payg",
        name: "PAYG Tenant",
        enabled: true,
        lastSyncedAt: 1,
        linkedCompanyId: companyId,
      });
      await ctx.db.insert("customerContracts", {
        companyId,
        contractNumber: "POST-PAYG-1",
        title: "Contract beginning after PAYG cycle",
        status: "active",
        startDate: Date.UTC(2026, 8, 1),
        endDate: Date.UTC(2027, 7, 31),
        currency: "USD",
        billingFrequency: "monthly",
        billingTiming: "postpaid",
        pricingBasis: "total_contract",
        commitmentModel: "flexible_value",
        pricingModel: "flexible_total_commitment",
        contractValue: 1200,
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("invoiceProfiles", {
        name: "Somalia",
        countryId,
        isDefault: false,
        isActive: true,
        legalName: "HTG CLOUDS",
        addressLines: ["Mogadishu"],
        phone: "1",
        email: "finance@example.com",
        website: "https://example.com",
        slogan: "Cloud",
        bankName: "Bank",
        bankAccountNumber: "1",
        bankAccountName: "HTG",
        bankLocation: "Somalia",
        currency: "USD",
        currencyNote: "USD",
        paymentInstructions: "Pay",
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      });
      let usageId!: Id<"dailyUsageSnapshots">;
      for (let day = 1; day <= 31; day++) {
        if (day === 15) continue;
        usageId = await ctx.db.insert("dailyUsageSnapshots", {
          companyId,
          tenantId,
          tenantName: "PAYG Tenant",
          tenantVdcId: "vdc-payg",
          usageDate: `2026-08-${String(day).padStart(2, "0")}`,
          month: "2026-08",
          serviceType: "Storage",
          itemName: "EVS Storage",
          serviceCategory: "Storage",
          quantity: 1,
          unit: "GB/month",
          catalogItemId,
          source: "manageone",
          sourceKey: `payg-2026-08-${day}`,
          capturedAt: Date.UTC(2026, 7, day),
        });
      }
      await ctx.db.insert("manageOneTenants", {
        vdcId: "vdc-unlinked",
        name: "Unlinked Tenant",
        enabled: true,
        lastSyncedAt: 1,
      });
      return { companyId, usageId, tenantId, catalogItemId };
    });
    const ceo = t.withIdentity({ tokenIdentifier: "payg-billing-ceo" });

    const candidates = await ceo.query(api.dailyUsage.billingCandidates, {
      month: "2026-08",
    });
    expect(
      candidates.find(
        (row) => "companyId" in row && row.companyId === seeded.companyId,
      ),
    ).toMatchObject({
      status: "incomplete_usage",
    });

    await t.run((ctx) =>
      ctx.db.insert("dailyUsageSnapshots", {
        companyId: seeded.companyId,
        tenantId: seeded.tenantId,
        tenantName: "PAYG Tenant",
        tenantVdcId: "vdc-payg",
        usageDate: "2026-08-15",
        month: "2026-08",
        serviceType: "Storage",
        itemName: "EVS Storage",
        serviceCategory: "Storage",
        quantity: 1,
        unit: "GB/month",
        catalogItemId: seeded.catalogItemId,
        source: "manageone",
        sourceKey: "payg-2026-08-15",
        capturedAt: Date.UTC(2026, 7, 15),
      }),
    );
    const completeCandidates = await ceo.query(
      api.dailyUsage.billingCandidates,
      { month: "2026-08" },
    );
    expect(
      completeCandidates.find(
        (row) => "companyId" in row && row.companyId === seeded.companyId,
      ),
    ).toMatchObject({
      status: "ready",
      amount: 10,
      latestUsageDate: "2026-08-31",
      expectedLastDate: "2026-08-31",
    });
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unlinked_tenant",
          companyName: "Unlinked Tenant",
        }),
      ]),
    );

    const first = await t.mutation(internal.dailyUsage.createDuePaygDrafts, {
      now: Date.UTC(2026, 8, 10),
    });
    const second = await t.mutation(internal.dailyUsage.createDuePaygDrafts, {
      now: Date.UTC(2026, 8, 10),
    });
    expect(first).toMatchObject({ month: "2026-08", scanned: 1, created: 1 });
    expect(second).toMatchObject({ month: "2026-08", scanned: 0, created: 0 });

    const stored = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
      usage: await ctx.db.get(seeded.usageId),
      runs: await ctx.db.query("billingAutomationRuns").collect(),
    }));
    expect(stored.invoices).toHaveLength(1);
    expect(stored.invoices[0]).toMatchObject({
      companyId: seeded.companyId,
      sourceMonth: "2026-08",
      status: "draft",
      grandTotal: 10,
    });
    expect(stored.usage?.invoiceId).toBe(stored.invoices[0]._id);
    expect(stored.usage?.lockedAt).toBeGreaterThan(0);
    expect(stored.runs).toHaveLength(2);

    await t.run((ctx) =>
      ctx.db.patch(seeded.usageId, {
        quantity: 2,
        capturedAt: 9_999_999_999_999,
      }),
    );
    const changed = await ceo.query(api.dailyUsage.billingCandidates, {
      month: "2026-08",
    });
    expect(
      changed.find(
        (row) => "companyId" in row && row.companyId === seeded.companyId,
      ),
    ).toMatchObject({ status: "needs_refresh" });

    const refreshed = await t.mutation(
      internal.dailyUsage.createDuePaygDrafts,
      { now: Date.UTC(2026, 8, 10) },
    );
    expect(refreshed.created).toBe(1);
    const afterRefresh = await t.run(async (ctx) => ({
      invoices: await ctx.db.query("invoices").collect(),
      runs: await ctx.db.query("billingAutomationRuns").collect(),
    }));
    expect(
      afterRefresh.invoices.map((invoice) => invoice.status).sort(),
    ).toEqual(["cancelled", "draft"]);
    expect(afterRefresh.runs).toHaveLength(3);

    const currentDraft = afterRefresh.invoices.find(
      (invoice) => invoice.status === "draft",
    )!;
    await ceo.mutation(api.invoices.issueInvoice, {
      invoiceId: currentDraft._id,
    });
    await ceo.mutation(api.invoices.voidInvoice, {
      invoiceId: currentDraft._id,
      reason: "Replace incorrect issued invoice",
    });
    const replacement = await ceo.mutation(
      api.dailyUsage.createDraftInvoiceFromRollup,
      { companyId: seeded.companyId, month: "2026-08" },
    );
    const replacementInvoice = await t.run((ctx) =>
      ctx.db.get(replacement.invoiceId),
    );
    expect(replacementInvoice?.replacesInvoiceId).toBe(currentDraft._id);
  });
});
