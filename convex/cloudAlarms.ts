import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth, isMonitoring } from "./authorization";

const DEFAULT_INACTIVE_ALARM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRY_RUN_PAGE_SIZE = 1_000;

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

function redactAlarmForMonitoring<T extends Doc<"cloudAlarms">>(
  alarm: T & { linkedCompanyName?: string | null },
  user: Doc<"users">,
) {
  if (!isMonitoring(user)) {
    return alarm;
  }

  return alarm;
}

const alarmInputValidator = v.object({
  csn: v.number(),
  alarmId: v.string(),
  alarmName: v.string(),
  severity: v.number(),
  cleared: v.number(),
  acked: v.number(),
  category: v.number(),
  eventType: v.number(),
  meName: v.optional(v.string()),
  meCategory: v.optional(v.string()),
  meType: v.optional(v.string()),
  moc: v.optional(v.string()),
  address: v.optional(v.string()),
  logicalRegionId: v.optional(v.string()),
  logicalRegionName: v.optional(v.string()),
  vdcId: v.optional(v.string()),
  vdcName: v.optional(v.string()),
  tenantId: v.optional(v.string()),
  tenant: v.optional(v.string()),
  additionalInformation: v.optional(v.string()),
  probableCause: v.optional(v.string()),
  occurUtc: v.number(),
  arriveUtc: v.number(),
  latestOccurUtc: v.number(),
  rawPayload: v.any(),
  lastSyncedAt: v.number(),
});

async function findLinkedCompanyId(
  ctx: MutationCtx,
  vdcId: string | undefined,
): Promise<Id<"companies"> | undefined> {
  if (!vdcId) {
    return undefined;
  }

  const tenant = await ctx.db
    .query("manageOneTenants")
    .withIndex("by_vdc_id", (q) => q.eq("vdcId", vdcId))
    .first();

  return tenant?.linkedCompanyId;
}

export const bulkSync = internalMutation({
  args: {
    alarms: v.array(alarmInputValidator),
    syncedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const incomingCsns = new Set(args.alarms.map((alarm) => alarm.csn));
    let upserted = 0;

    for (const alarm of args.alarms) {
      const existing = await ctx.db
        .query("cloudAlarms")
        .withIndex("by_csn", (q) => q.eq("csn", alarm.csn))
        .unique();
      const linkedCompanyId = await findLinkedCompanyId(ctx, alarm.vdcId);

      if (existing) {
        await ctx.db.patch(existing._id, {
          ...alarm,
          active: true,
          inactiveAt: undefined,
          linkedCompanyId,
        });
      } else {
        await ctx.db.insert("cloudAlarms", {
          ...alarm,
          active: true,
          firstSeenAt: args.syncedAt,
          linkedCompanyId,
        });
      }

      upserted++;
    }

    const currentlyActive = await ctx.db
      .query("cloudAlarms")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    let deactivated = 0;

    for (const alarm of currentlyActive) {
      if (incomingCsns.has(alarm.csn)) {
        continue;
      }

      await ctx.db.patch(alarm._id, {
        active: false,
        inactiveAt: args.syncedAt,
        lastSyncedAt: args.syncedAt,
      });
      deactivated++;
    }

    return {
      received: args.alarms.length,
      upserted,
      deactivated,
      syncedAt: args.syncedAt,
    };
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const activeAlarms = await ctx.db
      .query("cloudAlarms")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const regions = new Set(
      activeAlarms
        .map((alarm) => alarm.logicalRegionName ?? alarm.logicalRegionId)
        .filter(Boolean),
    );

    return {
      active: activeAlarms.length,
      critical: activeAlarms.filter((alarm) => alarm.severity === 1).length,
      major: activeAlarms.filter((alarm) => alarm.severity === 2).length,
      tenantLinked: activeAlarms.filter((alarm) => alarm.linkedCompanyId)
        .length,
      platform: activeAlarms.filter((alarm) => !alarm.linkedCompanyId).length,
      regions: regions.size,
      lastSyncedAt: activeAlarms.reduce(
        (latest, alarm) => Math.max(latest, alarm.lastSyncedAt),
        0,
      ),
    };
  },
});

