import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth } from "./authorization";

type Ctx = QueryCtx | MutationCtx;

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETENTION_DELETE_PER_SYNC = 200;
const MAX_DRY_RUN_PAGE_SIZE = 1_000;
const MOVEMENT_WINDOWS = [7, 14, 21, 28] as const;
const MOVEMENT_HOUR_ROW_LIMIT = 5_000;
const MONITORED_REGIONS = ["Hoa-Mogadishu-2", "Mogadishu-region-hq3"] as const;
const MONITORED_REGION_SCOPE = "monitored";
// Do not compare old combined-region rows with the resource-space split rows.
const RESOURCE_SPACE_REGION_SPLIT_AT = Date.parse("2026-08-18T19:40:00.000Z");

const hourlySnapshotInputValidator = v.object({
  vdcId: v.string(),
  domainId: v.optional(v.string()),
  tenantName: v.string(),
  regionId: v.optional(v.string()),
  regionName: v.optional(v.string()),
  capturedAt: v.number(),
  ecsInstances: v.number(),
  cceNodes: v.optional(v.number()),
  ecsCores: v.number(),
  ecsRamGb: v.number(),
  evsGb: v.number(),
  sfsGb: v.optional(v.number()),
  csbsGb: v.optional(v.number()),
  vbsGb: v.optional(v.number()),
  obsGb: v.number(),
  publicIps: v.number(),
  vpcepEndpoints: v.optional(v.number()),
  bmsInstances: v.optional(v.number()),
  loadBalancers: v.number(),
  vpnGateways: v.number(),
  natGateways: v.number(),
  wafInstances: v.number(),
  wafBasicInstances: v.optional(v.number()),
  wafEnterpriseInstances: v.optional(v.number()),
  rawMetrics: v.optional(v.any()),
});

