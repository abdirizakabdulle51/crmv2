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
    const monitoringId = await ctx.db.insert("users", {
      name: "Monitoring",
      tokenIdentifier: "monitoring-token",
      role: "monitoring",
    });

    return {
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gm: (await ctx.db.get(gmId))!,
      am: (await ctx.db.get(amId))!,
      monitoring: (await ctx.db.get(monitoringId))!,
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
          storagePools: [
            {
              volumeType: "SSD",
              usedGb: 1000,
              totalGb: 5000,
              freeGb: 4000,
              usedRatio: 20,
            },
            {
              volumeType: "SATA",
              usedGb: 100,
              totalGb: 5000,
              freeGb: 4900,
              usedRatio: 2,
            },
          ],
          ecsFlavorAvailabilityStatus: "verified",
          ecsFlavorAvailabilityMessage: "ManageOne returned 74 ECS flavor(s).",
          ecsFlavorAvailability: [
            {
              name: "C6_2xlarge.4",
              vcpus: 8,
              ramGb: 32,
              cpuVendor: "Intel",
              available: true,
              matchedName: "C6_2xlarge.4",
              availabilityZones: ["AZ_Mogadishu_2a"],
              estimatedFitCount: 20,
              status: "available",
            },
          ],
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
    expect(gmRegions[0].storagePools).toMatchObject([
      {
        volumeType: "SSD",
        usedPercent: 20,
      },
      {
        volumeType: "SATA",
        usedPercent: 2,
      },
    ]);
    expect(gmRegions[0].ecsFlavorAvailabilityStatus).toBe("verified");
    expect(gmRegions[0].ecsFlavorAvailability).toMatchObject([
      {
        name: "C6_2xlarge.4",
        vcpus: 8,
        ramGb: 32,
        available: true,
        estimatedFitCount: 20,
      },
    ]);

    const monitoringRegions = await asUser(t, users.monitoring).query(
      api.cloudCapacity.list,
      {},
    );
    expect(monitoringRegions).toHaveLength(1);
    expect(monitoringRegions[0].regionId).toBe("som-1");

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

  it("queries active ping target history by time range and buckets long ranges hourly", async () => {
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
    const rangeStart = Date.UTC(2026, 6, 29, 0, 0, 0);
    const firstHour = Date.UTC(2026, 6, 29, 9, 0, 0);
    const secondHour = Date.UTC(2026, 6, 29, 10, 0, 0);

    await t.mutation(internal.pingResults.bulkUpsert, {
      results: [
        {
          targetId: targetA,
          success: true,
          latencyMs: 11,
          checkedAt: rangeStart - 60_000,
        },
        {
          targetId: targetA,
          success: true,
          latencyMs: 12,
          checkedAt: firstHour + 5 * 60_000,
        },
        {
          targetId: targetA,
          success: true,
          latencyMs: 18,
          checkedAt: firstHour + 40 * 60_000,
        },
        {
          targetId: targetB,
          success: true,
          latencyMs: 25,
          checkedAt: firstHour + 20 * 60_000,
        },
        {
          targetId: targetA,
          success: false,
          error: "timeout",
          checkedAt: secondHour + 10 * 60_000,
        },
        {
          targetId: inactiveTarget,
          success: true,
          latencyMs: 99,
          checkedAt: firstHour + 10 * 60_000,
        },
      ],
    });

    const history = await asUser(t, users.gm).query(
      api.pingResults.historyForActiveTargetsInRange,
      {
        from: rangeStart,
        to: rangeStart + 2 * 24 * 60 * 60 * 1000,
      },
    );

    expect(history.bucketSizeMs).toBe(60 * 60 * 1000);
    expect(history.targets.map((target) => target.name)).toEqual([
      "ISP A",
      "ISP B",
    ]);
    expect(history.buckets).toEqual([
      {
        checkedAt: firstHour,
        [targetA]: 18,
        [targetB]: 25,
      },
      {
        checkedAt: secondHour,
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

  it("allows admins to manage service health targets and exposes active targets internally", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    await expect(
      asUser(t, users.gm).mutation(api.serviceHealthTargets.create, {
        name: "GM Service",
        checkType: "http",
        target: "https://crm.example.com",
      }),
    ).rejects.toThrow(/manage service health targets/);

    const targetId = await asUser(t, users.hob).mutation(
      api.serviceHealthTargets.create,
      {
        name: "CRM API",
        checkType: "http",
        target: "https://crm-api.example.com/health",
        expectedStatusCode: 200,
        expectedResponseContains: "ok",
        notes: "Synthetic HTTP check",
      },
    );
    let activeTargets = await t.query(
      internal.serviceHealthTargets.listActiveForSync,
      {},
    );
    expect(activeTargets).toHaveLength(1);
    expect(activeTargets[0]).toMatchObject({
      _id: targetId,
      name: "CRM API",
      checkType: "http",
      active: true,
      expectedStatusCode: 200,
    });

    const listedTargets = await asUser(t, users.gm).query(
      api.serviceHealthTargets.list,
      {},
    );
    expect(listedTargets[0]).toMatchObject({
      _id: targetId,
      target: "https://crm-api.example.com/health",
    });

    await asUser(t, users.ceo).mutation(api.serviceHealthTargets.setActive, {
      targetId,
      active: false,
    });
    activeTargets = await t.query(
      internal.serviceHealthTargets.listActiveForSync,
      {},
    );
    expect(activeTargets).toHaveLength(0);
  });

  it("appends service health results and computes latest status plus 24h uptime", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    const targetId = await asUser(t, users.ceo).mutation(
      api.serviceHealthTargets.create,
      {
        name: "CRM DNS",
        checkType: "dns",
        target: "crm.example.com",
        expectedIp: "203.0.113.10",
      },
    );
    const now = Date.now();

    const inserted = await t.mutation(
      internal.serviceHealthResults.bulkInsert,
      {
        results: [
          {
            targetId,
            success: true,
            latencyMs: 20,
            resolvedValue: "203.0.113.10",
            checkedAt: now - 60_000,
          },
          {
            targetId,
            success: false,
            statusCode: 503,
            error: "unexpected DNS answer",
            checkedAt: now,
          },
        ],
      },
    );
    expect(inserted).toBe(2);

    const statuses = await asUser(t, users.gm).query(
      api.serviceHealthResults.latestStatusByTarget,
      {},
    );
    expect(statuses[0]).toMatchObject({
      latest: {
        success: false,
        statusCode: 503,
        error: "unexpected DNS answer",
      },
      uptime24hPercent: 50,
      samples24h: 2,
    });

    const history = await asUser(t, users.gm).query(
      api.serviceHealthResults.recentHistory,
      { targetId, limit: 1 },
    );
    expect(history).toHaveLength(1);
    expect(history[0].success).toBe(false);

    await expect(
      asUser(t, users.am).query(
        api.serviceHealthResults.latestStatusByTarget,
        {},
      ),
    ).rejects.toThrow(/Cloud Health/);
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
          storagePools: [
            {
              volumeType: "SSD",
              usedGb: 4000,
              totalGb: 10000,
              freeGb: 6000,
              usedRatio: 40,
            },
          ],
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
        regionId: "hoa-mogadishu-2",
        regionName: " Hoa-Mogadishu-2 ",
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
        regionId: "hoa-mogadishu-2",
        regionName: "Hoa-Mogadishu-2",
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
          regionId: "hoa-mogadishu-2",
          regionName: "Hoa-Mogadishu-2",
        },
      ],
    });

    const cpuConsumers = await asUser(t, users.ceo).query(
      api.regionConsumers.topConsumersByRegion,
      { regionName: "Hoa-Mogadishu-2", metric: "cpu" },
    );
    expect(cpuConsumers[0]).toMatchObject({
      tenantName: "AICC VDC",
      companyName: "AICC",
      value: 12,
    });

    const memoryConsumers = await asUser(t, users.ceo).query(
      api.regionConsumers.topConsumersByRegion,
      { regionName: "Hoa-Mogadishu-2", metric: "memory" },
    );
    expect(memoryConsumers[0]).toMatchObject({
      tenantName: "AICC VDC",
      value: 24,
    });

    const storageConsumers = await asUser(t, users.gm).query(
      api.regionConsumers.topConsumersByRegion,
      { regionName: "Hoa-Mogadishu-2", metric: "storage" },
    );
    expect(storageConsumers[0]).toMatchObject({
      tenantName: "Safari VDC",
      value: 9000,
    });

    const monitoringConsumers = await asUser(t, users.monitoring).query(
      api.regionConsumers.topConsumersByRegion,
      { regionName: "Hoa-Mogadishu-2", metric: "storage" },
    );
    expect(monitoringConsumers[0]).toMatchObject({
      tenantName: "Safari VDC",
      companyName: "Safari",
      value: 9000,
    });
    expect(monitoringConsumers[0]).toHaveProperty("tenantId");
    expect(monitoringConsumers[0]).toHaveProperty("linkedCompanyId");

    await expect(
      asUser(t, users.am).query(api.regionConsumers.topConsumersByRegion, {
        regionName: "Hoa-Mogadishu-2",
        metric: "cpu",
      }),
    ).rejects.toThrow(/Cloud Health/);
  });

  it("syncs active cloud alarms, links tenants by vdcId, and deactivates missing alarms", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    const companyId = await t.run(async (ctx) => {
      const country = await ctx.db.insert("countries", {
        name: "Kenya",
        region: "East Africa",
      });
      const sector = await ctx.db.insert("sectors", { name: "Finance" });
      const company = await ctx.db.insert("companies", {
        name: "WAAFI",
        sectorId: sector,
        countryId: country,
        contractStatus: "active",
      });
      await ctx.db.insert("manageOneTenants", {
        vdcId: "waafi-vdc",
        name: "WAAFI",
        linkedCompanyId: company,
        lastSyncedAt: 1,
      });
      return company;
    });

    const firstSync = await t.mutation(internal.cloudAlarms.bulkSync, {
      syncedAt: 1785520000000,
      alarms: [
        {
          csn: 234900364,
          alarmId: "1016003",
          alarmName: "Number of Alarms in Kafka Exceeds the Threshold",
          severity: 1,
          cleared: 0,
          acked: 0,
          category: 1,
          eventType: 18,
          meName: "Deploy Instance",
          meCategory: "Cloud Services",
          meType: "SYS_DeployInstance",
          moc: "SYS_DeployInstance",
          address: "10.20.4.222",
          logicalRegionId: "region-hash-1",
          logicalRegionName: "Mogadishu-region-hq3",
          vdcId: "waafi-vdc",
          vdcName: "WAAFI",
          tenantId: "tenant-1",
          tenant: "WAAFI",
          additionalInformation: "Kafka alarm count exceeded threshold",
          probableCause: "Threshold crossed",
          occurUtc: 1785501100055,
          arriveUtc: 1785501102225,
          latestOccurUtc: 1785501100055,
          rawPayload: { source: "test" },
          lastSyncedAt: 1785520000000,
        },
        {
          csn: 234900365,
          alarmId: "2000001",
          alarmName: "Platform alarm",
          severity: 2,
          cleared: 0,
          acked: 1,
          category: 2,
          eventType: 10,
          logicalRegionId: "region-hash-1",
          logicalRegionName: "Mogadishu-region-hq3",
          vdcId: "",
          vdcName: "",
          tenantId: "",
          tenant: "",
          occurUtc: 1785501200055,
          arriveUtc: 1785501202225,
          latestOccurUtc: 1785501200055,
          rawPayload: {},
          lastSyncedAt: 1785520000000,
        },
      ],
    });

    expect(firstSync).toEqual({
      received: 2,
      upserted: 2,
      deactivated: 0,
      syncedAt: 1785520000000,
    });

    const summary = await asUser(t, users.gm).query(
      api.cloudAlarms.summary,
      {},
    );
    expect(summary).toMatchObject({
      active: 2,
      critical: 1,
      major: 1,
      tenantLinked: 1,
      platform: 1,
      regions: 1,
    });

    const alarms = await asUser(t, users.ceo).query(
      api.cloudAlarms.listActive,
      {},
    );
    expect(alarms).toHaveLength(2);
    expect(alarms[0]).toMatchObject({
      csn: 234900365,
      linkedCompanyName: null,
    });
    expect(alarms[1]).toMatchObject({
      csn: 234900364,
      linkedCompanyId: companyId,
      linkedCompanyName: "WAAFI",
    });

    const monitoringAlarms = await asUser(t, users.monitoring).query(
      api.cloudAlarms.listActive,
      {},
    );
    expect(monitoringAlarms).toHaveLength(2);
    const linkedMonitoringAlarm = monitoringAlarms.find(
      (alarm) => alarm.csn === 234900364,
    );
    expect(linkedMonitoringAlarm).toMatchObject({
      csn: 234900364,
      linkedCompanyName: null,
      tenant: "",
      vdcName: "",
    });
    expect(linkedMonitoringAlarm).not.toHaveProperty("linkedCompanyId");

    const regionAlarms = await asUser(t, users.hob).query(
      api.cloudAlarms.listActiveByRegion,
      { logicalRegionId: "region-hash-1" },
    );
    expect(regionAlarms.map((alarm) => alarm.csn)).toEqual([
      234900365, 234900364,
    ]);

    const monitoringRegionAlarms = await asUser(t, users.monitoring).query(
      api.cloudAlarms.listActiveByRegion,
      { logicalRegionId: "region-hash-1" },
    );
    expect(monitoringRegionAlarms).toHaveLength(2);
    const linkedMonitoringRegionAlarm = monitoringRegionAlarms.find(
      (alarm) => alarm.csn === 234900364,
    );
    expect(linkedMonitoringRegionAlarm).toMatchObject({
      csn: 234900364,
      linkedCompanyName: null,
      tenant: "",
      vdcName: "",
    });
    expect(linkedMonitoringRegionAlarm).not.toHaveProperty("linkedCompanyId");

    const secondSync = await t.mutation(internal.cloudAlarms.bulkSync, {
      syncedAt: 1785520300000,
      alarms: [
        {
          csn: 234900364,
          alarmId: "1016003",
          alarmName: "Number of Alarms in Kafka Exceeds the Threshold Updated",
          severity: 1,
          cleared: 0,
          acked: 0,
          category: 1,
          eventType: 18,
          logicalRegionId: "region-hash-1",
          logicalRegionName: "Mogadishu-region-hq3",
          vdcId: "waafi-vdc",
          occurUtc: 1785501100055,
          arriveUtc: 1785501102225,
          latestOccurUtc: 1785520300000,
          rawPayload: { source: "second" },
          lastSyncedAt: 1785520300000,
        },
      ],
    });
    expect(secondSync).toMatchObject({
      received: 1,
      upserted: 1,
      deactivated: 1,
    });

    const remaining = await asUser(t, users.ceo).query(
      api.cloudAlarms.listActive,
      {},
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      csn: 234900364,
      alarmName: "Number of Alarms in Kafka Exceeds the Threshold Updated",
    });

    await expect(
      asUser(t, users.am).query(api.cloudAlarms.summary, {}),
    ).rejects.toThrow(/Cloud Health/);
  });

  it("loads the cloud health overview in one slim query", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    const overview = await asUser(t, users.gm).query(
      api.cloudCapacity.cloudHealthOverview,
      {},
    );

    expect(overview).toMatchObject({
      capacity: [],
      alarmsSummary: {
        active: 0,
        critical: 0,
        major: 0,
        tenantLinked: 0,
        platform: 0,
        regions: 0,
      },
      activeAlarms: [],
      hostGroupsSummary: {
        totalHostGroups: 0,
        critical: 0,
        watch: 0,
        healthy: 0,
        totalHosts: 0,
        topRisk: [],
      },
      statuses: [],
    });
  });
});
