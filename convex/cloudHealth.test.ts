import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seedUsers(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const country = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const ceoId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "ceo-token",
      role: "ceo",
    });
    const hobId = await ctx.db.insert("users", {
      name: "HOB",
      tokenIdentifier: "hob-token",
      role: "head_of_business",
    });
    const gmId = await ctx.db.insert("users", {
      name: "GM",
      tokenIdentifier: "gm-token",
      role: "country_gm",
      countryId: country,
    });
    const amId = await ctx.db.insert("users", {
      name: "AM",
      tokenIdentifier: "am-token",
      role: "account_manager",
      countryId: country,
    });

    return {
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gm: (await ctx.db.get(gmId))!,
      am: (await ctx.db.get(amId))!,
    };
  });
}

describe("Cloud Health", () => {
  it("upserts capacity by region and exposes computed percentages to allowed roles", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    await t.mutation(internal.cloudCapacity.bulkUpsert, {
      regions: [
        {
          regionId: "som-1",
          regionName: "Somalia Region",
          cpuUsed: 70,
          cpuTotal: 100,
          cpuOversubscriptionCapacity: 140,
          memoryUsedGb: 900,
          memoryTotalGb: 1000,
          storageUsedGb: 5000,
          storageTotalGb: 10000,
        },
      ],
    });
    await t.mutation(internal.cloudCapacity.bulkUpsert, {
      regions: [
        {
          regionId: "som-1",
          regionName: "Somalia Region Updated",
          cpuUsed: 75,
          cpuTotal: 100,
          memoryUsedGb: 950,
          memoryTotalGb: 1000,
          storageUsedGb: 6000,
          storageTotalGb: 10000,
        },
      ],
    });

    const gmRegions = await asUser(t, users.gm).query(
      api.cloudCapacity.list,
      {},
    );
    expect(gmRegions).toHaveLength(1);
    expect(gmRegions[0]).toMatchObject({
      regionId: "som-1",
      regionName: "Somalia Region Updated",
      cpuUsedPercent: 75,
      memoryUsedPercent: 95,
      storageUsedPercent: 60,
    });

    await expect(
      asUser(t, users.am).query(api.cloudCapacity.list, {}),
    ).rejects.toThrow(/Cloud Health/);
  });

  it("allows admins to manage ping targets and exposes active targets internally", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    await expect(
      asUser(t, users.gm).mutation(api.pingTargets.create, {
        name: "GM Target",
        ip: "10.0.0.1",
      }),
    ).rejects.toThrow(/manage ping targets/);

    const targetId = await asUser(t, users.hob).mutation(
      api.pingTargets.create,
      {
        name: "ISP A",
        ip: "196.201.0.1",
        notes: "Primary upstream",
      },
    );
    let activeTargets = await t.query(
      internal.pingTargets.listActiveForSync,
      {},
    );
    expect(activeTargets).toHaveLength(1);
    expect(activeTargets[0]).toMatchObject({
      _id: targetId,
      name: "ISP A",
      active: true,
    });

    await asUser(t, users.ceo).mutation(api.pingTargets.setActive, {
      targetId,
      active: false,
    });
    activeTargets = await t.query(internal.pingTargets.listActiveForSync, {});
    expect(activeTargets).toHaveLength(0);
  });

  it("appends ping results and computes latest status plus 24h uptime", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const targetId = await asUser(t, users.ceo).mutation(
      api.pingTargets.create,
      {
        name: "ISP A",
        ip: "196.201.0.1",
      },
    );
    const now = Date.now();

    const inserted = await t.mutation(internal.pingResults.bulkUpsert, {
      results: [
        {
          targetId,
          success: true,
          latencyMs: 12,
          checkedAt: now - 60_000,
        },
        {
          targetId,
          success: false,
          error: "timeout",
          checkedAt: now,
        },
      ],
    });
    expect(inserted).toBe(2);

    const statuses = await asUser(t, users.gm).query(
      api.pingResults.latestStatusByTarget,
      {},
    );
    expect(statuses[0]).toMatchObject({
      latest: {
        success: false,
        error: "timeout",
      },
      uptime24hPercent: 50,
      samples24h: 2,
    });

    const history = await asUser(t, users.gm).query(
      api.pingResults.recentHistory,
      { targetId, limit: 1 },
    );
    expect(history).toHaveLength(1);
    expect(history[0].success).toBe(false);
  });
});