export const listActive = query({
  args: {
    severity: v.optional(v.number()),
    logicalRegionId: v.optional(v.string()),
    category: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const activeAlarms = await ctx.db
      .query("cloudAlarms")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();

    const filteredAlarms = activeAlarms
      .filter((alarm) =>
        args.severity == null ? true : alarm.severity === args.severity,
      )
      .filter((alarm) =>
        args.logicalRegionId
          ? alarm.logicalRegionId === args.logicalRegionId
          : true,
      )
      .filter((alarm) =>
        args.category == null ? true : alarm.category === args.category,
      );

    if (filteredAlarms.length === 0) {
      return [];
    }

    const linkedCompanyIds = new Set(
      filteredAlarms
        .map((alarm) => alarm.linkedCompanyId)
        .filter((companyId): companyId is Id<"companies"> =>
          Boolean(companyId),
        ),
    );
    const companyPairs = await Promise.all(
      [...linkedCompanyIds].map(async (companyId) => {
        const company = await ctx.db.get(companyId);
        return [companyId, company?.name ?? null] as const;
      }),
    );
    const companyNames = new Map(companyPairs);

    return filteredAlarms
      .map((alarm) => ({
        ...alarm,
        linkedCompanyName: alarm.linkedCompanyId
          ? (companyNames.get(alarm.linkedCompanyId) ?? null)
          : null,
      }))
      .map((alarm) => redactAlarmForMonitoring(alarm, user))
      .sort((a, b) => b.latestOccurUtc - a.latestOccurUtc);
  },
});

export const listActiveByRegion = query({
  args: {
    logicalRegionId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const alarms = await ctx.db
      .query("cloudAlarms")
      .withIndex("by_region_active", (q) =>
        q.eq("logicalRegionId", args.logicalRegionId).eq("active", true),
      )
      .collect();
    const companies = await ctx.db.query("companies").collect();
    const companyNames = new Map(
      companies.map((company) => [company._id, company.name]),
    );

    return alarms
      .map((alarm) => ({
        ...alarm,
        linkedCompanyName: alarm.linkedCompanyId
          ? (companyNames.get(alarm.linkedCompanyId) ?? null)
          : null,
      }))
      .map((alarm) => redactAlarmForMonitoring(alarm, user))
      .sort((a, b) => b.latestOccurUtc - a.latestOccurUtc);
  },
});

export const dryRunOldInactiveAlarmsPage = internalQuery({
  args: {
    olderThanMs: v.optional(v.number()),
    nowMs: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const olderThanMs =
      args.olderThanMs ?? DEFAULT_INACTIVE_ALARM_RETENTION_MS;
    const nowMs = args.nowMs ?? Date.now();
    const cutoff = nowMs - olderThanMs;
    const requestedItems = args.paginationOpts.numItems;
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(requestedItems, MAX_DRY_RUN_PAGE_SIZE),
    };
    const page = await ctx.db
      .query("cloudAlarms")
      .withIndex("by_active", (q) => q.eq("active", false))
      .paginate(paginationOpts);
    const matchingAlarms = page.page.filter((alarm) => {
      const inactiveAt = alarm.inactiveAt ?? alarm.lastSyncedAt;
      return inactiveAt < cutoff;
    });
    const inactiveAts = matchingAlarms.map(
      (alarm) => alarm.inactiveAt ?? alarm.lastSyncedAt,
    );

    return {
      dryRun: true,
      table: "cloudAlarms",
      action: "count_only",
      scope: "inactive_only",
      olderThanMs,
      cutoff,
      scannedPageCount: page.page.length,
      matchingPageCount: matchingAlarms.length,
      requestedPageSize: requestedItems,
      effectivePageSize: paginationOpts.numItems,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      oldestInactiveAt:
        inactiveAts.length > 0 ? Math.min(...inactiveAts) : null,
      newestInactiveAt:
        inactiveAts.length > 0 ? Math.max(...inactiveAts) : null,
    };
  },
});
