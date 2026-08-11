import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth, isMonitoring } from "./authorization";

async function getCurrentUserOrThrow(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();

  if (!user) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  }

  return user;
}

function assertCanViewCloudHealth(user: Doc<"users">) {
  if (canViewCloudHealth(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message:
      "Only Monitoring, Country GM, Head of Business, or CEO can view Cloud Health",
  });
}

function percentage(used: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.round((used / total) * 1000) / 10;
}

const storagePoolValidator = v.object({
  volumeType: v.string(),
  usedGb: v.number(),
  totalGb: v.number(),
  freeGb: v.number(),
  usedRatio: v.number(),
  oversubscriptionTotalGb: v.optional(v.number()),
  oversubscriptionAllocatedGb: v.optional(v.number()),
  oversubscriptionFreeGb: v.optional(v.number()),
  oversubscriptionAllocatedRatio: v.optional(v.number()),
});

const ecsFlavorAvailabilityValidator = v.object({
  name: v.string(),
  vcpus: v.number(),
  ramGb: v.number(),
  cpuVendor: v.optional(v.string()),
  available: v.boolean(),
  matchedName: v.optional(v.string()),
  availabilityZones: v.optional(v.array(v.string())),
  estimatedFitCount: v.optional(v.number()),
  status: v.optional(
    v.union(
      v.literal("available"),
      v.literal("low_capacity"),
      v.literal("not_offered"),
    ),
  ),
});