async function getCurrentUserOrThrow(ctx: Ctx): Promise<Doc<"users">> {
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

function assertCanViewMonitoring(user: Doc<"users">) {
  if (canViewCloudHealth(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message:
      "Only Monitoring, Country GM, Head of Business, or CEO can view hourly monitoring",
  });
}

function publicSnapshot(row: Doc<"manageOneHourlySnapshots">) {
  const { rawMetrics: _rawMetrics, ...snapshot } = row;
  return snapshot;
}

function rowRegion(
  row: Pick<Doc<"manageOneHourlySnapshots">, "regionName" | "regionId">,
) {
  return row.regionName || row.regionId || "Unknown";
}

function matchesRegionScope(
  row: Pick<Doc<"manageOneHourlySnapshots">, "regionName" | "regionId">,
  region: string,
) {
  const currentRegion = rowRegion(row);
  if (region === MONITORED_REGION_SCOPE) {
    return MONITORED_REGIONS.includes(
      currentRegion as (typeof MONITORED_REGIONS)[number],
    );
  }
  return currentRegion === region;
}

function resourceTotals(row: Doc<"manageOneHourlySnapshots">) {
  return {
    ecs: row.ecsInstances,
    cce: row.cceNodes ?? 0,
    bms: row.bmsInstances ?? 0,
    vcpu: row.ecsCores,
    ramGb: row.ecsRamGb,
    evsGb: row.evsGb,
    sfsGb: row.sfsGb ?? 0,
    csbsGb: row.csbsGb ?? 0,
    vbsGb: row.vbsGb ?? 0,
    obsGb: row.obsGb,
    eip: row.publicIps,
    elb: row.loadBalancers,
    vpn: row.vpnGateways,
    vpcep: row.vpcepEndpoints ?? 0,
    nat: row.natGateways,
    waf: row.wafInstances,
  };
}

type ResourceTotals = ReturnType<typeof resourceTotals>;

function emptyResourceTotals(): ResourceTotals {
  return {
    ecs: 0,
    cce: 0,
    bms: 0,
    vcpu: 0,
    ramGb: 0,
    evsGb: 0,
    sfsGb: 0,
    csbsGb: 0,
    vbsGb: 0,
    obsGb: 0,
    eip: 0,
    elb: 0,
    vpn: 0,
    vpcep: 0,
    nat: 0,
    waf: 0,
  };
}

function addTotals(
  left: ResourceTotals,
  right: ResourceTotals,
): ResourceTotals {
  return {
    ecs: left.ecs + right.ecs,
    cce: left.cce + right.cce,
    bms: left.bms + right.bms,
    vcpu: left.vcpu + right.vcpu,
    ramGb: left.ramGb + right.ramGb,
    evsGb: left.evsGb + right.evsGb,
    sfsGb: left.sfsGb + right.sfsGb,
    csbsGb: left.csbsGb + right.csbsGb,
    vbsGb: left.vbsGb + right.vbsGb,
    obsGb: left.obsGb + right.obsGb,
    eip: left.eip + right.eip,
    elb: left.elb + right.elb,
    vpn: left.vpn + right.vpn,
    vpcep: left.vpcep + right.vpcep,
    nat: left.nat + right.nat,
    waf: left.waf + right.waf,
  };
}

function resourceScore(totals: ReturnType<typeof resourceTotals>) {
  return (
    totals.ecs +
    totals.cce +
    totals.bms +
    totals.vcpu / 8 +
    totals.ramGb / 32 +
    totals.evsGb / 100 +
    totals.sfsGb / 100 +
    totals.csbsGb / 100 +
    totals.vbsGb / 100 +
    totals.obsGb / 100 +
    totals.eip +
    totals.elb +
    totals.vpn +
    totals.vpcep +
    totals.nat +
    totals.waf
  );
}

function movementGroupKey(
  row: Doc<"manageOneHourlySnapshots">,
  region: string,
) {
  if (region === MONITORED_REGION_SCOPE) {
    return row.vdcId;
  }
  return [row.vdcId, row.regionId ?? row.regionName ?? "unknown-region"].join(
    "|",
  );
}

function regionScopeLabel(regionNames: Set<string>, fallbackRegion?: string) {
  const names = [...regionNames].filter(Boolean).sort();
  if (names.length > 1) {
    return "HOA + HQ3";
  }
  return names[0] ?? fallbackRegion ?? "Unknown";
}

function subtractTotals(
  current: ReturnType<typeof resourceTotals>,
  baseline: ReturnType<typeof resourceTotals>,
) {
  return {
    ecs: current.ecs - baseline.ecs,
    cce: current.cce - baseline.cce,
    bms: current.bms - baseline.bms,
    vcpu: current.vcpu - baseline.vcpu,
    ramGb: current.ramGb - baseline.ramGb,
    evsGb: current.evsGb - baseline.evsGb,
    sfsGb: current.sfsGb - baseline.sfsGb,
    csbsGb: current.csbsGb - baseline.csbsGb,
    vbsGb: current.vbsGb - baseline.vbsGb,
    obsGb: current.obsGb - baseline.obsGb,
    eip: current.eip - baseline.eip,
    elb: current.elb - baseline.elb,
    vpn: current.vpn - baseline.vpn,
    vpcep: current.vpcep - baseline.vpcep,
    nat: current.nat - baseline.nat,
    waf: current.waf - baseline.waf,
  };
}

function capturedHour(capturedAt: number) {
  const date = new Date(capturedAt);
  date.setUTCMinutes(0, 0, 0);
  return date.getTime();
}

function snapshotKey(row: {
  vdcId: string;
  regionId?: string;
  capturedAt: number;
}) {
  return [
    row.vdcId,
    row.regionId ?? "unknown-region",
    capturedHour(row.capturedAt).toString(),
  ].join("|");
}

async function findLinkedCompanyId(
  ctx: MutationCtx,
  row: { vdcId: string; domainId?: string },
): Promise<Id<"companies"> | undefined> {
  const tenantByDomain = row.domainId
    ? await ctx.db
        .query("manageOneTenants")
        .withIndex("by_domain_id", (q) => q.eq("domainId", row.domainId))
        .first()
    : null;
  const tenant =
    tenantByDomain ??
    (await ctx.db
      .query("manageOneTenants")
      .withIndex("by_vdc_id", (q) => q.eq("vdcId", row.vdcId))
      .first());

  return tenant?.linkedCompanyId;
}

async function pruneOldSnapshots(ctx: MutationCtx, cutoff: number) {
  const oldRows = await ctx.db
    .query("manageOneHourlySnapshots")
    .withIndex("by_hour", (q) => q.lt("capturedHour", cutoff))
    .take(MAX_RETENTION_DELETE_PER_SYNC);

  for (const row of oldRows) {
    await ctx.db.delete(row._id);
  }

  return oldRows.length;
}

export const bulkUpsert = internalMutation({
  args: {
    rows: v.array(hourlySnapshotInputValidator),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startedAt = args.startedAt ?? Date.now();
    const runId = await ctx.db.insert("manageOneHourlySyncRuns", {
      startedAt,
      status: "running",
      rowsReceived: args.rows.length,
      rowsUpserted: 0,
      rowsSkipped: 0,
    });

    let rowsUpserted = 0;
    let rowsSkipped = 0;

    try {
      for (const row of args.rows) {
        if (!Number.isFinite(row.capturedAt)) {
          rowsSkipped++;
          continue;
        }

        const key = snapshotKey(row);
        const hour = capturedHour(row.capturedAt);
        const linkedCompanyId = await findLinkedCompanyId(ctx, row);
        const existing = await ctx.db
          .query("manageOneHourlySnapshots")
          .withIndex("by_snapshot_key", (q) => q.eq("snapshotKey", key))
          .unique();
        const document = {
          ...row,
          snapshotKey: key,
          capturedHour: hour,
          linkedCompanyId,
        };

        if (existing) {
          await ctx.db.patch(existing._id, document);
        } else {
          await ctx.db.insert("manageOneHourlySnapshots", document);
        }
        rowsUpserted++;
      }

      await pruneOldSnapshots(ctx, capturedHour(startedAt - RETENTION_MS));

      await ctx.db.patch(runId, {
        finishedAt: Date.now(),
        status: "success",
        rowsUpserted,
        rowsSkipped,
      });

      return {
        received: args.rows.length,
        upserted: rowsUpserted,
        skipped: rowsSkipped,
      };
    } catch (error) {
      await ctx.db.patch(runId, {
        finishedAt: Date.now(),
        status: "failed",
        rowsUpserted,
        rowsSkipped,
        error: error instanceof Error ? error.message : "Hourly sync failed",
      });
      throw error;
    }
  },
});

export const latest = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewMonitoring(user);

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500);
    const rows = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_hour")
      .order("desc")
      .take(limit);

    return rows.map(publicSnapshot);
  },
});

