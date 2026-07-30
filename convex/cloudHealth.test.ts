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
          cpuOversubscriptionRatio: 50,
          memoryUsedGb: 900,
          memoryTotalGb: 1000,
          memoryOversubscriptionRatio: 65,
          storageUsedGb: 5000,
          storageTotalGb: 10000,
          storageOversubscriptionRatio: 40,
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
          cpuOversubscriptionRatio: 53.4,
          memoryUsedGb: 950,
          memoryTotalGb: 1000,
          memoryOversubscriptionRatio: 61.2,
          storageUsedGb: 6000,
          storageTotalGb: 10000,
          storageOversubscriptionRatio: 72.8,
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
      cpuOversubscriptionRatio: 53.4,
      memoryUsedPercent: 95,
      memoryOversubscriptionRatio: 61.2,
      storageUsedPercent: 60,
      storageOversubscriptionRatio: 72.8,
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

  it("buckets recent history for all active ping targets into shared chart rows", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const targetA = await asUser(t, users.ceo).mutation(
      api.pingTargets.create,
      {
        name: "ISP A",
        ip: "196.201.0.1",
      },
    );
    const targetB = await asUser(t, users.ceo).mutation(
      api.pingTargets.create,
      {
        name: "ISP B",
        ip: "196.201.0.2",
      },
    );
    const inactiveTarget = await asUser(t, users.ceo).mutation(
      api.pingTargets.create,
      {
        name: "Paused ISP",
        ip: "196.201.0.3",
      },
    );
    await asUser(t, users.ceo).mutation(api.pingTargets.setActive, {
      targetId: inactiveTarget,
      active: false,
    });
    const bucketOne = Date.UTC(2026, 6, 30, 9, 0, 0);
    const bucketTwo = Date.UTC(2026, 6, 30, 9, 2, 0);

    await t.mutation(internal.pingResults.bulkUpsert, {
      results: [
        {
          targetId: targetA,
          success: true,
          latencyMs: 12,
          checkedAt: bucketOne + 10_000,
        },
        {
          targetId: targetB,
          success: true,
          latencyMs: 22,
          checkedAt: bucketOne + 20_000,
        },
        {
          targetId: targetA,
          success: false,
          error: "timeout",
          checkedAt: bucketTwo + 10_000,
        },
        {
          targetId: inactiveTarget,
          success: true,
          latencyMs: 99,
          checkedAt: bucketOne + 10_000,
        },
      ],
    });

    const history = await asUser(t, users.gm).query(
      api.pingResults.recentHistoryForActiveTargets,
      { limit: 10 },
    );

    expect(history.targets.map((target) => target.name)).toEqual([
      "ISP A",
      "ISP B",
    ]);
    expect(history.buckets).toEqual([
      {
        checkedAt: bucketOne,
        [targetA]: 12,
        [targetB]: 22,
      },
      {
        checkedAt: bucketTwo,
        [targetA]: null,
        [targetB]: null,
      },
    ]);
  });

  it("hard-deletes ping targets and their appended result history for admins only", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const targetId = await asUser(t, users.ceo).mutation(
      api.pingTargets.create,
      {
        name: "test - delete me",
        ip: "203.0.113.10",
      },
    );
    const now = Date.now();

    await t.mutation(internal.pingResults.bulkUpsert, {
      results: Array.from({ length: 25 }, (_, index) => ({
        targetId,
        success: index % 5 !== 0,
        latencyMs: 10 + index,
        checkedAt: now + index,
      })),
    });

    await expect(
      asUser(t, users.gm).mutation(api.pingTargets.remove, { targetId }),
    ).rejects.toThrow(/manage ping targets/);

    const result = await asUser(t, users.hob).mutation(api.pingTargets.remove, {
      targetId,
    });
    expect(result).toEqual({ deletedResults: 25 });

    const targets = await asUser(t, users.ceo).query(api.pingTargets.list, {});
    expect(targets).toHaveLength(0);

    const statuses = await asUser(t, users.ceo).query(
      api.pingResults.latestStatusByTarget,
      {},
    );
    expect(statuses).toHaveLength(0);

    const history = await asUser(t, users.ceo).query(
      api.pingResults.recentHistory,
      { targetId, limit: 100 },
    );
    expect(history).toHaveLength(0);
  });

  it("appends capacity snapshots and returns region history to allowed roles only", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    const firstSnapshot = Date.UTC(2026, 6, 29);
    const secondSnapshot = Date.UTC(2026, 6, 30);
    const inserted = await t.mutation(internal.cloudCapacitySnapshots.append, {
      snapshots: [
        {
          regionId: "som-1",
          regionName: "Somalia Region",
          cpuUsed: 40,
          cpuTotal: 100,
          memoryUsedGb: 500,
          memoryTotalGb: 1000,
          storageUsedGb: 4000,
          storageTotalGb: 10000,
          snapshotAt: secondSnapshot,
        },
        {
          regionId: "som-1",
          regionName: "Somalia Region",
          cpuUsed: 30,
          cpuTotal: 100,
          memoryUsedGb: 450,
          memoryTotalGb: 1000,
          storageUsedGb: 3500,
          storageTotalGb: 10000,
          snapshotAt: firstSnapshot,
        },
      ],
    });
    expect(inserted).toBe(2);

    const history = await asUser(t, users.gm).query(
      api.cloudCapacitySnapshots.historyForRegion,
      { regionId: "som-1" },
    );
    expect(history.map((snapshot) => snapshot.snapshotAt)).toEqual([
      firstSnapshot,
      secondSnapshot,
    ]);

    await expect(
      asUser(t, users.am).query(api.cloudCapacitySnapshots.historyForRegion, {
        regionId: "som-1",
      }),
    ).rejects.toThrow(/Cloud Health/);
  });

  it("stores tenant regions and ranks top regional consumers from tenant flavor and storage fields", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    await t.run(async (ctx) => {
      const country = await ctx.db.insert("countries", {
        name: "Kenya",
        region: "East Africa",
      });
      const sector = await ctx.db.insert("sectors", { name: "Telecom" });
      const companyA = await ctx.db.insert("companies", {
        name: "AICC",
        sectorId: sector,
        countryId: country,
        contractStatus: "active",
      });
      const companyB = await ctx.db.insert("companies", {
        name: "Safari",
        sectorId: sector,
        countryId: country,
        contractStatus: "active",
      });

      await ctx.db.insert("manageOneTenants", {
        vdcId: "aicc-vdc",
        name: "AICC VDC",
        regionId: "som-1",
        regionName: "Somalia Region",
        linkedCompanyId: companyA,
        ecsFlavors: [
          { flavorName: "c6.large.2", vcpus: 4, ramMb: 8192, count: 3 },
        ],
        evsVolumeTypes: [{ volumeType: "SSD", totalGb: 5000, count: 12 }],
        lastSyncedAt: 1,
      });
      await ctx.db.insert("manageOneTenants", {
        vdcId: "safari-vdc",
        name: "Safari VDC",
        regionId: "som-1",
        regionName: "Somalia Region",
        linkedCompanyId: companyB,
        ecsFlavors: [
          { flavorName: "c6.small.2", vcpus: 2, ramMb: 4096, count: 2 },
        ],
        resources: [{ serviceId: "evs", resource: "gigabytes", used: 9000 }],
        lastSyncedAt: 1,
      });
    });

    await t.mutation(internal.manageOneTenants.bulkUpsert, {
      tenants: [
        {
          vdcId: "synced-vdc",
          name: "Synced VDC",
          regionId: "som-1",
          regionName: "Somalia Region",
        },
      ],
    });

    const cpuConsumers = await asUser(t, users.ceo).query(
      api.regionConsumers.topConsumersByRegion,
      { regionId: "som-1", metric: "cpu" },
    );
    expect(cpuConsumers[0]).toMatchObject({
      tenantName: "AICC VDC",
      companyName: "AICC",
      value: 12,
    });

    const memoryConsumers = await asUser(t, users.ceo).query(
      api.regionConsumers.topConsumersByRegion,
      { regionId: "som-1", metric: "memory" },
    );
    expect(memoryConsumers[0]).toMatchObject({
      tenantName: "AICC VDC",
      value: 24,
    });

    const storageConsumers = await asUser(t, users.gm).query(
      api.regionConsumers.topConsumersByRegion,
      { regionId: "som-1", metric: "storage" },
    );
    expect(storageConsumers[0]).toMatchObject({
      tenantName: "Safari VDC",
      value: 9000,
    });

    await expect(
      asUser(t, users.am).query(api.regionConsumers.topConsumersByRegion, {
        regionId: "som-1",
        metric: "cpu",
      }),
    ).rejects.toThrow(/Cloud Health/);
  });
});
