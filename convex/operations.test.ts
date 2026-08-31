import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { modules } from "./test.setup";
import { api, internal } from "./_generated/api";

async function seed() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    const countryId = await ctx.db.insert("countries", { name: "Somalia", region: "East Africa" });
    const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "ceo-token",
      name: "CEO",
      role: "ceo",
    });
    const companyId = await ctx.db.insert("companies", {
      name: "Won Prospect",
      normalizedName: "won prospect",
      countryId,
      sectorId,
      accountManagerId: userId,
      lifecycleStatus: "prospect",
      contractStatus: "pending",
    });
    const leadId = await ctx.db.insert("leads", {
      title: "Cloud opportunity",
      companyId,
      accountManagerId: userId,
      stage: "won",
      potentialValue: 5000,
      expectedCloseDate: "2026-10-01T00:00:00.000Z",
    });
    return { leadId };
  });
  return { t, ...ids, authed: t.withIdentity({ tokenIdentifier: "ceo-token" }) };
}

describe("operations health", () => {
  it("surfaces incomplete won onboarding as a high-priority exception", async () => {
    const s = await seed();
    const result = await s.authed.query(api.operations.healthOverview, {});
    expect(result.summary).toMatchObject({ openIssues: 1, highIssues: 1, onboardingPending: 1 });
    expect(result.onboarding[0]).toMatchObject({ leadId: s.leadId, complete: false });
  });

  it("records scheduled billing runs even when there are no due contracts", async () => {
    const s = await seed();
    const result = await s.t.mutation(internal.invoices.createDueContractDrafts, { now: Date.now() });
    expect(result).toMatchObject({ contractsScanned: 0, created: 0, skipped: 0 });
    const health = await s.authed.query(api.operations.healthOverview, {});
    expect(health.billingRuns[0]).toMatchObject({ status: "completed", trigger: "scheduled" });
  });
});
