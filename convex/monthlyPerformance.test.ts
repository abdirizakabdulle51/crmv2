import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const countryId = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const otherCountryId = await ctx.db.insert("countries", {
      name: "Kenya",
      region: "East Africa",
    });
    const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
    const createUser = async (
      tokenIdentifier: string,
      role: Doc<"users">["role"],
      country?: Id<"countries">,
    ) => {
      const id = await ctx.db.insert("users", {
        name: tokenIdentifier,
        tokenIdentifier,
        role,
        countryId: country,
      });
      return (await ctx.db.get(id))!;
    };
    const ceo = await createUser("ceo", "ceo");
    const gm = await createUser("gm", "country_gm", countryId);
    const otherGm = await createUser("other-gm", "country_gm", otherCountryId);
    const am = await createUser("am", "account_manager", countryId);
    const companyId = await ctx.db.insert("companies", {
      name: "Customer A",
      sectorId,
      countryId,
      accountManagerId: am._id,
      contractStatus: "active",
    });
    return { countryId, ceo, gm, otherGm, am, companyId };
  });
}

async function insertInvoice(
  t: ReturnType<typeof convexTest>,
  seed: Awaited<ReturnType<typeof seed>>,
  values: Partial<Doc<"invoices">> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("invoices", {
      companyId: seed.companyId,
      createdBy: seed.ceo._id,
      status: "issued",
      invoiceNumber: `INV-${Math.random()}`,
      companyName: "Customer A",
      lineItems: [],
      subtotal: 600,
      monthlyTotal: 600,
      yearlyTotal: 600,
      grandTotal: 600,
      amountPaid: 0,
      balanceDue: 600,
      sellerCurrency: "USD",
      createdAt: Date.UTC(2026, 0, 1),
      updatedAt: Date.UTC(2026, 0, 1),
      ...values,
    });
  });
}

describe("monthly billing and collection performance", () => {
  it("enforces country ownership and team allocation limits", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);

    await expect(
      asUser(t, data.gm).mutation(api.monthlyPerformance.upsertCountryTarget, {
        countryId: data.countryId,
        month: "2026-02",
        currency: "USD",
        billingTarget: 1000,
        collectionTarget: 800,
      }),
    ).rejects.toThrow(/CEO or Head of Business/);

    await asUser(t, data.ceo).mutation(
      api.monthlyPerformance.upsertCountryTarget,
      {
        countryId: data.countryId,
        month: "2026-02",
        currency: "USD",
        billingTarget: 1000,
        collectionTarget: 800,
      },
    );
    await asUser(t, data.gm).mutation(api.monthlyPerformance.upsertTeamTarget, {
      teamMemberId: data.am._id,
      month: "2026-02",
      billingTarget: 700,
      collectionTarget: 600,
    });

    await expect(
      asUser(t, data.ceo).mutation(api.monthlyPerformance.upsertCountryTarget, {
        countryId: data.countryId,
        month: "2026-02",
        currency: "KES",
        billingTarget: 1000,
        collectionTarget: 800,
      }),
    ).rejects.toThrow(/Clear the allocated team targets/);

    await expect(
      asUser(t, data.otherGm).mutation(
        api.monthlyPerformance.upsertTeamTarget,
        {
          teamMemberId: data.am._id,
          month: "2026-02",
          billingTarget: 100,
          collectionTarget: 100,
        },
      ),
    ).rejects.toThrow(/your country|country target/);

    await expect(
      asUser(t, data.gm).mutation(api.monthlyPerformance.upsertTeamTarget, {
        teamMemberId: data.am._id,
        month: "2026-02",
        billingTarget: 1100,
        collectionTarget: 600,
      }),
    ).rejects.toThrow(/cannot exceed/);

    const dashboard = await asUser(t, data.am).query(
      api.monthlyPerformance.dashboard,
      { month: "2026-02" },
    );
    expect(dashboard.needsCountry).toBe(false);
    if (!dashboard.needsCountry) {
      expect(dashboard.target).toEqual({
        billingTarget: 700,
        collectionTarget: 600,
      });
      expect(dashboard.customers.map((row) => row.companyName)).toEqual([
        "Customer A",
      ]);
    }
    expect(
      await t.run(
        async (ctx) =>
          (await ctx.db.query("monthlyPerformanceTargetEvents").collect())
            .length,
      ),
    ).toBe(2);
  });

  it("allocates prepaid collections to service months without double counting", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    await asUser(t, data.ceo).mutation(
      api.monthlyPerformance.upsertCountryTarget,
      {
        countryId: data.countryId,
        month: "2026-02",
        currency: "USD",
        billingTarget: 1000,
        collectionTarget: 800,
      },
    );
    await asUser(t, data.gm).mutation(api.monthlyPerformance.upsertTeamTarget, {
      teamMemberId: data.am._id,
      month: "2026-02",
      billingTarget: 1000,
      collectionTarget: 800,
    });
    const invoiceId = await insertInvoice(t, data, {
      billingTiming: "prepaid",
      revenueAllocations: [
        { month: "2026-01", amount: 200 },
        { month: "2026-02", amount: 200 },
        { month: "2026-03", amount: 200 },
      ],
      receivableAllocations: [
        { month: "2026-01", amount: 200 },
        { month: "2026-02", amount: 200 },
        { month: "2026-03", amount: 200 },
      ],
      amountPaid: 600,
      balanceDue: 0,
      status: "paid",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("invoicePayments", {
        invoiceId,
        amount: 1000,
        appliedAmount: 600,
        unappliedAmount: 400,
        paidAt: Date.UTC(2026, 0, 10),
        recordedBy: data.ceo._id,
        createdAt: Date.UTC(2026, 0, 10),
      });
    });

    const dashboard = await asUser(t, data.am).query(
      api.monthlyPerformance.dashboard,
      { month: "2026-02" },
    );
    expect(dashboard.needsCountry).toBe(false);
    if (!dashboard.needsCountry) {
      expect(dashboard.summary.billingActual).toBe(200);
      expect(dashboard.summary.collectionActual).toBe(200);
      expect(dashboard.summary.billingAchievement).toBe(20);
      expect(dashboard.summary.collectionAchievement).toBe(25);
    }
  });

  it("marks a customer at risk after three overdue outstanding invoices", async () => {
    const t = convexTest(schema, modules);
    const data = await seed(t);
    await asUser(t, data.ceo).mutation(
      api.monthlyPerformance.upsertCountryTarget,
      {
        countryId: data.countryId,
        month: "2026-02",
        currency: "USD",
        billingTarget: 1000,
        collectionTarget: 800,
      },
    );
    for (let index = 0; index < 3; index++) {
      await insertInvoice(t, data, {
        invoiceNumber: `OVERDUE-${index}`,
        sourceMonth:
          index === 0
            ? "2026-02"
            : `2025-${String(index + 1).padStart(2, "0")}`,
        dueDate: Date.UTC(2025, index, 1),
        grandTotal: 100,
        balanceDue: 100,
      });
    }
    const dashboard = await asUser(t, data.gm).query(
      api.monthlyPerformance.dashboard,
      { month: "2026-02" },
    );
    expect(dashboard.needsCountry).toBe(false);
    if (!dashboard.needsCountry) {
      expect(dashboard.customers[0]).toMatchObject({
        status: "at_risk",
        overdueInvoices: 3,
        expectedCollection: 0,
      });
      expect(dashboard.summary.atRiskAmount).toBeGreaterThan(0);
    }
  });
});
