import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const countryA = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const countryB = await ctx.db.insert("countries", {
      name: "Kenya",
      region: "East Africa",
    });
    const sector = await ctx.db.insert("sectors", { name: "Banking" });
    const ceoId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "ceo-token",
      role: "ceo",
    });
    const amAId = await ctx.db.insert("users", {
      name: "AM A",
      tokenIdentifier: "am-a-token",
      role: "account_manager",
      countryId: countryA,
    });
    const amBId = await ctx.db.insert("users", {
      name: "AM B",
      tokenIdentifier: "am-b-token",
      role: "account_manager",
      countryId: countryB,
    });
    const companyA = await ctx.db.insert("companies", {
      name: "AICC",
      sectorId: sector,
      countryId: countryA,
      accountManagerId: amAId,
      contractStatus: "active",
      paymentStatus: "overdue",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Safari",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amBId,
      contractStatus: "active",
    });

    await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-05",
      serviceType: "ECS",
      amount: 100,
      quantity: 2,
    });
    await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-06",
      serviceType: "ECS",
      amount: 140,
      quantity: 3,
    });
    await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-07",
      serviceType: "ECS",
      amount: 200,
      quantity: 4,
    });
    await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-07",
      serviceType: "EVS",
      amount: 120,
      quantity: 5000,
    });
    await ctx.db.insert("consumption", {
      companyId: companyB,
      month: "2026-07",
      serviceType: "EVS",
      amount: 50,
      quantity: 1000,
    });
    await ctx.db.insert("serviceCatalog", {
      serviceCategory: "CSBS",
      itemName: "Cloud Backup",
      billingUnit: "GB/month",
      monthlyPrice: 0.02,
    });
    await ctx.db.insert("serviceCatalog", {
      serviceCategory: "VPN",
      itemName: "VPN Connection",
      billingUnit: "connection",
      monthlyPrice: 30,
    });
    await ctx.db.insert("serviceCatalog", {
      serviceCategory: "CBH",
      itemName: "Cloud Bastion Host",
      billingUnit: "instance",
      monthlyPrice: 10,
    });
    await ctx.db.insert("manageOneTenants", {
      vdcId: "vdc-a",
      name: "AICC VDC",
      ecsUsed: 3,
      evsUsed: 500,
      projectCount: 2,
      resources: [{ serviceId: "ecs", resource: "instances", used: 3 }],
      lastSyncedAt: 1,
      linkedCompanyId: companyA,
    });

    return {
      ceo: (await ctx.db.get(ceoId))!,
      amA: (await ctx.db.get(amAId))!,
      amB: (await ctx.db.get(amBId))!,
      companyA,
      companyB,
    };
  });
}

async function getAiccBackupRecommendation(
  t: ReturnType<typeof convexTest>,
  user: Doc<"users">,
) {
  const recommendations = await asUser(t, user).query(
    api.recommendations.listComputed,
    {},
  );
  const recommendation = recommendations.find(
    (rec) => rec.companyName === "AICC" && rec.rule === "backup",
  );
  expect(recommendation).toBeDefined();
  return recommendation!;
}

