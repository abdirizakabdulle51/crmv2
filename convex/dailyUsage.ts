import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertCanManageUsage,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";
import { buildUsageHintsForCompany } from "./manageOneTenants";

type CatalogItem = Doc<"serviceCatalog">;
type ManageOneTenant = Doc<"manageOneTenants">;

export type DailyUsageSnapshotInput = {
  companyId: Id<"companies">;
  tenantId: Id<"manageOneTenants">;
  tenantName: string;
  tenantVdcId: string;
  tenantDomainId?: string;
  usageDate: string;
  month: string;
  serviceType: string;
  itemName: string;
  serviceCategory: string;
  quantity: number;
  unit: string;
  catalogItemId?: Id<"serviceCatalog">;
  source: "manageone";
  sourceKey: string;
  sourceSyncedAt?: number;
  capturedAt: number;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

const BUSINESS_TIME_ZONE = "Africa/Mogadishu";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx) {
  return ctx.auth.getUserIdentity().then(async (identity) => {
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
  });
}

export function dateKeyForTimestamp(
  timestamp: number,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to format daily usage date");
  }

  return `${year}-${month}-${day}`;
}

function assertValidDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "usageDate must use YYYY-MM-DD format",
    });
  }
}

function optionalRegionFields(source: {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return {
    ...(source.regionId ? { regionId: source.regionId } : {}),
    ...(source.regionName ? { regionName: source.regionName } : {}),
    ...(source.dataCenterName ? { dataCenterName: source.dataCenterName } : {}),
  };
}

function stableSegment(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function defaultUnitForService(serviceCategory: string) {
  const normalized = serviceCategory.toLowerCase();
  if (
    normalized.includes("obs") ||
    normalized.includes("evs") ||
    normalized.includes("sfs")
  ) {
    return "GB/day snapshot";
  }
  if (normalized.includes("bandwidth")) {
    return "Mbps/day snapshot";
  }
  if (normalized.includes("eip")) {
    return "IP/day snapshot";
  }
  return "unit/day snapshot";
}

function sourceKeyFor(input: {
  companyId: Id<"companies">;
  tenantId: Id<"manageOneTenants">;
  usageDate: string;
  serviceType: string;
  itemName: string;
  catalogItemId?: Id<"serviceCatalog">;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return [
    "manageone",
    input.usageDate,
    input.companyId,
    input.tenantId,
    stableSegment(input.serviceType),
    input.catalogItemId ?? stableSegment(input.itemName),
    stableSegment(input.regionId ?? input.regionName ?? input.dataCenterName),
  ].join("|");
}

export function buildDailyUsageRowsFromManageOneTenants(
  tenants: ManageOneTenant[],
  catalog: CatalogItem[],
  usageDate: string,
  capturedAt: number,
): DailyUsageSnapshotInput[] {
  const month = usageDate.slice(0, 7);
  const rows: DailyUsageSnapshotInput[] = [];

  for (const tenant of tenants) {
    if (!tenant.linkedCompanyId) {
      continue;
    }

    const hints = buildUsageHintsForCompany([tenant], catalog);
    for (const hint of hints) {
      const lineItems =
        hint.lineItems ??
        (hint.suggestedCatalogItemId
          ? [
              {
                label: hint.serviceCategory,
                serviceCategory: hint.serviceCategory,
                quantity: hint.quantity,
                pricing: hint.pricing,
                suggestedCatalogItemId: hint.suggestedCatalogItemId,
                ...optionalRegionFields(hint),
              },
            ]
          : []);

      for (const lineItem of lineItems) {
        if (lineItem.quantity <= 0) {
          continue;
        }

        const serviceCategory =
          lineItem.serviceCategory ?? hint.serviceCategory;
        const catalogItem = lineItem.suggestedCatalogItemId
          ? catalog.find((item) => item._id === lineItem.suggestedCatalogItemId)
          : undefined;
        const itemName = catalogItem?.itemName ?? lineItem.label;
        const regionFields = optionalRegionFields({
          ...optionalRegionFields(hint),
          ...optionalRegionFields(lineItem),
        });

        rows.push({
          companyId: tenant.linkedCompanyId,
          tenantId: tenant._id,
          tenantName: tenant.name,
          tenantVdcId: tenant.vdcId,
          ...(tenant.domainId ? { tenantDomainId: tenant.domainId } : {}),
          usageDate,
          month,
          serviceType: serviceCategory,
          itemName,
          serviceCategory,
          quantity: lineItem.quantity,
          unit:
            catalogItem?.billingUnit ?? defaultUnitForService(serviceCategory),
          ...(catalogItem ? { catalogItemId: catalogItem._id } : {}),
          source: "manageone",
          sourceKey: sourceKeyFor({
            companyId: tenant.linkedCompanyId,
            tenantId: tenant._id,
            usageDate,
            serviceType: serviceCategory,
            itemName,
            catalogItemId: catalogItem?._id,
            ...regionFields,
          }),
          sourceSyncedAt: tenant.lastSyncedAt,
          capturedAt,
          ...regionFields,
        });
      }
    }
  }

  return rows;
}

export const captureFromManageOneSnapshots = internalMutation({
  args: {
    usageDate: v.optional(v.string()),
    capturedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const capturedAt = args.capturedAt ?? Date.now();
    const usageDate = args.usageDate ?? dateKeyForTimestamp(capturedAt);
    assertValidDateKey(usageDate);

    const tenants = await ctx.db.query("manageOneTenants").collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const rows = buildDailyUsageRowsFromManageOneTenants(
      tenants,
      catalog,
      usageDate,
      capturedAt,
    );

    let inserted = 0;
    let updated = 0;
    let skippedLocked = 0;

    for (const row of rows) {
      const existing = await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_source_key", (q) => q.eq("sourceKey", row.sourceKey))
        .unique();

      if (existing?.lockedAt || existing?.invoiceId) {
        skippedLocked++;
        continue;
      }

      if (existing) {
        await ctx.db.patch(existing._id, row);
        updated++;
      } else {
        await ctx.db.insert("dailyUsageSnapshots", row);
        inserted++;
      }
    }

    return {
      usageDate,
      inspectedTenants: tenants.length,
      capturedRows: rows.length,
      inserted,
      updated,
      skippedLocked,
    };
  },
});

export const listByCompanyMonth = query({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, user, args.companyId);

    return await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
  },
});

export const review = query({
  args: {
    month: v.string(),
    companyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);

    const rows = args.companyId
      ? await ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_company_month", (q) =>
            q.eq("companyId", args.companyId!).eq("month", args.month),
          )
          .collect()
      : await ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_month", (q) => q.eq("month", args.month))
          .collect();

    const visibleRows = [];
    const companyNameById = new Map<Id<"companies">, string>();

    for (const row of rows) {
      const company = args.companyId
        ? await assertCanManageUsage(ctx, user, row.companyId)
        : await ctx.db.get(row.companyId);
      if (!company || !canViewCompany(user, company)) {
        continue;
      }
      visibleRows.push(row);
      companyNameById.set(row.companyId, company.name);
    }

    const serviceTypes = [...new Set(visibleRows.map((row) => row.serviceType))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const usageDates = [...new Set(visibleRows.map((row) => row.usageDate))]
      .filter(Boolean)
      .sort();
    const companies = [...companyNameById.entries()]
      .map(([companyId, companyName]) => ({ companyId, companyName }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));

    const sortedRows = [...visibleRows].sort((a, b) => {
      const dateCompare = b.usageDate.localeCompare(a.usageDate);
      if (dateCompare !== 0) return dateCompare;
      const companyCompare = (
        companyNameById.get(a.companyId) ?? ""
      ).localeCompare(companyNameById.get(b.companyId) ?? "");
      if (companyCompare !== 0) return companyCompare;
      return a.serviceType.localeCompare(b.serviceType);
    });

    return {
      month: args.month,
      rows: sortedRows.map((row) => ({
        ...row,
        companyName: companyNameById.get(row.companyId) ?? "Unknown",
      })),
      summary: {
        rowCount: visibleRows.length,
        companyCount: companies.length,
        serviceCount: serviceTypes.length,
        dayCount: usageDates.length,
        capturedCount: visibleRows.filter((row) => !row.lockedAt).length,
        lockedCount: visibleRows.filter((row) => row.lockedAt).length,
      },
      filters: {
        companies,
        serviceTypes,
        usageDates,
      },
    };
  },
});
