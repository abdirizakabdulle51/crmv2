import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { modules } from "./test.setup";
import { api } from "./_generated/api";
import { buildCloudAdvisorRecommendationKey } from "./cloudAdvisorKeys";

type ConvexTestCtx = Parameters<
  Parameters<ReturnType<typeof convexTest>["run"]>[0]
>[0];

async function seedQuoteCreateScope(ctx: ConvexTestCtx) {
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
  const catalogItemId = await ctx.db.insert("serviceCatalog", {
    serviceCategory: "ECS",
    itemName: "ECS Small",
    billingUnit: "per instance",
    monthlyPrice: 10,
  });
  const lineItem = {
    catalogItemId,
    itemName: "ECS Small",
    serviceCategory: "ECS",
    billingUnit: "per instance",
    quantity: 1,
    monthlyUnitPrice: 10,
    monthlyTotal: 10,
    yearlyTotal: 120,
  };
  return { companyId, lineItem };
}

type QuoteLineInput = Awaited<
  ReturnType<typeof seedQuoteCreateScope>
>["lineItem"] & {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};
function quoteLineInput(line: QuoteLineInput) {
  const {
    monthlyTotal: _monthlyTotal,
    yearlyTotal: _yearlyTotal,
    ...input
  } = line;
  return input;
}

describe("create", () => {
  it("atomically creates and links a real proposal opportunity when needed", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(seedQuoteCreateScope);
    const authed = t.withIdentity({ tokenIdentifier: "ceo-token" });

    const quoteId = await authed.mutation(api.quotes.create, {
      companyId: seed.companyId,
      opportunity: {
        title: "AICC cloud expansion",
        expectedCloseDate: "2026-10-15T00:00:00.000Z",
        contactName: "Finance Director",
        contactEmail: "finance@aicc.example",
      },
      lineItems: [quoteLineInput({ ...seed.lineItem, monthlyUnitPrice: 999 })],
    });

    const result = await t.run(async (ctx) => {
      const quote = await ctx.db.get(quoteId);
      const opportunity = quote?.leadId ? await ctx.db.get(quote.leadId) : null;
      const activities = opportunity
        ? await ctx.db
            .query("activities")
            .withIndex("by_lead", (q) => q.eq("leadId", opportunity._id))
            .collect()
        : [];
      return { quote, opportunity, activities };
    });

    expect(result.opportunity).toMatchObject({
      title: "AICC cloud expansion",
      stage: "proposal",
      potentialValue: 10,
      contactName: "Finance Director",
    });
    expect(result.opportunity?.opportunityNumber).toMatch(/^OPP-\d{4}-00001$/);
    expect(result.quote?.leadId).toBe(result.opportunity?._id);
    expect(result.activities).toEqual([
      expect.objectContaining({ type: "quote_created" }),
    ]);

    await authed.mutation(api.quotes.updateStatus, {
      id: quoteId,
      status: "sent",
    });
    const afterSend = await t.run(async (ctx) => {
      const opportunity = await ctx.db.get(result.opportunity!._id);
      const activities = await ctx.db
        .query("activities")
        .withIndex("by_lead", (q) => q.eq("leadId", result.opportunity!._id))
        .collect();
      return { opportunity, activities };
    });
    expect(afterSend.opportunity?.stage).toBe("negotiation");
    expect(afterSend.activities).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "quote_sent" })]),
    );
  });

  it("assigns friendly quote numbers to manual, usage, and advisor-created quotes", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(seedQuoteCreateScope);
    const authed = t.withIdentity({ tokenIdentifier: "ceo-token" });

    const manualQuoteId = await authed.mutation(api.quotes.create, {
      companyId: seed.companyId,
      lineItems: [quoteLineInput(seed.lineItem)],
      notes: "Manual quote",
    });
    const usageQuoteId = await authed.mutation(api.quotes.create, {
      companyId: seed.companyId,
      lineItems: [quoteLineInput(seed.lineItem)],
      notes: "Generated from Usage Tracking for 2026-08",
      sourceMonth: "2026-08",
    });
    const advisorQuoteId = await authed.mutation(api.quotes.create, {
      companyId: seed.companyId,
      lineItems: [quoteLineInput(seed.lineItem)],
      notes: "Cloud Advisor recommendation",
    });

    const quotes = await t.run(async (ctx) => {
      return {
        manual: await ctx.db.get(manualQuoteId),
        usage: await ctx.db.get(usageQuoteId),
        advisor: await ctx.db.get(advisorQuoteId),
      };
    });

    expect(quotes.manual?.quoteNumber).toMatch(/^Q-\d{4}-00001$/);
    expect(quotes.usage?.quoteNumber).toMatch(/^Q-\d{4}-00002$/);
    expect(quotes.advisor?.quoteNumber).toMatch(/^Q-\d{4}-00003$/);
  });
});

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
        regionId: "hoa-mog-2",
        regionName: "Hoa-Mogadishu-2",
        dataCenterName: "Mogadishu DC 2",
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
        regionId: "hoa-mog-2",
        regionName: "Hoa-Mogadishu-2",
        dataCenterName: "Mogadishu DC 2",
      },
      {
        catalogItemId: expect.any(String),
        itemName: "SSD (Block Storage / NVMe)",
        serviceCategory: "EVS",
        billingUnit: "per GB",
        quantity: 100,
        monthlyUnitPrice: 0.072,
        monthlyTotal: 7.2,
        yearlyTotal: 86.4,
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
    expect(preview.yearlyGrandTotal).toBe(146.4);
  });

  it("stores region metadata on created quote line items", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(seedQuoteCreateScope);
    const quoteId = await t
      .withIdentity({ tokenIdentifier: "ceo-token" })
      .mutation(api.quotes.create, {
        companyId: seed.companyId,
        lineItems: [
          quoteLineInput({
            ...seed.lineItem,
            regionId: "mog-hq3",
            regionName: "Mogadishu-region-hq3",
            dataCenterName: "HQ3",
          }),
        ],
      });

    const quote = await t.run(async (ctx) => await ctx.db.get(quoteId));

    expect(quote?.lineItems[0]).toMatchObject({
      regionId: "mog-hq3",
      regionName: "Mogadishu-region-hq3",
      dataCenterName: "HQ3",
    });
  });

  it("surfaces existing generated quote warning for the same company and source month only", async () => {
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
      const catalogItemId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "EIP",
        itemName: "EIP - Active",
        billingUnit: "per IP",
        monthlyPrice: 3,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "EIP",
        amount: 6,
        quantity: 2,
        catalogItemId,
      });
      const quoteId = await ctx.db.insert("quotes", {
        companyId,
        createdBy: userId,
        date: "2026-07-28",
        status: "draft",
        sourceMonth: "2026-07",
        lineItems: [
          {
            catalogItemId,
            itemName: "EIP - Active",
            serviceCategory: "EIP",
            billingUnit: "per IP",
            quantity: 2,
            monthlyUnitPrice: 3,
            monthlyTotal: 6,
            yearlyTotal: 72,
          },
        ],
        monthlyGrandTotal: 6,
        yearlyGrandTotal: 72,
      });

      return { companyId, quoteId };
    });

    const authed = t.withIdentity({ tokenIdentifier: "ceo-token" });
    const sameMonthPreview = await authed.query(
      api.quotes.buildQuotePreviewFromUsage,
      {
        companyId: seed.companyId,
        month: "2026-07",
      },
    );
    const differentMonthPreview = await authed.query(
      api.quotes.buildQuotePreviewFromUsage,
      {
        companyId: seed.companyId,
        month: "2026-08",
      },
    );

    expect(sameMonthPreview.existingQuote).toEqual({
      id: seed.quoteId,
      date: "2026-07-28",
      status: "draft",
    });
    expect(sameMonthPreview.lineItems).toHaveLength(1);
    expect(differentMonthPreview.existingQuote).toBeNull();
    expect(differentMonthPreview.lineItems).toHaveLength(0);
  });
});