export const bulkUpsert = internalMutation({
  args: {
    regions: v.array(
      v.object({
        regionId: v.string(),
        regionName: v.string(),
        cpuUsed: v.number(),
        cpuTotal: v.number(),
        cpuOversubscriptionCapacity: v.optional(v.number()),
        cpuOversubscriptionRatio: v.optional(v.number()),
        memoryUsedGb: v.number(),
        memoryTotalGb: v.number(),
        memoryOversubscriptionCapacityGb: v.optional(v.number()),
        memoryOversubscriptionRatio: v.optional(v.number()),
        storageUsedGb: v.number(),
        storageTotalGb: v.number(),
        storageOversubscriptionCapacityGb: v.optional(v.number()),
        storageOversubscriptionRatio: v.optional(v.number()),
        storagePools: v.optional(v.array(storagePoolValidator)),
        ecsFlavorAvailabilityStatus: v.optional(
          v.union(v.literal("verified"), v.literal("unavailable")),
        ),
        ecsFlavorAvailabilityMessage: v.optional(v.string()),
        ecsFlavorAvailability: v.optional(
          v.array(ecsFlavorAvailabilityValidator),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let upserted = 0;

    for (const region of args.regions) {
      const existing = await ctx.db
        .query("cloudCapacityRegions")
        .withIndex("by_region_id", (q) => q.eq("regionId", region.regionId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { ...region, lastSyncedAt: now });
      } else {
        await ctx.db.insert("cloudCapacityRegions", {
          ...region,
          lastSyncedAt: now,
        });
      }

      upserted++;
    }

    return upserted;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const regions = await ctx.db.query("cloudCapacityRegions").collect();
    return regions
      .map((region) => ({
        ...region,
        cpuUsedPercent: percentage(region.cpuUsed, region.cpuTotal),
        memoryUsedPercent: percentage(
          region.memoryUsedGb,
          region.memoryTotalGb,
        ),
        storageUsedPercent: percentage(
          region.storageUsedGb,
          region.storageTotalGb,
        ),
        storagePools: region.storagePools?.map((pool) => ({
          ...pool,
          usedPercent: percentage(pool.usedGb, pool.totalGb),
        })),
      }))
      .sort((a, b) => a.regionName.localeCompare(b.regionName));
  },
});

function uptimePercent(results: Doc<"pingResults">[]) {
  if (results.length === 0) {
    return null;
  }
  const successful = results.filter((result) => result.success).length;
  return Math.round((successful / results.length) * 1000) / 10;
}

function riskSortValue(riskLevel: Doc<"cloudHostGroups">["riskLevel"]) {
  if (riskLevel === "critical") return 0;
  if (riskLevel === "watch") return 1;
  return 2;
}

export const cloudHealthOverview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const [regions, activeAlarms, hostGroups, targets] = await Promise.all([
      ctx.db.query("cloudCapacityRegions").collect(),
      ctx.db
        .query("cloudAlarms")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect(),
      ctx.db
        .query("cloudHostGroups")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect(),
      ctx.db.query("pingTargets").collect(),
    ]);

    const companyIds = isMonitoring(user)
      ? new Set<Id<"companies">>()
      : new Set(
          activeAlarms
            .map((alarm) => alarm.linkedCompanyId)
            .filter((companyId): companyId is Id<"companies"> =>
              Boolean(companyId),
            ),
        );
    const companyPairs = await Promise.all(
      [...companyIds].map(async (companyId) => {
        const company = await ctx.db.get(companyId);
        return [companyId, company?.name ?? null] as const;
      }),
    );
    const companyNames = new Map(companyPairs);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const statuses = await Promise.all(
      targets.map(async (target) => {
        const [latest, recentResults] = await Promise.all([
          ctx.db
            .query("pingResults")
            .withIndex("by_target_checked_at", (q) =>
              q.eq("targetId", target._id),
            )
            .order("desc")
            .first(),
          ctx.db
            .query("pingResults")
            .withIndex("by_target_checked_at", (q) =>
              q.eq("targetId", target._id).gte("checkedAt", dayAgo),
            )
            .collect(),
        ]);

        return {
          target,
          latest,
          uptime24hPercent: uptimePercent(recentResults),
          samples24h: recentResults.length,
        };
      }),
    );
    const topRisk = [...hostGroups]
      .sort(
        (a, b) =>
          riskSortValue(a.riskLevel) - riskSortValue(b.riskLevel) ||
          Math.max(b.cpuMaxPercent, b.memoryMaxPercent) -
            Math.max(a.cpuMaxPercent, a.memoryMaxPercent),
      )
      .slice(0, 3)
      .map((hostGroup) => ({
        _id: hostGroup._id,
        hostGroupId: hostGroup.hostGroupId,
        hostGroupName: hostGroup.hostGroupName,
        regionName: hostGroup.regionName,
        riskLevel: hostGroup.riskLevel,
      }));

    return {
      capacity: regions
        .map((region) => ({
          ...region,
          cpuUsedPercent: percentage(region.cpuUsed, region.cpuTotal),
          memoryUsedPercent: percentage(
            region.memoryUsedGb,
            region.memoryTotalGb,
          ),
          storageUsedPercent: percentage(
            region.storageUsedGb,
            region.storageTotalGb,
          ),
          storagePools: region.storagePools?.map((pool) => ({
            ...pool,
            usedPercent: percentage(pool.usedGb, pool.totalGb),
          })),
        }))
        .sort((a, b) => a.regionName.localeCompare(b.regionName)),
      alarmsSummary: {
        active: activeAlarms.length,
        critical: activeAlarms.filter((alarm) => alarm.severity === 1).length,
        major: activeAlarms.filter((alarm) => alarm.severity === 2).length,
        tenantLinked: activeAlarms.filter((alarm) => alarm.linkedCompanyId)
          .length,
        platform: activeAlarms.filter((alarm) => !alarm.linkedCompanyId)
          .length,
        regions: new Set(
          activeAlarms
            .map((alarm) => alarm.logicalRegionName ?? alarm.logicalRegionId)
            .filter(Boolean),
        ).size,
        lastSyncedAt: activeAlarms.reduce(
          (latest, alarm) => Math.max(latest, alarm.lastSyncedAt),
          0,
        ),
      },
      activeAlarms: activeAlarms
        .map((alarm) => {
          const row = {
            ...alarm,
            linkedCompanyName: alarm.linkedCompanyId
              ? (companyNames.get(alarm.linkedCompanyId) ?? null)
              : null,
          };
          if (!isMonitoring(user)) {
            return row;
          }
          const { linkedCompanyId: _linkedCompanyId, ...redacted } = row;
          return {
            ...redacted,
            linkedCompanyName: null,
            vdcId: "",
            vdcName: "",
            tenantId: "",
            tenant: "",
          };
        })
        .sort((a, b) => b.latestOccurUtc - a.latestOccurUtc),
      hostGroupsSummary: {
        totalHostGroups: hostGroups.length,
        critical: hostGroups.filter(
          (hostGroup) => hostGroup.riskLevel === "critical",
        ).length,
        watch: hostGroups.filter((hostGroup) => hostGroup.riskLevel === "watch")
          .length,
        healthy: hostGroups.filter(
          (hostGroup) => hostGroup.riskLevel === "healthy",
        ).length,
        totalHosts: hostGroups.reduce(
          (total, hostGroup) => total + hostGroup.hostCount,
          0,
        ),
        lastSyncedAt: hostGroups.reduce(
          (latest, hostGroup) => Math.max(latest, hostGroup.lastSyncedAt),
          0,
        ),
        topRisk,
      },
      statuses: statuses.sort((a, b) =>
        a.target.name.localeCompare(b.target.name),
      ),
    };
  },
});
