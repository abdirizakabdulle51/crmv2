import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth } from "./authorization";

type Ctx = QueryCtx | MutationCtx;

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RETENTION_DELETE_PER_SYNC = 200;

const hourlySnapshotInputValidator = v.object({
  vdcId: v.string(),
  domainId: v.optional(v.string()),
  tenantName: v.string(),
  regionId: v.optional(v.string()),
  regionName: v.optional(v.string()),
  capturedAt: v.number(),
  ecsInstances: v.number(),
  ecsCores: v.number(),
  ecsRamGb: v.number(),
  evsGb: v.number(),
  obsGb: v.number(),
  publicIps: v.number(),
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

    return rows;
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
    return await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_company_hour", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .order("desc")
      .take(limit);
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