describe("buildQuotePreviewFromAdvisor", () => {
  async function seedAdvisorCompany(ctx: ConvexTestCtx) {
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
      name: "Dahab Bank",
      sectorId,
      countryId,
      accountManagerId: userId,
      contractStatus: "active",
    });
    await ctx.db.insert("consumption", {
      companyId,
      month: "2026-07",
      serviceType: "ECS",
      amount: 100,
      quantity: 10,
    });
    const recommendationKey = buildCloudAdvisorRecommendationKey(
      companyId,
      "compliance",
      "CBH (Cloud Bastion Host)",
    );

    return { countryId, sectorId, userId, companyId, recommendationKey };
  }

  it("returns a matched catalog item and quote-safe line item preview for a unique flat-rate estimateCatalogItemName match", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(async (ctx) => {
      const seeded = await seedAdvisorCompany(ctx);
      const catalogItemId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "CBH",
        itemName: "Cloud Bastion Host",
        billingUnit: "flat fee",
        monthlyPrice: 120,
        yearlyPrice: 1200,
      });
      return { ...seeded, catalogItemId };
    });

    const preview = await t
      .withIdentity({ tokenIdentifier: "ceo-token" })
      .query(api.quotes.buildQuotePreviewFromAdvisor, {
        recommendationKey: seed.recommendationKey,
      });

    expect(preview).toMatchObject({
      companyId: seed.companyId,
      companyName: "Dahab Bank",
      recommendationKey: seed.recommendationKey,
      recommendedService: "CBH (Cloud Bastion Host)",
      sourceRule: "compliance",
      matchedCatalogItem: {
        catalogItemId: seed.catalogItemId,
        itemName: "Cloud Bastion Host",
        serviceCategory: "CBH",
        billingUnit: "flat fee",
        monthlyUnitPrice: 120,
      },
      lineItemPreview: {
        catalogItemId: seed.catalogItemId,
        itemName: "Cloud Bastion Host",
        serviceCategory: "CBH",
        billingUnit: "flat fee",
        quantity: 1,
        monthlyUnitPrice: 120,
        monthlyTotal: 120,
        yearlyTotal: 1200,
      },
      warnings: [],
    });
  });

  it("returns a warning and no line item when no catalog item matches", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(async (ctx) => seedAdvisorCompany(ctx));

    const preview = await t
      .withIdentity({ tokenIdentifier: "ceo-token" })
      .query(api.quotes.buildQuotePreviewFromAdvisor, {
        recommendationKey: seed.recommendationKey,
      });

    expect(preview.matchedCatalogItem).toBeUndefined();
    expect(preview.lineItemPreview).toBeUndefined();
    expect(preview.warnings).toEqual([
      'No service catalog item matched the recommendation recommended service "CBH (Cloud Bastion Host)".',
    ]);
  });

  it("returns a warning and no line item when catalog matching is ambiguous", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(async (ctx) => {
      const seeded = await seedAdvisorCompany(ctx);
      await ctx.db.insert("serviceCatalog", {
        serviceCategory: "CBH",
        itemName: "Cloud Bastion Host",
        billingUnit: "flat fee",
        monthlyPrice: 120,
      });
      await ctx.db.insert("serviceCatalog", {
        serviceCategory: "Security",
        itemName: "Cloud Bastion Host",
        billingUnit: "flat fee",
        monthlyPrice: 125,
      });
      return seeded;
    });

    const preview = await t
      .withIdentity({ tokenIdentifier: "ceo-token" })
      .query(api.quotes.buildQuotePreviewFromAdvisor, {
        recommendationKey: seed.recommendationKey,
      });

    expect(preview.matchedCatalogItem).toBeUndefined();
    expect(preview.lineItemPreview).toBeUndefined();
    expect(preview.warnings).toEqual([
      'Multiple service catalog items matched the recommendation estimate catalog item "Cloud Bastion Host"; select a catalog item manually.',
    ]);
  });

  it("does not turn a usage-based estimatedMonthlyValue into a line item without a quote-safe quantity", async () => {
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
      const ecsCatalogId = await ctx.db.insert("serviceCatalog", {
        serviceCategory: "ECS",
        itemName: "Elastic Cloud Server",
        billingUnit: "per instance",
        monthlyPrice: 10,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "ECS",
        amount: 200,
        quantity: 20,
        catalogItemId: ecsCatalogId,
      });
      await ctx.db.insert("consumption", {
        companyId,
        month: "2026-07",
        serviceType: "EVS",
        amount: 500,
        quantity: 5000,
      });
      await ctx.db.insert("serviceCatalog", {
        serviceCategory: "CSBS",
        itemName: "Cloud Server Backup Service",
        billingUnit: "per GB/month",
        monthlyPrice: 0.02,
      });
      return {
        recommendationKey: buildCloudAdvisorRecommendationKey(
          companyId,
          "backup",
          "CSBS or VBS (Cloud Backup)",
        ),
      };
    });

    const preview = await t
      .withIdentity({ tokenIdentifier: "ceo-token" })
      .query(api.quotes.buildQuotePreviewFromAdvisor, {
        recommendationKey: seed.recommendationKey,
      });

    expect(preview.estimatedMonthlyValue).toBe(100);
    expect(preview.matchedCatalogItem).toMatchObject({
      itemName: "Cloud Server Backup Service",
      monthlyUnitPrice: 0.02,
    });
    expect(preview.lineItemPreview).toBeUndefined();
    expect(preview.warnings).toEqual([
      "A service catalog item matched, but the recommendation does not expose a quote-safe quantity; review the quantity manually before creating a quote.",
    ]);
  });

  it("blocks users outside the recommendation company scope", async () => {
    const t = convexTest({ schema, modules });
    const seed = await t.run(async (ctx) => {
      const seeded = await seedAdvisorCompany(ctx);
      await ctx.db.insert("users", {
        tokenIdentifier: "other-am-token",
        name: "Other AM",
        role: "account_manager",
      });
      await ctx.db.insert("serviceCatalog", {
        serviceCategory: "CBH",
        itemName: "Cloud Bastion Host",
        billingUnit: "flat fee",
        monthlyPrice: 120,
      });
      return seeded;
    });

    await expect(
      t
        .withIdentity({ tokenIdentifier: "other-am-token" })
        .query(api.quotes.buildQuotePreviewFromAdvisor, {
          recommendationKey: seed.recommendationKey,
        }),
    ).rejects.toThrow();
  });
});