describe("recommendations", () => {
  it("computes deterministic recommendations server-side with RBAC scoping", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const ceoRecommendations = await asUser(t, seeded.ceo).query(
      api.recommendations.listComputed,
      {},
    );
    expect(ceoRecommendations.map((rec) => rec.companyName)).toContain("AICC");
    expect(ceoRecommendations.map((rec) => rec.companyName)).toContain(
      "Safari",
    );
    expect(
      ceoRecommendations.filter((rec) => rec.companyName === "AICC"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "backup",
          priority: "high",
          status: "open",
          triggerReason:
            "Uses ECS compute but has no backup service (CSBS/VBS)",
          estimatedMonthlyValue: 100,
          estimatedValue: "Estimated upsell: ~$100.00/month",
          estimateBasis:
            "5,000 GB protected storage (2026-07) x $0.020/GB/month",
        }),
        expect.objectContaining({
          rule: "payment_risk",
          priority: "high",
        }),
        expect.objectContaining({
          rule: "compliance",
          priority: "high",
        }),
      ]),
    );

    const amRecommendations = await asUser(t, seeded.amA).query(
      api.recommendations.listComputed,
      {},
    );
    expect(new Set(amRecommendations.map((rec) => rec.companyName))).toEqual(
      new Set(["AICC"]),
    );
  });

  it("derives open status when no Cloud Advisor overlay exists", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    expect(recommendation).toMatchObject({
      status: "open",
      companyId: seeded.companyA,
      rule: "backup",
    });
    expect(recommendation.recommendationKey).toContain(
      `${seeded.companyA}:backup:`,
    );
    expect("statusUpdatedAt" in recommendation).toBe(false);
  });

  it("merges acknowledged Cloud Advisor overlays onto computed recommendations", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    await asUser(t, seeded.amA).mutation(
      api.cloudAdvisorStatuses.setRecommendationStatus,
      {
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status: "acknowledged",
      },
    );

    const updated = await getAiccBackupRecommendation(t, seeded.ceo);
    expect(updated).toMatchObject({
      recommendationKey: recommendation.recommendationKey,
      status: "acknowledged",
      statusUpdatedAt: expect.any(Number),
    });
  });

  it("stores dismissed and resolved overlays as returned statuses", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    await asUser(t, seeded.ceo).mutation(
      api.cloudAdvisorStatuses.setRecommendationStatus,
      {
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status: "dismissed",
      },
    );
    expect(await getAiccBackupRecommendation(t, seeded.ceo)).toMatchObject({
      status: "dismissed",
    });

    await asUser(t, seeded.ceo).mutation(
      api.cloudAdvisorStatuses.setRecommendationStatus,
      {
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status: "resolved",
      },
    );
    expect(await getAiccBackupRecommendation(t, seeded.ceo)).toMatchObject({
      status: "resolved",
    });
  });

  it("stores trims and clears Cloud Advisor status notes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    await asUser(t, seeded.ceo).mutation(
      api.cloudAdvisorStatuses.setRecommendationStatus,
      {
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status: "acknowledged",
        note: "  Waiting for customer confirmation.  ",
      },
    );
    expect(await getAiccBackupRecommendation(t, seeded.ceo)).toMatchObject({
      status: "acknowledged",
      note: "Waiting for customer confirmation.",
    });

    await asUser(t, seeded.ceo).mutation(
      api.cloudAdvisorStatuses.setRecommendationStatus,
      {
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status: "acknowledged",
        note: "   ",
      },
    );
    expect("note" in (await getAiccBackupRecommendation(t, seeded.ceo))).toBe(
      false,
    );
  });

  it("rejects Cloud Advisor status notes longer than 300 characters", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    await expect(
      asUser(t, seeded.ceo).mutation(
        api.cloudAdvisorStatuses.setRecommendationStatus,
        {
          recommendationKey: recommendation.recommendationKey,
          companyId: recommendation.companyId,
          rule: recommendation.rule,
          recommendedService: recommendation.recommendedService,
          status: "acknowledged",
          note: "x".repeat(301),
        },
      ),
    ).rejects.toThrow(/300/);
  });

  it("reopens recommendations by deleting the overlay", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    await asUser(t, seeded.ceo).mutation(
      api.cloudAdvisorStatuses.setRecommendationStatus,
      {
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status: "acknowledged",
      },
    );
    await asUser(t, seeded.ceo).mutation(
      api.cloudAdvisorStatuses.reopenRecommendation,
      {
        recommendationKey: recommendation.recommendationKey,
      },
    );

    const reopened = await getAiccBackupRecommendation(t, seeded.ceo);
    expect(reopened.status).toBe("open");
    expect("statusUpdatedAt" in reopened).toBe(false);
  });

  it("enforces company RBAC when setting Cloud Advisor status", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const recommendation = await getAiccBackupRecommendation(t, seeded.ceo);

    await expect(
      asUser(t, seeded.amB).mutation(
        api.cloudAdvisorStatuses.setRecommendationStatus,
        {
          recommendationKey: recommendation.recommendationKey,
          companyId: recommendation.companyId,
          rule: recommendation.rule,
          recommendedService: recommendation.recommendedService,
          status: "acknowledged",
        },
      ),
    ).rejects.toThrow(/permission/i);
  });

  it("returns compact all-company context for the external AI generation job", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    const context = await t.query(
      internal.recommendations.listContextForSync,
      {},
    );

    const aicc = context.find((company) => company.companyName === "AICC");
    expect(aicc).toMatchObject({
      companyName: "AICC",
      sectorName: "Banking",
      usageSummary: {
        serviceTypes: ["ECS", "EVS"],
      },
      manageOneTenants: [
        expect.objectContaining({
          name: "AICC VDC",
          ecsUsed: 3,
          evsUsed: 500,
          projectCount: 2,
        }),
      ],
    });
    expect(aicc?.recommendations.length).toBeGreaterThan(0);
  });

  it("stores AI narratives by company and only lists rows visible to the user", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const ruleSnapshot = await asUser(t, seeded.ceo).query(
      api.recommendations.listComputed,
      {},
    );
    const aiRuleSnapshot = ruleSnapshot.map(
      ({
        recommendationKey: _recommendationKey,
        status: _status,
        statusUpdatedAt: _statusUpdatedAt,
        snoozedUntil: _snoozedUntil,
        note: _note,
        ...recommendation
      }) => recommendation,
    );

    await t.mutation(internal.aiRecommendations.bulkUpsert, {
      items: [
        {
          companyId: seeded.companyA,
          narrative: "AICC should prioritize backup and secure connectivity.",
          topPriority: "backup",
          ruleSnapshot: aiRuleSnapshot.filter(
            (rec) => rec.companyId === seeded.companyA,
          ),
          generatedAt: Date.UTC(2026, 6, 29),
          model: "gpt-test",
        },
        {
          companyId: seeded.companyB,
          narrative: "Hidden narrative",
          ruleSnapshot: [],
          generatedAt: Date.UTC(2026, 6, 29),
          model: "gpt-test",
        },
      ],
    });

    const visibleRows = await asUser(t, seeded.amA).query(
      api.aiRecommendations.listVisible,
      {},
    );
    expect(visibleRows).toHaveLength(1);
    expect(visibleRows[0]).toMatchObject({
      companyId: seeded.companyA,
      narrative: "AICC should prioritize backup and secure connectivity.",
      topPriority: "backup",
      model: "gpt-test",
    });
  });
});
