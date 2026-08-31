import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { modules } from "./test.setup";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

type Seed = {
  countryA: Id<"countries">;
  countryB: Id<"countries">;
  sector: Id<"sectors">;
  ceo: Doc<"users">;
  hob: Doc<"users">;
  gmA: Doc<"users">;
  gmB: Doc<"users">;
  amA: Doc<"users">;
  amB: Doc<"users">;
  companyA: Id<"companies">;
  companyB: Id<"companies">;
  leadA: Id<"leads">;
  leadB: Id<"leads">;
  activityA: Id<"activities">;
  activityB: Id<"activities">;
  usageA: Id<"consumption">;
  usageB: Id<"consumption">;
  quoteA: Id<"quotes">;
  quoteB: Id<"quotes">;
  targetA: Id<"salesTargets">;
  targetB: Id<"salesTargets">;
};

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
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
      countryId: countryA,
    });
    const hobId = await ctx.db.insert("users", {
      name: "HOB",
      tokenIdentifier: "hob-token",
      role: "head_of_business",
      countryId: countryA,
    });
    const gmAId = await ctx.db.insert("users", {
      name: "GM A",
      tokenIdentifier: "gm-a-token",
      role: "country_gm",
      countryId: countryA,
    });
    const gmBId = await ctx.db.insert("users", {
      name: "GM B",
      tokenIdentifier: "gm-b-token",
      role: "country_gm",
      countryId: countryB,
    });
    const amAId = await ctx.db.insert("users", {
      name: "AM A",
      email: "ama@example.com",
      tokenIdentifier: "am-a-token",
      role: "account_manager",
      countryId: countryA,
    });
    const amBId = await ctx.db.insert("users", {
      name: "AM B",
      email: "amb@example.com",
      tokenIdentifier: "am-b-token",
      role: "account_manager",
      countryId: countryB,
    });

    const companyA = await ctx.db.insert("companies", {
      name: "Company A",
      sectorId: sector,
      countryId: countryA,
      accountManagerId: amAId,
      contractStatus: "active",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Company B",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amBId,
      contractStatus: "active",
    });
    const leadA = await ctx.db.insert("leads", {
      title: "Lead A",
      companyId: companyA,
      accountManagerId: amAId,
      stage: "new_lead",
      potentialValue: 100,
      expectedCloseDate: "2026-08-01",
    });
    const leadB = await ctx.db.insert("leads", {
      title: "Lead B",
      companyId: companyB,
      accountManagerId: amBId,
      stage: "new_lead",
      potentialValue: 100,
      expectedCloseDate: "2026-08-01",
    });
    const activityA = await ctx.db.insert("activities", {
      accountManagerId: amAId,
      leadId: leadA,
      type: "call",
      date: "2026-07-28",
    });
    const activityB = await ctx.db.insert("activities", {
      accountManagerId: amBId,
      leadId: leadB,
      type: "call",
      date: "2026-07-28",
    });
    const usageA = await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-07",
      serviceType: "ECS",
      amount: 10,
    });
    const usageB = await ctx.db.insert("consumption", {
      companyId: companyB,
      month: "2026-07",
      serviceType: "ECS",
      amount: 10,
    });
    const quoteLineItem = {
      catalogItemId: await ctx.db.insert("serviceCatalog", {
        serviceCategory: "EIP",
        itemName: "EIP - Active",
        billingUnit: "per IP",
        monthlyPrice: 3,
      }),
      itemName: "EIP - Active",
      serviceCategory: "EIP",
      billingUnit: "per IP",
      quantity: 1,
      monthlyUnitPrice: 3,
      monthlyTotal: 3,
      yearlyTotal: 36,
    };
    const quoteA = await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amBId,
      date: "2026-07-28",
      status: "draft",
      lineItems: [quoteLineItem],
      monthlyGrandTotal: 3,
      yearlyGrandTotal: 36,
    });
    const quoteB = await ctx.db.insert("quotes", {
      companyId: companyB,
      createdBy: amAId,
      date: "2026-07-28",
      status: "draft",
      lineItems: [quoteLineItem],
      monthlyGrandTotal: 3,
      yearlyGrandTotal: 36,
    });
    const targetA = await ctx.db.insert("salesTargets", {
      accountManagerId: amAId,
      year: 2026,
      quarter: 1,
      target: 1000,
    });
    const targetB = await ctx.db.insert("salesTargets", {
      accountManagerId: amBId,
      year: 2026,
      quarter: 1,
      target: 1000,
    });

    return {
      countryA,
      countryB,
      sector,
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gmA: (await ctx.db.get(gmAId))!,
      gmB: (await ctx.db.get(gmBId))!,
      amA: (await ctx.db.get(amAId))!,
      amB: (await ctx.db.get(amBId))!,
      companyA,
      companyB,
      leadA,
      leadB,
      activityA,
      activityB,
      usageA,
      usageB,
      quoteA,
      quoteB,
      targetA,
      targetB,
    };
  });
}

