import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring } from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type TenantUsageHistoryRow = Doc<"tenantUsageHistory">;

const SYNC_RUN_BUCKET_MS = 5 * 60 * 1000;

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

  assertNotMonitoring(user);
  return user;
}

function assertCanViewTenantUsageHistory(user: Doc<"users">) {
  if (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  ) {
    return;
  }

  throw new ConvexError({
    code: "FORBIDDEN",
    message:
      "Only Country GM, Head of Business, or CEO can view tenant usage history",
  });
}

const usageHistoryItem = {
  tenantName: v.string(),
  ecsInstances: v.number(),
  ecsCores: v.number(),
  ecsRamGb: v.number(),
  rdsInstances: v.number(),
  cceClusters: v.number(),
  evsGb: v.number(),
  obsGb: v.number(),
  sfsGb: v.number(),
  publicIps: v.number(),
  wafInstances: v.number(),
  syncedAt: v.number(),
};

function createAggregateRow(row: TenantUsageHistoryRow): TenantUsageHistoryRow {
  return { ...row };
}

function addRowToAggregate(
  aggregate: TenantUsageHistoryRow,
  row: TenantUsageHistoryRow,
) {
  aggregate.ecsInstances += row.ecsInstances;
  aggregate.ecsCores += row.ecsCores;
  aggregate.ecsRamGb += row.ecsRamGb;
  aggregate.rdsInstances += row.rdsInstances;
  aggregate.cceClusters += row.cceClusters;
  aggregate.evsGb += row.evsGb;
  aggregate.obsGb += row.obsGb;
  aggregate.sfsGb += row.sfsGb;
  aggregate.publicIps += row.publicIps;
  aggregate.wafInstances += row.wafInstances;
  aggregate.tenantName = `${aggregate.tenantName}, ${row.tenantName}`;
}

export function aggregateTenantUsageHistoryRows(
  rows: TenantUsageHistoryRow[],
  limit: number,
): TenantUsageHistoryRow[] {
  const sortedRows = [...rows].sort((a, b) => a.syncedAt - b.syncedAt);
  const buckets: Array<{
    startedAt: number;
    aggregate: TenantUsageHistoryRow;
  }> = [];

  for (const row of sortedRows) {
    const currentBucket = buckets[buckets.length - 1];

    if (
      currentBucket &&
      row.syncedAt - currentBucket.startedAt <= SYNC_RUN_BUCKET_MS
    ) {
      addRowToAggregate(currentBucket.aggregate, row);
      continue;
    }

    buckets.push({
      startedAt: row.syncedAt,
      aggregate: createAggregateRow(row),
    });
  }

  return buckets
    .slice(Math.max(0, buckets.length - limit))
    .map((bucket) => bucket.aggregate);
}

export const bulkInsert = internalMutation({
  args: {
    rows: v.array(
      v.object({
        vdcId: v.string(),
        domainId: v.string(),
        managerEmail: v.optional(v.union(v.string(), v.null())),
        ...usageHistoryItem,
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skippedNoLinkedCompany = 0;

    for (const row of args.rows) {
      const tenantByDomain = await ctx.db
        .query("manageOneTenants")
        .withIndex("by_domain_id", (q) => q.eq("domainId", row.domainId))
        .first();
      const tenant =
        tenantByDomain ??
        (await ctx.db
          .query("manageOneTenants")
          .withIndex("by_vdc_id", (q) => q.eq("vdcId", row.vdcId))
          .first());

      if (!tenant?.linkedCompanyId) {
        skippedNoLinkedCompany++;
        continue;
      }

      await ctx.db.insert("tenantUsageHistory", {
        linkedCompanyId: tenant.linkedCompanyId,
        tenantName: row.tenantName,
        ecsInstances: row.ecsInstances,
        ecsCores: row.ecsCores,
        ecsRamGb: row.ecsRamGb,
        rdsInstances: row.rdsInstances,
        cceClusters: row.cceClusters,
        evsGb: row.evsGb,
        obsGb: row.obsGb,
        sfsGb: row.sfsGb,
        publicIps: row.publicIps,
        wafInstances: row.wafInstances,
        syncedAt: row.syncedAt,
      });
      inserted++;
    }

    return { inserted, skippedNoLinkedCompany };
  },
});

export const history = query({
  args: {
    companyId: v.id("companies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewTenantUsageHistory(user);

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 90), 1), 365);
    const rawLimit = Math.min(limit * 20, 2000);
    const rows = await ctx.db
      .query("tenantUsageHistory")
      .withIndex("by_company_synced_at", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .order("desc")
      .take(rawLimit);

    return aggregateTenantUsageHistoryRows(rows, limit);
  },
});
