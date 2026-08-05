import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { assertCanManageUsage } from "./authorization";

type UsageHintPricing = "auto" | "manual";

export type UsageHint = {
  serviceCategory: string;
  quantity: number;
  pricing: UsageHintPricing;
  suggestedCatalogItemId?: Id<"serviceCatalog">;
  lineItems?: UsageHintLineItem[];
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

export type UsageHintLineItem = {
  label: string;
  quantity: number;
  pricing: UsageHintPricing;
  suggestedCatalogItemId?: Id<"serviceCatalog">;
  needsManualPricing?: boolean;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

type UsageHintResource = {
  serviceId: string;
  resource: string;
  used: number;
};

type UsageHintTenant = {
  regionId?: string;
  regionName?: string;
  resources?: UsageHintResource[];
  ecsFlavors?: {
    flavorName: string;
    vcpus: number;
    ramMb: number;
    count: number;
  }[];
  evsVolumeTypes?: {
    volumeType: string;
    totalGb: number;
    count: number;
  }[];
};

type UsageHintCatalogItem = {
  _id: Id<"serviceCatalog">;
  serviceCategory: string;
  itemName: string;
  billingUnit?: string;
  monthlyPrice?: number;
};

export type BulkUsagePreviewRow = {
  serviceType: string;
  catalogItemId: Id<"serviceCatalog">;
  catalogItemName: string;
  quantity: number;
  amount: number;
  alreadyLogged: boolean;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

export type BulkUsageManualItem = {
  serviceType: string;
  label: string;
  reason: string;
};

type HintRule = {
  serviceId: string;
  resource: string;
  serviceCategory: string;
  pricing: UsageHintPricing;
};

const USAGE_HINT_RULES: HintRule[] = [
  {
    serviceId: "ecs",
    resource: "instances",
    serviceCategory: "ECS",
    pricing: "manual",
  },
  {
    serviceId: "bms",
    resource: "instances",
    serviceCategory: "BMS",
    pricing: "auto",
  },
  {
    serviceId: "rds",
    resource: "instance",
    serviceCategory: "RDS",
    pricing: "auto",
  },
  {
    serviceId: "cce",
    resource: "hybrid.resource.type.cce.cluster",
    serviceCategory: "ECS-CCE",
    pricing: "auto",
  },
  {
    serviceId: "evs",
    resource: "gigabytes",
    serviceCategory: "EVS",
    pricing: "manual",
  },
  {
    serviceId: "sfs",
    resource: "gigabytes",
    serviceCategory: "SFS",
    pricing: "auto",
  },
  {
    serviceId: "obsv3",
    resource: "capacity",
    serviceCategory: "OBS",
    pricing: "manual",
  },
  {
    serviceId: "csbs",
    resource: "backup_capacity",
    serviceCategory: "CSBS",
    pricing: "auto",
  },
  {
    serviceId: "vbs",
    resource: "volume_backup_capacity",
    serviceCategory: "VBS",
    pricing: "auto",
  },
  {
    serviceId: "vpc",
    resource: "publicIp",
    serviceCategory: "EIP",
    pricing: "auto",
  },
  {
    serviceId: "vpc",
    resource: "bandwidth_size",
    serviceCategory: "EIP (bandwidth)",
    pricing: "auto",
  },
  {
    serviceId: "vpc",
    resource: "loadbalancer",
    serviceCategory: "ELB",
    pricing: "auto",
  },
  {
    serviceId: "vpc",
    resource: "vpn",
    serviceCategory: "VPN",
    pricing: "auto",
  },
  {
    serviceId: "vpc",
    resource: "endpoint_service",
    serviceCategory: "VPCEP",
    pricing: "auto",
  },
  {
    serviceId: "waf",
    resource: "waf.instance",
    serviceCategory: "WAF",
    pricing: "manual",
  },
];

function findCatalogItemForHint(
  hint: Pick<UsageHint, "serviceCategory" | "quantity">,
  catalog: UsageHintCatalogItem[],
) {
  if (hint.serviceCategory === "EIP") {
    return catalog.find(
      (item) =>
        item.serviceCategory === "EIP" && item.itemName === "EIP - Active",
    );
  }

  if (hint.serviceCategory === "EIP (bandwidth)") {
    const quantity = hint.quantity;
    const itemName =
      quantity >= 1 && quantity <= 5
        ? "1 - 5 Mbps"
        : quantity >= 6 && quantity <= 50
          ? "6 - 50 Mbps"
          : quantity >= 51 && quantity <= 200
            ? "51 - 200 Mbps"
            : null;

    return itemName
      ? catalog.find(
          (item) =>
            item.serviceCategory === "EIP Bandwidth" &&
            item.itemName === itemName,
        )
      : undefined;
  }

  const matches = catalog.filter(
    (item) => item.serviceCategory === hint.serviceCategory,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeCatalogMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function regionKey(source: {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return source.regionId ?? source.regionName ?? source.dataCenterName ?? "";
}

function usagePreviewKey(source: {
  serviceType: string;
  catalogItemId?: Id<"serviceCatalog">;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return `${source.serviceType}:${source.catalogItemId ?? ""}:${regionKey(source)}`;
}

export function buildUsageHintsForCompany(
  tenants: UsageHintTenant[],
  catalog: UsageHintCatalogItem[],
): UsageHint[] {
  const totals = new Map<string, UsageHint>();
  const ecsLineItems: UsageHintLineItem[] = [];
  const evsLineItems: UsageHintLineItem[] = [];
  const wafLineItems: UsageHintLineItem[] = [];
  const ecsCatalog = catalog.filter((item) => item.serviceCategory === "ECS");
  const evsCatalog = catalog.filter((item) => item.serviceCategory === "EVS");
  const basicWafCatalogItem = catalog.find(
    (item) => item.serviceCategory === "WAF" && item.itemName === "Basic WAF",
  );
  const enterpriseWafCatalogItem = catalog.find(
    (item) =>
      item.serviceCategory === "WAF" && item.itemName === "Enterprise WAF",
  );

  for (const tenant of tenants) {
    const tenantRegionFields = optionalRegionFields(tenant);
    const tenantResources = tenant.resources ?? [];
    const wafBasicQuantity = tenantResources
      .filter(
        (resource) =>
          resource.serviceId === "waf" &&
          resource.resource === "waf.instance.100" &&
          resource.used > 0,
      )
      .reduce((sum, resource) => sum + resource.used, 0);
    const wafEnterpriseQuantity = tenantResources
      .filter(
        (resource) =>
          resource.serviceId === "waf" &&
          resource.resource === "waf.instance.500" &&
          resource.used > 0,
      )
      .reduce((sum, resource) => sum + resource.used, 0);
    const hasWafTierSignal = wafBasicQuantity > 0 || wafEnterpriseQuantity > 0;

    if (wafBasicQuantity > 0 && wafEnterpriseQuantity > 0) {
      wafLineItems.push({
        label: "WAF tier conflict (100 and 500)",
        quantity: wafBasicQuantity + wafEnterpriseQuantity,
        pricing: "manual",
        needsManualPricing: true,
        ...tenantRegionFields,
      });
    } else if (wafBasicQuantity > 0) {
      wafLineItems.push({
        label: "Basic WAF",
        quantity: wafBasicQuantity,
        pricing: basicWafCatalogItem ? "auto" : "manual",
        ...(basicWafCatalogItem
          ? { suggestedCatalogItemId: basicWafCatalogItem._id }
          : { needsManualPricing: true }),
        ...tenantRegionFields,
      });
    } else if (wafEnterpriseQuantity > 0) {
      wafLineItems.push({
        label: "Enterprise WAF",
        quantity: wafEnterpriseQuantity,
        pricing: enterpriseWafCatalogItem ? "auto" : "manual",
        ...(enterpriseWafCatalogItem
          ? { suggestedCatalogItemId: enterpriseWafCatalogItem._id }
          : { needsManualPricing: true }),
        ...tenantRegionFields,
      });
    }

    for (const flavor of tenant.ecsFlavors ?? []) {
      if (flavor.count <= 0) {
        continue;
      }

      const catalogItem = ecsCatalog.find(
        (item) =>
          item.itemName.toLowerCase() === flavor.flavorName.toLowerCase(),
      );

      ecsLineItems.push({
        label: flavor.flavorName,
        quantity: flavor.count,
        pricing: catalogItem ? "auto" : "manual",
        ...(catalogItem ? { suggestedCatalogItemId: catalogItem._id } : {}),
        ...(!catalogItem ? { needsManualPricing: true } : {}),
        ...tenantRegionFields,
      });
    }

    for (const volumeType of tenant.evsVolumeTypes ?? []) {
      if (volumeType.totalGb <= 0) {
        continue;
      }

      const normalizedVolumeType = normalizeCatalogMatch(volumeType.volumeType);
      const catalogMatches = evsCatalog.filter(
        (item) =>
          normalizeCatalogMatch(item.itemName).includes(normalizedVolumeType) &&
          item.billingUnit?.toLowerCase().includes("gb"),
      );
      const catalogItem =
        catalogMatches.length === 1 ? catalogMatches[0] : undefined;

      evsLineItems.push({
        label: volumeType.volumeType,
        quantity: volumeType.totalGb,
        pricing: catalogItem ? "auto" : "manual",
        ...(catalogItem ? { suggestedCatalogItemId: catalogItem._id } : {}),
        ...(!catalogItem ? { needsManualPricing: true } : {}),
        ...tenantRegionFields,
      });
    }

    for (const resource of tenantResources) {
      if (resource.used <= 0) {
        continue;
      }
      if (
        resource.serviceId === "waf" &&
        (resource.resource === "waf.instance.100" ||
          resource.resource === "waf.instance.500" ||
          (resource.resource === "waf.instance" && hasWafTierSignal))
      ) {
        continue;
      }

      const rule = USAGE_HINT_RULES.find(
        (candidate) =>
          candidate.serviceId === resource.serviceId &&
          candidate.resource === resource.resource,
      );

      if (!rule) {
        continue;
      }

      const key = `${rule.serviceCategory}:${regionKey(tenantRegionFields)}`;
      const existing = totals.get(key);
      if (existing) {
        existing.quantity += resource.used;
      } else {
        totals.set(key, {
          serviceCategory: rule.serviceCategory,
          quantity: resource.used,
          pricing: rule.pricing,
          ...tenantRegionFields,
        });
      }
    }
  }

  const hints = [...totals.values()].map((hint) => {
    if (hint.pricing !== "auto") {
      return hint;
    }

    const catalogItem = findCatalogItemForHint(hint, catalog);
    if (!catalogItem) {
      return { ...hint, pricing: "manual" as const };
    }

    return {
      ...hint,
      suggestedCatalogItemId: catalogItem._id,
    };
  });

  if (ecsLineItems.length > 0) {
    const existingEcsHintIndex = hints.findIndex(
      (hint) => hint.serviceCategory === "ECS",
    );
    const ecsHint = {
      serviceCategory: "ECS",
      quantity: ecsLineItems.reduce((sum, item) => sum + item.quantity, 0),
      pricing: ecsLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: ecsLineItems,
    };
    if (existingEcsHintIndex >= 0) {
      hints[existingEcsHintIndex] = ecsHint;
    } else {
      hints.unshift(ecsHint);
    }
  }

  if (evsLineItems.length > 0) {
    const existingEvsHintIndex = hints.findIndex(
      (hint) => hint.serviceCategory === "EVS",
    );
    const evsHint = {
      serviceCategory: "EVS",
      quantity: evsLineItems.reduce((sum, item) => sum + item.quantity, 0),
      pricing: evsLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: evsLineItems,
    };
    if (existingEvsHintIndex >= 0) {
      hints[existingEvsHintIndex] = evsHint;
    } else {
      hints.unshift(evsHint);
    }
  }

  if (wafLineItems.length > 0) {
    const existingWafHintIndex = hints.findIndex(
      (hint) => hint.serviceCategory === "WAF",
    );
    const wafHint = {
      serviceCategory: "WAF",
      quantity: wafLineItems.reduce((sum, item) => sum + item.quantity, 0),
      pricing: wafLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: wafLineItems,
    };
    if (existingWafHintIndex >= 0) {
      hints[existingWafHintIndex] = wafHint;
    } else {
      hints.push(wafHint);
    }
  }

  return hints;
}

export function buildBulkUsagePreview(
  hints: UsageHint[],
  catalog: UsageHintCatalogItem[],
  existingEntries: Array<{
    serviceType: string;
    catalogItemId?: Id<"serviceCatalog">;
    regionId?: string;
    regionName?: string;
    dataCenterName?: string;
  }>,
): { rows: BulkUsagePreviewRow[]; needsManualEntry: BulkUsageManualItem[] } {
  const existingKeys = new Set(
    existingEntries
      .filter((entry) => entry.catalogItemId)
      .map((entry) =>
        usagePreviewKey({
          serviceType: entry.serviceType,
          catalogItemId: entry.catalogItemId,
          ...optionalRegionFields(entry),
        }),
      ),
  );
  const rows: BulkUsagePreviewRow[] = [];
  const needsManualEntry: BulkUsageManualItem[] = [];

  for (const hint of hints) {
    const lineItems =
      hint.lineItems ??
      (hint.pricing === "auto" && hint.suggestedCatalogItemId
        ? [
            {
              label: hint.serviceCategory,
              quantity: hint.quantity,
              pricing: hint.pricing,
              suggestedCatalogItemId: hint.suggestedCatalogItemId,
              ...optionalRegionFields(hint),
            },
          ]
        : []);

    if (!lineItems.length && hint.pricing === "manual") {
      needsManualEntry.push({
        serviceType: hint.serviceCategory,
        label: hint.serviceCategory,
        reason: `${hint.serviceCategory} detected but has no confident catalog match - add manually.`,
      });
    }

    for (const lineItem of lineItems) {
      if (lineItem.pricing !== "auto" || !lineItem.suggestedCatalogItemId) {
        needsManualEntry.push({
          serviceType: hint.serviceCategory,
          label: lineItem.label,
          reason: `${hint.serviceCategory} ${lineItem.label} detected but has no catalog match - add manually.`,
        });
        continue;
      }

      const catalogItem = catalog.find(
        (item) => item._id === lineItem.suggestedCatalogItemId,
      );
      if (!catalogItem || catalogItem.monthlyPrice == null) {
        needsManualEntry.push({
          serviceType: hint.serviceCategory,
          label: lineItem.label,
          reason: `${hint.serviceCategory} ${lineItem.label} detected but catalog pricing is unavailable - add manually.`,
        });
        continue;
      }

      rows.push({
        serviceType: hint.serviceCategory,
        catalogItemId: catalogItem._id,
        catalogItemName: catalogItem.itemName,
        quantity: lineItem.quantity,
        amount: lineItem.quantity * catalogItem.monthlyPrice,
        alreadyLogged: existingKeys.has(
          usagePreviewKey({
            serviceType: hint.serviceCategory,
            catalogItemId: catalogItem._id,
            ...optionalRegionFields(lineItem),
          }),
        ),
        ...optionalRegionFields(lineItem),
      });
    }
  }

  return { rows, needsManualEntry };
}

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

export const bulkUpsert = internalMutation({
  args: {
    tenants: v.array(
      v.object({
        vdcId: v.string(),
        domainId: v.optional(v.string()),
        name: v.string(),
        level: v.optional(v.number()),
        upperVdcId: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        managerName: v.optional(v.string()),
        managerPhone: v.optional(v.string()),
        managerEmail: v.optional(v.string()),
        regionId: v.optional(v.string()),
        regionName: v.optional(v.string()),
        ecsUsed: v.optional(v.number()),
        evsUsed: v.optional(v.number()),
        projectCount: v.optional(v.number()),
        resources: v.optional(
          v.array(
            v.object({
              serviceId: v.string(),
              resource: v.string(),
              used: v.number(),
              total: v.optional(v.number()),
            }),
          ),
        ),
        ecsFlavors: v.optional(
          v.array(
            v.object({
              flavorName: v.string(),
              vcpus: v.number(),
              ramMb: v.number(),
              count: v.number(),
            }),
          ),
        ),
        evsVolumeTypes: v.optional(
          v.array(
            v.object({
              volumeType: v.string(),
              totalGb: v.number(),
              count: v.number(),
            }),
          ),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let upserted = 0;

    for (const tenant of args.tenants) {
      const existing = await ctx.db
        .query("manageOneTenants")
        .withIndex("by_vdc_id", (q) => q.eq("vdcId", tenant.vdcId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { ...tenant, lastSyncedAt: now });
      } else {
        await ctx.db.insert("manageOneTenants", {
          ...tenant,
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
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can view ManageOne tenants",
      });
    }

    return await ctx.db.query("manageOneTenants").collect();
  },
});

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(vdc|system|test|ltd|inc|co)$/g, "");
}

export const listWithSuggestions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can view this",
      });
    }

    const tenants = await ctx.db.query("manageOneTenants").collect();
    const companies = await ctx.db.query("companies").collect();

    return tenants.map((tenant) => {
      const linkedCompany = tenant.linkedCompanyId
        ? companies.find((company) => company._id === tenant.linkedCompanyId)
        : undefined;

      if (tenant.linkedCompanyId) {
        return {
          ...tenant,
          linkedCompanyName: linkedCompany?.name ?? null,
          suggestedCompanyId: null,
          suggestedCompanyName: null,
        };
      }

      const norm = normalizeName(tenant.name);
      const match = companies.find((company) => {
        const companyNorm = normalizeName(company.name);
        return (
          companyNorm === norm ||
          (norm.length >= 4 &&
            (companyNorm.includes(norm) || norm.includes(companyNorm)))
        );
      });

      return {
        ...tenant,
        linkedCompanyName: null,
        suggestedCompanyId: match?._id ?? null,
        suggestedCompanyName: match?.name ?? null,
      };
    });
  },
});

export const linkToCompany = mutation({
  args: { tenantId: v.id("manageOneTenants"), companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can link tenants",
      });
    }

    await ctx.db.patch(args.tenantId, { linkedCompanyId: args.companyId });
  },
});

export const createCompanyFromTenant = mutation({
  args: {
    tenantId: v.id("manageOneTenants"),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
    accountManagerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can create companies",
      });
    }

    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tenant not found" });
    }

    const companyId = await ctx.db.insert("companies", {
      name: tenant.name,
      sectorId: args.sectorId,
      countryId: args.countryId,
      accountManagerId: args.accountManagerId,
      contractStatus: "pending",
      contactName: tenant.managerName,
      contactEmail: tenant.managerEmail,
    });

    await ctx.db.patch(args.tenantId, { linkedCompanyId: companyId });
    return companyId;
  },
});

export const getByCompanyId = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db
      .query("manageOneTenants")
      .withIndex("by_linked_company", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .collect();
  },
});

export const getUsageHintsForCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);

    const tenants = await ctx.db
      .query("manageOneTenants")
      .withIndex("by_linked_company", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();

    return {
      hints: buildUsageHintsForCompany(tenants, catalog),
    };
  },
});

export const getBulkUsagePreview = query({
  args: { companyId: v.id("companies"), month: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, user, args.companyId);

    const tenants = await ctx.db
      .query("manageOneTenants")
      .withIndex("by_linked_company", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const existingEntries = await ctx.db
      .query("consumption")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
    const hints = buildUsageHintsForCompany(tenants, catalog);

    return buildBulkUsagePreview(hints, catalog, existingEntries);
  },
});