describe("role scoping", () => {
  it("enforces company permissions for AM, GM, HOB, and CEO", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    await asUser(t, s.amA).query(api.companies.getById, { id: s.companyA });
    await expect(
      asUser(t, s.amA).query(api.companies.getById, { id: s.companyB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).mutation(api.companies.update, {
      id: s.companyA,
      name: "Company A Updated",
      sectorId: s.sector,
      countryId: s.countryA,
      accountManagerId: s.amA._id,
      contractStatus: "active",
    });
    await expect(
      asUser(t, s.gmA).mutation(api.companies.update, {
        id: s.companyB,
        name: "Nope",
        sectorId: s.sector,
        countryId: s.countryB,
        accountManagerId: s.amB._id,
        contractStatus: "active",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.hob).query(api.companies.getById, { id: s.companyB });
    await asUser(t, s.ceo).query(api.companies.getById, { id: s.companyB });
  });

  it("enforces company delete permissions for AM and GM scope", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    const amCompany = await asUser(t, s.amA).mutation(api.companies.create, {
      name: "AM deletable",
      sectorId: s.sector,
      countryId: s.countryA,
      accountManagerId: s.amA._id,
      contractStatus: "active",
    });
    await asUser(t, s.amA).mutation(api.companies.remove, { id: amCompany });
    await expect(
      asUser(t, s.amA).mutation(api.companies.remove, { id: s.companyB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);

    const gmCompany = await asUser(t, s.gmA).mutation(api.companies.create, {
      name: "GM deletable",
      sectorId: s.sector,
      countryId: s.countryA,
      accountManagerId: s.amA._id,
      contractStatus: "active",
    });
    await asUser(t, s.gmA).mutation(api.companies.remove, { id: gmCompany });
    await expect(
      asUser(t, s.gmA).mutation(api.companies.remove, { id: s.companyB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("enforces lead and activity permissions", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    await asUser(t, s.amA).mutation(api.leads.updateStage, {
      id: s.leadA,
      stage: "qualified",
    });
    await expect(
      asUser(t, s.amA).mutation(api.leads.updateStage, {
        id: s.leadB,
        stage: "qualified",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).query(api.activities.listByLead, {
      leadId: s.leadA,
    });
    await expect(
      asUser(t, s.gmA).query(api.activities.listByLead, { leadId: s.leadB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.hob).mutation(api.activities.create, {
      leadId: s.leadB,
      type: "meeting",
      date: "2026-07-28",
    });
    await asUser(t, s.ceo).mutation(api.activities.create, {
      leadId: s.leadB,
      type: "meeting",
      date: "2026-07-28",
    });
  });

  it("enforces lead delete and activity create/delete denial outside scope", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    const amLead = await asUser(t, s.amA).mutation(api.leads.create, {
      title: "AM deletable lead",
      companyId: s.companyA,
      accountManagerId: s.amA._id,
      stage: "new_lead",
      potentialValue: 100,
      expectedCloseDate: "2026-09-01",
    });
    await asUser(t, s.amA).mutation(api.leads.remove, { id: amLead });
    await expect(
      asUser(t, s.amA).mutation(api.leads.remove, { id: s.leadB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);

    const gmLead = await asUser(t, s.gmA).mutation(api.leads.create, {
      title: "GM deletable lead",
      companyId: s.companyA,
      accountManagerId: s.amA._id,
      stage: "new_lead",
      potentialValue: 100,
      expectedCloseDate: "2026-09-01",
    });
    await asUser(t, s.gmA).mutation(api.leads.remove, { id: gmLead });
    await expect(
      asUser(t, s.gmA).mutation(api.leads.remove, { id: s.leadB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);

    await expect(
      asUser(t, s.amA).mutation(api.activities.create, {
        leadId: s.leadB,
        type: "call",
        date: "2026-07-28",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.activities.create, {
        leadId: s.leadB,
        type: "call",
        date: "2026-07-28",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.amA).mutation(api.activities.remove, { id: s.activityA });
    await expect(
      asUser(t, s.amA).mutation(api.activities.remove, { id: s.activityB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.activities.remove, { id: s.activityB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("enforces usage and target permissions", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    await asUser(t, s.amA).mutation(api.consumption.create, {
      companyId: s.companyA,
      month: "2026-08",
      serviceType: "SFS",
      amount: 20,
    });
    await expect(
      asUser(t, s.amA).mutation(api.consumption.create, {
        companyId: s.companyB,
        month: "2026-08",
        serviceType: "SFS",
        amount: 20,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).mutation(api.consumption.remove, { id: s.usageA });
    await expect(
      asUser(t, s.gmA).mutation(api.consumption.remove, { id: s.usageB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).mutation(api.salesTargets.upsert, {
      accountManagerId: s.amA._id,
      year: 2026,
      quarter: 2,
      target: 2000,
    });
    await expect(
      asUser(t, s.gmA).mutation(api.salesTargets.upsert, {
        accountManagerId: s.amB._id,
        year: 2026,
        quarter: 2,
        target: 2000,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.amA).mutation(api.salesTargets.remove, { id: s.targetA }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.hob).mutation(api.salesTargets.remove, { id: s.targetB });
  });

  it("enforces ManageOne bulk usage create scope", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);
    const catalogItemId = await t.run(async (ctx) => {
      return await ctx.db.insert("serviceCatalog", {
        serviceCategory: "EIP",
        itemName: "EIP - Active",
        billingUnit: "per IP",
        monthlyPrice: 3,
      });
    });

    const result = await asUser(t, s.amA).mutation(
      api.consumption.bulkCreateFromManageOne,
      {
        companyId: s.companyA,
        month: "2026-09",
        rows: [
          {
            serviceType: "EIP",
            catalogItemId,
            quantity: 2,
            regionId: "hoa-mog-2",
            regionName: "Hoa-Mogadishu-2",
            dataCenterName: "Mogadishu DC 2",
          },
        ],
      },
    );
    expect(result.inserted).toBe(1);
    const insertedRows = await t.run(async (ctx) => {
      return await ctx.db
        .query("consumption")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", s.companyA).eq("month", "2026-09"),
        )
        .collect();
    });
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      companyId: s.companyA,
      month: "2026-09",
      serviceType: "EIP",
      catalogItemId,
      quantity: 2,
      amount: 6,
      isManualOverride: false,
      regionId: "hoa-mog-2",
      regionName: "Hoa-Mogadishu-2",
      dataCenterName: "Mogadishu DC 2",
    });

    await expect(
      asUser(t, s.amA).mutation(api.consumption.bulkCreateFromManageOne, {
        companyId: s.companyB,
        month: "2026-09",
        rows: [
          {
            serviceType: "EIP",
            catalogItemId,
            quantity: 2,
          },
        ],
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("enforces quote company scope for list, view, status updates, and delete", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    const amQuotes = await asUser(t, s.amA).query(api.quotes.list, {});
    expect(amQuotes.map((quote) => quote._id)).toContain(s.quoteA);
    expect(amQuotes.map((quote) => quote._id)).not.toContain(s.quoteB);
    await asUser(t, s.amA).query(api.quotes.getById, { id: s.quoteA });
    await expect(
      asUser(t, s.amA).query(api.quotes.getById, { id: s.quoteB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).mutation(api.quotes.updateStatus, {
      id: s.quoteA,
      status: "sent",
    });
    await expect(
      asUser(t, s.gmA).mutation(api.quotes.updateStatus, {
        id: s.quoteB,
        status: "sent",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).mutation(api.quotes.updateStatus, {
      id: s.quoteA,
      status: "draft",
    });
    const adminQuotes = await asUser(t, s.hob).query(api.quotes.list, {});
    expect(adminQuotes.map((quote) => quote._id)).toEqual(
      expect.arrayContaining([s.quoteA, s.quoteB]),
    );
    await asUser(t, s.amA).mutation(api.quotes.remove, { id: s.quoteA });
    await expect(
      asUser(t, s.amA).mutation(api.quotes.remove, { id: s.quoteB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("denies out-of-scope quote preview from usage", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    await asUser(t, s.amA).query(api.quotes.buildQuotePreviewFromUsage, {
      companyId: s.companyA,
      month: "2026-07",
    });
    await expect(
      asUser(t, s.amA).query(api.quotes.buildQuotePreviewFromUsage, {
        companyId: s.companyB,
        month: "2026-07",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("enforces consumption listByCompany and GM target removal scope", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    await asUser(t, s.amA).query(api.consumption.listByCompany, {
      companyId: s.companyA,
    });
    await expect(
      asUser(t, s.amA).query(api.consumption.listByCompany, {
        companyId: s.companyB,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).query(api.consumption.listByCompany, {
      companyId: s.companyA,
    });
    await expect(
      asUser(t, s.gmA).query(api.consumption.listByCompany, {
        companyId: s.companyB,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);

    await asUser(t, s.gmA).mutation(api.salesTargets.remove, { id: s.targetA });
    await expect(
      asUser(t, s.gmA).mutation(api.salesTargets.remove, { id: s.targetB }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("enforces Country GM team-management limits and admin unrestricted access", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    const gmVisibleUsers = await asUser(t, s.gmA).query(api.users.listAll, {});
    expect(gmVisibleUsers.map((user) => user._id)).toEqual(
      expect.arrayContaining([s.gmA._id, s.amA._id]),
    );
    expect(gmVisibleUsers.map((user) => user._id)).not.toContain(s.amB._id);

    await asUser(t, s.gmA).mutation(api.users.updateRole, {
      userId: s.amA._id,
      role: "account_manager",
    });
    await expect(
      asUser(t, s.gmA).mutation(api.users.updateRole, {
        userId: s.amA._id,
        role: "country_gm",
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.users.assignCountry, {
        userId: s.amB._id,
        countryId: s.countryA,
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.auth.disableTeamMember, {
        userId: s.gmB._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await asUser(t, s.gmA).mutation(api.auth.disableTeamMember, {
      userId: s.amA._id,
    });
    await asUser(t, s.hob).mutation(api.auth.reenableTeamMember, {
      userId: s.amA._id,
    });
    await asUser(t, s.ceo).mutation(api.users.assignCountry, {
      userId: s.amB._id,
      countryId: s.countryA,
    });
  });

  it("enforces Country GM team creation, reset, and delete boundaries", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    const created = await asUser(t, s.gmA).action(api.auth.createTeamMember, {
      name: "New AM A",
      email: "new-am-a@example.com",
      password: "Temporary123!",
      role: "account_manager",
      countryId: s.countryA,
    });
    await expect(
      asUser(t, s.gmA).action(api.auth.createTeamMember, {
        name: "Outside AM",
        email: "outside-am@example.com",
        password: "Temporary123!",
        role: "account_manager",
        countryId: s.countryB,
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).action(api.auth.createTeamMember, {
        name: "Global AM",
        email: "global-am@example.com",
        password: "Temporary123!",
        role: "account_manager",
        countryId: s.countryA,
        organizationScope: "global",
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).action(api.auth.createTeamMember, {
        name: "Promoted",
        email: "promoted@example.com",
        password: "Temporary123!",
        role: "country_gm",
        countryId: s.countryA,
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);

    await asUser(t, s.gmA).action(api.auth.resetTeamMemberPassword, {
      userId: created.userId,
    });
    await expect(
      asUser(t, s.gmA).action(api.auth.resetTeamMemberPassword, {
        userId: s.amB._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).action(api.auth.resetTeamMemberPassword, {
        userId: s.gmB._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).action(api.auth.resetTeamMemberPassword, {
        userId: s.hob._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).action(api.auth.resetTeamMemberPassword, {
        userId: s.ceo._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);

    await asUser(t, s.gmA).mutation(api.auth.deleteTeamMember, {
      userId: created.userId,
    });
    await expect(
      asUser(t, s.gmA).mutation(api.auth.deleteTeamMember, {
        userId: s.gmB._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.auth.deleteTeamMember, {
        userId: s.hob._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.auth.deleteTeamMember, {
        userId: s.ceo._id,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("blocks Country GM access to HOB/CEO accounts and self role/country changes", async () => {
    const t = convexTest({ schema, modules });
    const s = await seed(t);

    const gmVisibleUsers = await asUser(t, s.gmA).query(api.users.listAll, {});
    expect(gmVisibleUsers.map((user) => user._id)).not.toContain(s.hob._id);
    expect(gmVisibleUsers.map((user) => user._id)).not.toContain(s.ceo._id);

    for (const target of [s.hob, s.ceo]) {
      await expect(
        asUser(t, s.gmA).mutation(api.users.updateRole, {
          userId: target._id,
          role: "account_manager",
        }),
      ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
      await expect(
        asUser(t, s.gmA).mutation(api.users.assignCountry, {
          userId: target._id,
          countryId: s.countryA,
        }),
      ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
      await expect(
        asUser(t, s.gmA).mutation(api.auth.disableTeamMember, {
          userId: target._id,
        }),
      ).rejects.toThrow(/permission|FORBIDDEN/i);
      await expect(
        asUser(t, s.gmA).mutation(api.auth.deleteTeamMember, {
          userId: target._id,
        }),
      ).rejects.toThrow(/permission|FORBIDDEN/i);
    }

    await expect(
      asUser(t, s.gmA).mutation(api.users.updateRole, {
        userId: s.gmA._id,
        role: "account_manager",
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.users.assignCountry, {
        userId: s.gmA._id,
        countryId: s.countryB,
      }),
    ).rejects.toThrow(/Country GMs|FORBIDDEN/i);
  });
});
