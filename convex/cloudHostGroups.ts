import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth } from "./authorization";

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

const riskLevelValidator = v.union(
  v.literal("healthy"),
  v.literal("watch"),
  v.literal("critical"),
);

const hostValidator = v.object({
  hostId: v.string(),
  hostName: v.string(),
  manageIp: v.optional(v.string()),
  cpuPercent: v.number(),
  memoryPercent: v.number(),
});

const hostGroupInputValidator = v.object({
  hostGroupId: v.string(),
  hostGroupName: v.string(),
  regionId: v.string(),
  regionName: v.string(),
  azId: v.string(),
  azName: v.string(),
  resourcePoolId: v.string(),
  resourcePoolName: v.string(),
  hypervisorType: v.string(),
  hostCount: v.number(),
  cpuAvgPercent: v.number(),
  cpuMaxPercent: v.number(),
  memoryAvgPercent: v.number(),
  memoryMaxPercent: v.number(),
  riskLevel: riskLevelValidator,
  riskReasons: v.array(v.string()),
  worstCpuHost: v.optional(
    v.object({
      hostId: v.string(),
      hostName: v.string(),
      cpuPercent: v.number(),
    }),
  ),
  worstMemoryHost: v.optional(
    v.object({
      hostId: v.string(),
      hostName: v.string(),
      memoryPercent: v.number(),
    }),
  ),
  hosts: v.array(hostValidator),
  rawCluster: v.any(),
  rawHostSample: v.any(),
  lastSyncedAt: v.number(),
});

export const bulkSync = internalMutation({
  args: {
    hostGroups: v.array(hostGroupInputValidator),
    syncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const incomingHostGroupIds = new Set(
      args.hostGroups.map((hostGroup) => hostGroup.hostGroupId),
    );
    let upserted = 0;

    for (const hostGroup of args.hostGroups) {
      const existing = await ctx.db
        .query("cloudHostGroups")
        .withIndex("by_host_group_id", (q) =>
          q.eq("hostGroupId", hostGroup.hostGroupId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          ...hostGroup,
          active: true,
          inactiveAt: undefined,
        });
      } else {
        await ctx.db.insert("cloudHostGroups", {
          ...hostGroup,
          active: true,
          firstSeenAt: args.syncedAt,
        });
      }

      upserted++;
    }

    const currentlyActive = await ctx.db
      .query("cloudHostGroups")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    let deactivated = 0;

    for (const hostGroup of currentlyActive) {
      if (incomingHostGroupIds.has(hostGroup.hostGroupId)) {
        continue;
      }

      await ctx.db.patch(hostGroup._id, {
        active: false,
        inactiveAt: args.syncedAt,
        lastSyncedAt: args.syncedAt,
      });
      deactivated++;
    }

    return {
      received: args.hostGroups.length,
      upserted,
      deactivated,
      syncedAt: args.syncedAt,
    };
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    return await ctx.db
      .query("cloudHostGroups")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

export const listActiveByRegion = query({
  args: {
    regionId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    return await ctx.db
      .query("cloudHostGroups")
      .withIndex("by_region_active", (q) =>
        q.eq("regionId", args.regionId).eq("active", true),
      )
      .collect();
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const hostGroups = await ctx.db
      .query("cloudHostGroups")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const topRisk = [...hostGroups]
      .sort(
        (a, b) =>
          riskSortValue(a.riskLevel) - riskSortValue(b.riskLevel) ||
          Math.max(b.cpuMaxPercent, b.memoryMaxPercent) -
            Math.max(a.cpuMaxPercent, a.memoryMaxPercent),
      )
      .slice(0, 3);

    return {
      totalHostGroups: hostGroups.length,
      critical: hostGroups.filter((hostGroup) => hostGroup.riskLevel === "critical")
        .length,
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
    };
  },
});

function riskSortValue(riskLevel: Doc<"cloudHostGroups">["riskLevel"]) {
  if (riskLevel === "critical") return 0;
  if (riskLevel === "watch") return 1;
  return 2;
}
