import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { modules } from "./test.setup";
import { api } from "./_generated/api";

async function seed() {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    const countryId = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "ceo-token",
      name: "CEO",
      role: "ceo",
    });
    return { countryId, sectorId, userId };
  });
  return {
    t,
    ...ids,
    authed: t.withIdentity({ tokenIdentifier: "ceo-token" }),
  };
}

describe("guided opportunity lifecycle", () => {
  it("atomically creates the prospect and prepares proposal", async () => {
    const s = await seed();
    const leadId = await s.authed.mutation(api.leads.create, {
      title: "Atomic proposal",
      accountManagerId: s.userId,
      stage: "discovery",
      potentialValue: 3000,
      expectedCloseDate: "2026-11-01T00:00:00.000Z",
      contactName: "Ali Hassan",
    });
    const companyId = await s.authed.mutation(api.leads.prepareProposal, {
      leadId,
      newCompany: {
        name: "Atomic Prospect",
        countryId: s.countryId,
        sectorId: s.sectorId,
      },
    });
    const result = await s.t.run(async (ctx) => ({
      lead: await ctx.db.get(leadId),
      company: await ctx.db.get(companyId),
    }));
    expect(result.lead).toMatchObject({ companyId, stage: "proposal" });
    expect(result.company).toMatchObject({
      normalizedName: "atomic prospect",
      lifecycleStatus: "prospect",
      contactName: "Ali Hassan",
    });
  });

  it("creates a minimal prospect from the opportunity contact and links it", async () => {
    const s = await seed();
    const leadId = await s.authed.mutation(api.leads.create, {
      title: "New cloud prospect",
      accountManagerId: s.userId,
      stage: "discovery",
      potentialValue: 2000,
      expectedCloseDate: "2026-10-01T00:00:00.000Z",
      contactName: "Asha Noor",
      contactEmail: "asha@example.com",
    });
    const companyId = await s.authed.mutation(api.leads.createProspectCompany, {
      leadId,
      name: "Prospect Ltd",
      countryId: s.countryId,
      sectorId: s.sectorId,
    });
    const result = await s.t.run(async (ctx) => ({
      company: await ctx.db.get(companyId),
      lead: await ctx.db.get(leadId),
    }));
    expect(result.company).toMatchObject({
      name: "Prospect Ltd",
      lifecycleStatus: "prospect",
      contactName: "Asha Noor",
      contactEmail: "asha@example.com",
    });
    expect(result.lead?.companyId).toBe(companyId);
  });

  it("does not mark an established customer lost when one opportunity is lost", async () => {
    const s = await seed();
    const companyId = await s.t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Existing Customer",
        sectorId: s.sectorId,
        countryId: s.countryId,
        accountManagerId: s.userId,
        contractStatus: "active",
        lifecycleStatus: "customer",
      }),
    );
    const leadId = await s.authed.mutation(api.leads.create, {
      title: "Expansion",
      companyId,
      accountManagerId: s.userId,
      stage: "discovery",
      potentialValue: 1000,
      expectedCloseDate: "2026-10-01T00:00:00.000Z",
    });
    await s.authed.mutation(api.leads.updateStage, {
      id: leadId,
      stage: "lost",
      lossReason: "Budget postponed",
    });
    const company = await s.t.run((ctx) => ctx.db.get(companyId));
    expect(company?.lifecycleStatus).toBe("customer");
    expect(company?.lostReason).toBeUndefined();
  });

  it("keeps a company prospect while another opportunity remains open", async () => {
    const s = await seed();
    const companyId = await s.t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Multi Deal Prospect",
        sectorId: s.sectorId,
        countryId: s.countryId,
        accountManagerId: s.userId,
        contractStatus: "pending",
        lifecycleStatus: "prospect",
      }),
    );
    const createLead = (title: string) =>
      s.authed.mutation(api.leads.create, {
        title,
        companyId,
        accountManagerId: s.userId,
        stage: "discovery",
        potentialValue: 1000,
        expectedCloseDate: "2026-10-01T00:00:00.000Z",
      });
    const lostLeadId = await createLead("Deal one");
    await createLead("Deal two");
    await s.authed.mutation(api.leads.updateStage, {
      id: lostLeadId,
      stage: "lost",
      lossReason: "Chose another solution",
    });
    const company = await s.t.run((ctx) => ctx.db.get(companyId));
    expect(company?.lifecycleStatus).toBe("prospect");
    expect(company?.lostReason).toBeUndefined();
  });

  it("accepts the explicitly selected quote and wins in one mutation", async () => {
    const s = await seed();
    const companyId = await s.t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Winning Prospect",
        normalizedName: "winning prospect",
        sectorId: s.sectorId,
        countryId: s.countryId,
        accountManagerId: s.userId,
        contractStatus: "pending",
        lifecycleStatus: "prospect",
      }),
    );
    const leadId = await s.authed.mutation(api.leads.create, {
      title: "Winning deal",
      companyId,
      accountManagerId: s.userId,
      stage: "proposal",
      potentialValue: 5000,
      expectedCloseDate: "2026-11-01T00:00:00.000Z",
    });
    const quoteId = await s.t.run((ctx) =>
      ctx.db.insert("quotes", {
        companyId,
        leadId,
        commercialModel: "contracted",
        createdBy: s.userId,
        quoteNumber: "Q-TEST-1",
        date: "2026-09-01",
        status: "sent",
        lineItems: [],
        monthlyGrandTotal: 5000,
        yearlyGrandTotal: 60000,
      }),
    );
    await s.authed.mutation(api.leads.acceptQuoteAndWin, {
      leadId,
      quoteId,
      acceptedByContact: "Finance Director",
    });
    const result = await s.t.run(async (ctx) => ({
      lead: await ctx.db.get(leadId),
      quote: await ctx.db.get(quoteId),
      company: await ctx.db.get(companyId),
    }));
    expect(result.lead?.stage).toBe("won");
    expect(result.quote).toMatchObject({
      status: "accepted",
      acceptedByContact: "Finance Director",
      acceptedAt: expect.any(Number),
    });
    expect(result.company).toMatchObject({
      lifecycleStatus: "customer",
      commercialModel: "contracted",
    });
  });

  it("reconciles lifecycle after the last lost opportunity is removed", async () => {
    const s = await seed();
    const companyId = await s.t.run((ctx) =>
      ctx.db.insert("companies", {
        name: "Reopened Prospect",
        sectorId: s.sectorId,
        countryId: s.countryId,
        accountManagerId: s.userId,
        contractStatus: "pending",
        lifecycleStatus: "prospect",
      }),
    );
    const leadId = await s.authed.mutation(api.leads.create, {
      title: "Lost deal",
      companyId,
      accountManagerId: s.userId,
      stage: "discovery",
      potentialValue: 1000,
      expectedCloseDate: "2026-11-01T00:00:00.000Z",
    });
    await s.authed.mutation(api.leads.updateStage, {
      id: leadId,
      stage: "lost",
      lossReason: "No budget",
    });
    await s.authed.mutation(api.leads.remove, { id: leadId });
    const company = await s.t.run((ctx) => ctx.db.get(companyId));
    expect(company).toMatchObject({ lifecycleStatus: "prospect" });
    expect(company?.lostReason).toBeUndefined();
  });
});