export const historyForCompany = query({
  args: {
    companyId: v.id("companies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewMonitoring(user);

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 48), 1), 720);
    const rows = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_company_hour", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .order("desc")
      .take(limit);

    return rows.map(publicSnapshot);
  },
});

export const latestRun = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewMonitoring(user);

    return await ctx.db
      .query("manageOneHourlySyncRuns")
      .withIndex("by_started_at")
      .order("desc")
      .first();
  },
});

export const resourceMovement = query({
  args: {
    days: v.union(v.literal(7), v.literal(14), v.literal(21), v.literal(28)),
    region: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewMonitoring(user);

    const days = MOVEMENT_WINDOWS.includes(args.days) ? args.days : 7;
    const region = args.region ?? MONITORED_REGION_SCOPE;
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 10), 1), 25);
    const requestedCutoff = capturedHour(Date.now() - days * 24 * 60 * 60 * 1000);
    const cutoff = Math.max(
      requestedCutoff,
      capturedHour(RESOURCE_SPACE_REGION_SPLIT_AT),
    );
    const latestRow = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_hour", (q) => q.gte("capturedHour", cutoff))
      .order("desc")
      .first();

    if (!latestRow) {
      return {
        days,
        region,
        rowCount: 0,
        tenantCount: 0,
        earliestCapturedHour: null,
        latestCapturedHour: null,
        procurers: [],
        releasers: [],
        consumers: [],
      };
    }

    const baselineRow = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_hour", (q) => q.gte("capturedHour", cutoff))
      .order("asc")
      .first();
    const baselineHour = baselineRow?.capturedHour ?? latestRow.capturedHour;
    const latestHour = latestRow.capturedHour;

    const latestRows = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_hour", (q) => q.eq("capturedHour", latestHour))
      .take(MOVEMENT_HOUR_ROW_LIMIT);
    const baselineRows =
      baselineHour === latestHour
        ? []
        : await ctx.db
            .query("manageOneHourlySnapshots")
            .withIndex("by_hour", (q) => q.eq("capturedHour", baselineHour))
            .take(MOVEMENT_HOUR_ROW_LIMIT);
    const rows = [...baselineRows, ...latestRows];

    const scopedRows = rows.filter((row) => matchesRegionScope(row, region));
    const groups = new Map<
      string,
      {
        tenantName: string;
        vdcId: string;
        regionNames: Set<string>;
        regionIds: Set<string>;
        baselineTotals: ResourceTotals;
        currentTotals: ResourceTotals;
        hasBaseline: boolean;
      }
    >();

    for (const row of scopedRows) {
      const key = movementGroupKey(row, region);
      const group =
        groups.get(key) ??
        {
          tenantName: row.tenantName,
          vdcId: row.vdcId,
          regionNames: new Set<string>(),
          regionIds: new Set<string>(),
          baselineTotals: emptyResourceTotals(),
          currentTotals: emptyResourceTotals(),
          hasBaseline: false,
        };

      group.tenantName = row.tenantName;
      if (row.regionName) group.regionNames.add(row.regionName);
      if (row.regionId) group.regionIds.add(row.regionId);

      if (row.capturedHour === latestHour) {
        group.currentTotals = addTotals(group.currentTotals, resourceTotals(row));
      } else if (row.capturedHour === baselineHour) {
        group.baselineTotals = addTotals(
          group.baselineTotals,
          resourceTotals(row),
        );
        group.hasBaseline = true;
      }
      groups.set(key, group);
    }

    const movementRows = [...groups.entries()].map(([key, group]) => {
      const currentTotals = group.currentTotals;
      const baselineTotals = group.hasBaseline
        ? group.baselineTotals
        : currentTotals;
      const delta = subtractTotals(currentTotals, baselineTotals);
      const movementScore = resourceScore(delta);
      const consumptionScore = resourceScore(currentTotals);
      const regionIds = [...group.regionIds].filter(Boolean).sort();

      return {
        key,
        tenantName: group.tenantName,
        vdcId: group.vdcId,
        regionName: regionScopeLabel(group.regionNames),
        regionId:
          regionIds.length > 1
            ? regionIds.join(", ")
            : (regionIds[0] ?? undefined),
        latestCapturedHour: latestHour,
        baselineCapturedHour: baselineHour,
        current: currentTotals,
        delta,
        movementScore,
        consumptionScore,
      };
    });

    const procurers = movementRows
      .filter((row) => row.movementScore > 0)
      .sort((a, b) => b.movementScore - a.movementScore)
      .slice(0, limit);
    const releasers = movementRows
      .filter((row) => row.movementScore < 0)
      .sort((a, b) => a.movementScore - b.movementScore)
      .slice(0, limit);
    const consumers = movementRows
      .sort((a, b) => b.consumptionScore - a.consumptionScore)
      .slice(0, limit);

    const earliestCapturedHour = scopedRows.reduce(
      (earliest, row) => Math.min(earliest, row.capturedHour),
      Number.POSITIVE_INFINITY,
    );
    const latestCapturedHour = scopedRows.reduce(
      (latest, row) => Math.max(latest, row.capturedHour),
      0,
    );

    return {
      days,
      region,
      rowCount: scopedRows.length,
      tenantCount: groups.size,
      earliestCapturedHour: Number.isFinite(earliestCapturedHour)
        ? earliestCapturedHour
        : null,
      latestCapturedHour: latestCapturedHour || null,
      procurers,
      releasers,
      consumers,
    };
  },
});

export const dryRunOldHourlySnapshotsPage = internalQuery({
  args: {
    olderThanMs: v.optional(v.number()),
    nowMs: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const olderThanMs = args.olderThanMs ?? RETENTION_MS;
    const nowMs = args.nowMs ?? Date.now();
    const cutoff = capturedHour(nowMs - olderThanMs);
    const requestedItems = args.paginationOpts.numItems;
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.min(requestedItems, MAX_DRY_RUN_PAGE_SIZE),
    };
    const page = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_hour", (q) => q.lt("capturedHour", cutoff))
      .paginate(paginationOpts);
    const capturedHours = page.page.map((row) => row.capturedHour);

    return {
      dryRun: true,
      table: "manageOneHourlySnapshots",
      action: "count_only",
      olderThanMs,
      cutoff,
      pageCount: page.page.length,
      requestedPageSize: requestedItems,
      effectivePageSize: paginationOpts.numItems,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      oldestCapturedHour:
        capturedHours.length > 0 ? Math.min(...capturedHours) : null,
      newestCapturedHour:
        capturedHours.length > 0 ? Math.max(...capturedHours) : null,
    };
  },
});
