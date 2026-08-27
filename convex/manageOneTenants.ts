import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { assertCanManageUsage, assertNotMonitoring } from "./authorization";
import { multiplyMoney } from "./money";

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
  serviceCategory?: string;
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

type ManageOneTenantDoc = Doc<"manageOneTenants">;
type ManageOneHourlySnapshotDoc = Doc<"manageOneHourlySnapshots">;

type ManageOneTenantWithLiveUsage = ManageOneTenantDoc & {
  liveUsageSyncedAt?: number;
  liveBmsInstances?: number;
  liveEcsCores?: number;
  liveEcsRamGb?: number;
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
    regionId?: string;
    regionName?: string;
  }[];
  evsVolumeTypes?: {
    volumeType: string;
    totalGb: number;
    count: number;
    regionId?: string;
    regionName?: string;
  }[];
  evsDiskManagedFees?: {
    count: number;
    resourceTypeName: string;
    regionId?: string;
    regionName?: string;
    items?: {
      count: number;
      resourceTypeName: string;
      regionId?: string;
      regionName?: string;
    }[];
  };
  obsBuckets?: {
    bucketName: string;
    totalGb: number;
    usedMb?: number;
    storageClass?: string;
    catalogItemName?: string;
    regionId?: string;
    regionName?: string;
  }[];
  eipBandwidths?: {
    tierName: string;
    count: number;
    totalMbps: number;
  }[];
  vpnGateways?: {
    count: number;
    resourceTypeName: string;
    items?: {
      id: string;
      name: string;
      resourceTypeName: string;
    }[];
  };
  cloudBastionHosts?: {
    count: number;
    resourceTypeName: string;
    items?: {
      id: string;
      name: string;
      resourceTypeName: string;
    }[];
  };
  natGateways?: {
    count: number;
    resourceTypeName: string;
    items?: {
      id: string;
      name: string;
      resourceTypeName: string;
      spec?: string;
      catalogItemName?: string;
      regionId?: string;
      regionName?: string;
    }[];
  };
};

type UsageHintCatalogItem = {
  _id: Id<"serviceCatalog">;
  serviceCategory: string;
  itemName: string;
  billingUnit?: string;
  monthlyPrice?: number;
  specs?: string;
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
    resource: "nat",
    serviceCategory: "NAT",
    pricing: "manual",
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
    if (!itemName) {
      return undefined;
    }

    const normalizedItemName = normalizeCatalogMatch(itemName);
    return catalog.find(
      (item) =>
        normalizeCatalogMatch(item.itemName).includes(normalizedItemName) &&
        (item.serviceCategory.toLowerCase().includes("bandwidth") ||
          item.serviceCategory.toLowerCase().includes("eip") ||
          item.itemName.toLowerCase().includes("mbps")),
    );
  }

  if (hint.serviceCategory === "VPN Gateway") {
    return catalog.find(
      (item) =>
        item.serviceCategory === "VPN Gateway" &&
        normalizeCatalogMatch(item.itemName) ===
          normalizeCatalogMatch("VPN Gateway"),
    );
  }

  if (hint.serviceCategory === "EVS Disk Managed Fee") {
    return catalog.find(
      (item) =>
        item.serviceCategory === "EVS" &&
        normalizeCatalogMatch(item.itemName) ===
          normalizeCatalogMatch("EVS - Disk Managed Fee"),
    );
  }

  if (hint.serviceCategory === "CBH") {
    const matches = catalog.filter(
      (item) =>
        normalizeCatalogMatch(item.itemName) ===
          normalizeCatalogMatch("Cloud Bastion Host") &&
        (item.serviceCategory === "CBH" ||
          normalizeCatalogMatch(item.serviceCategory).includes("bastion")),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  const matches = catalog.filter(
    (item) => item.serviceCategory === hint.serviceCategory,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeCatalogMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isCceFlavorName(value: string) {
  return normalizeCatalogMatch(value).startsWith("s2");
}

function findEcsCatalogItemForFlavor(
  flavorName: string,
  catalog: UsageHintCatalogItem[],
) {
  const normalizedFlavor = normalizeCatalogMatch(flavorName);
  const expectedCategories = isCceFlavorName(flavorName)
    ? ["ECS-CCE", "ECS"]
    : ["ECS"];

  return catalog.find(
    (item) =>
      expectedCategories.includes(item.serviceCategory) &&
      normalizeCatalogMatch(item.itemName) === normalizedFlavor,
  );
}

function findUniqueCatalogItemByName(
  catalog: UsageHintCatalogItem[],
  itemName: string,
) {
  const normalizedItemName = normalizeCatalogMatch(itemName);
  const matches = catalog.filter(
    (item) => normalizeCatalogMatch(item.itemName) === normalizedItemName,
  );

  return matches.length === 1 ? matches[0] : undefined;
}

function findObsCatalogItem(
  bucket: NonNullable<UsageHintTenant["obsBuckets"]>[number],
  catalog: UsageHintCatalogItem[],
) {
  const normalizedItemName = normalizeCatalogMatch(
    bucket.catalogItemName ?? "Fusion bucket",
  );
  const normalizedStorageClass = normalizeCatalogMatch(
    bucket.storageClass ?? "Standard",
  );
  const matches = catalog.filter(
    (item) =>
      item.serviceCategory === "OBS" &&
      item.billingUnit?.toLowerCase().includes("gb") &&
      normalizeCatalogMatch(item.itemName) === normalizedItemName,
  );
  const classMatches = matches.filter((item) =>
    normalizeCatalogMatch(`${item.itemName} ${item.specs ?? ""}`).includes(
      normalizedStorageClass,
    ),
  );

  if (classMatches.length === 1) {
    return classMatches[0];
  }

  if (normalizedStorageClass.includes("archive")) {
    return (
      classMatches[0] ??
      matches.find((item) =>
        normalizeCatalogMatch(`${item.itemName} ${item.specs ?? ""}`).includes(
          "archive",
        ),
      )
    );
  }

  const standardMatches = matches.filter(
    (item) =>
      !normalizeCatalogMatch(`${item.itemName} ${item.specs ?? ""}`).includes(
        "archive",
      ),
  );
  if (standardMatches.length === 1) {
    return standardMatches[0];
  }
  if (standardMatches.length > 1) {
    return [...standardMatches].sort(
      (a, b) => (b.monthlyPrice ?? 0) - (a.monthlyPrice ?? 0),
    )[0];
  }

  return [...matches].sort(
    (a, b) => (b.monthlyPrice ?? 0) - (a.monthlyPrice ?? 0),
  )[0];
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

const HOURLY_RESOURCE_KEYS = new Set([
  "ecs:instances",
  "cce:hybrid.resource.type.cce.cluster",
  "bms:instances",
  "evs:gigabytes",
  "sfs:gigabytes",
  "csbs:backup_capacity",
  "vbs:volume_backup_capacity",
  "obsv3:capacity",
  "vpc:publicIp",
  "vpc:endpoint",
  "vpc:loadbalancer",
  "vpc:vpn",
  "vpc:nat",
  "waf:waf.instance",
  "waf:waf.instance.100",
  "waf:waf.instance.500",
]);

function resourceKey(resource: UsageHintResource) {
  return `${resource.serviceId}:${resource.resource}`;
}

function hourlyResource(
  serviceId: string,
  resource: string,
  used: number | undefined,
): UsageHintResource | undefined {
  if (used == null || used <= 0) {
    return undefined;
  }
  return { serviceId, resource, used };
}

function optionalSnapshotNumber(
  snapshot: ManageOneHourlySnapshotDoc,
  key: string,
): number | undefined {
  const value = (snapshot as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function resourcesWithHourlyOverlay(
  tenant: ManageOneTenantDoc,
  snapshot: ManageOneHourlySnapshotDoc,
  options: { forBilling: boolean },
): UsageHintResource[] {
  const nightlyResources = (tenant.resources ?? []).filter(
    (resource) => !HOURLY_RESOURCE_KEYS.has(resourceKey(resource)),
  );
  const hasStructuredEcsBreakdown = (tenant.ecsFlavors ?? []).length > 0;
  const hasStructuredEvsBreakdown = (tenant.evsVolumeTypes ?? []).length > 0;
  const hasStructuredObsBreakdown = (tenant.obsBuckets ?? []).length > 0;
  const hasStructuredVpnBreakdown = (tenant.vpnGateways?.count ?? 0) > 0;
  const hasStructuredNatBreakdown =
    (tenant.natGateways?.items ?? []).length > 0;
  const wafBasicInstances = optionalSnapshotNumber(
    snapshot,
    "wafBasicInstances",
  );
  const wafEnterpriseInstances = optionalSnapshotNumber(
    snapshot,
    "wafEnterpriseInstances",
  );
  const hasWafTierBreakdown =
    (wafBasicInstances ?? 0) > 0 || (wafEnterpriseInstances ?? 0) > 0;
  const hourlyResources = [
    options.forBilling && hasStructuredEcsBreakdown
      ? undefined
      : hourlyResource("ecs", "instances", snapshot.ecsInstances),
    hourlyResource(
      "cce",
      "hybrid.resource.type.cce.cluster",
      optionalSnapshotNumber(snapshot, "cceNodes"),
    ),
    hourlyResource(
      "bms",
      "instances",
      optionalSnapshotNumber(snapshot, "bmsInstances"),
    ),
    options.forBilling && hasStructuredEvsBreakdown
      ? undefined
      : hourlyResource("evs", "gigabytes", snapshot.evsGb),
    hourlyResource(
      "sfs",
      "gigabytes",
      optionalSnapshotNumber(snapshot, "sfsGb"),
    ),
    hourlyResource(
      "csbs",
      "backup_capacity",
      optionalSnapshotNumber(snapshot, "csbsGb"),
    ),
    hourlyResource(
      "vbs",
      "volume_backup_capacity",
      optionalSnapshotNumber(snapshot, "vbsGb"),
    ),
    options.forBilling && hasStructuredObsBreakdown
      ? undefined
      : hourlyResource("obsv3", "capacity", snapshot.obsGb),
    hourlyResource("vpc", "publicIp", snapshot.publicIps),
    hourlyResource(
      "vpc",
      "endpoint",
      optionalSnapshotNumber(snapshot, "vpcepEndpoints"),
    ),
    hourlyResource("vpc", "loadbalancer", snapshot.loadBalancers),
    options.forBilling && hasStructuredVpnBreakdown
      ? undefined
      : hourlyResource("vpc", "vpn", snapshot.vpnGateways),
    options.forBilling && hasStructuredNatBreakdown
      ? undefined
      : hourlyResource("vpc", "nat", snapshot.natGateways),
    hasWafTierBreakdown
      ? undefined
      : hourlyResource("waf", "waf.instance", snapshot.wafInstances),
    hourlyResource("waf", "waf.instance.100", wafBasicInstances),
    hourlyResource("waf", "waf.instance.500", wafEnterpriseInstances),
  ].filter((resource): resource is UsageHintResource => Boolean(resource));

  return [...nightlyResources, ...hourlyResources];
}

function tenantWithHourlyUsage(
  tenant: ManageOneTenantDoc,
  snapshot?: ManageOneHourlySnapshotDoc | null,
  options: { forBilling: boolean } = { forBilling: false },
): ManageOneTenantWithLiveUsage {
  if (!snapshot) {
    return tenant;
  }

  return {
    ...tenant,
    regionId: snapshot.regionId ?? tenant.regionId,
    regionName: snapshot.regionName ?? tenant.regionName,
    ecsUsed: snapshot.ecsInstances,
    evsUsed: snapshot.evsGb,
    resources: resourcesWithHourlyOverlay(tenant, snapshot, options),
    liveUsageSyncedAt: snapshot.capturedAt,
    liveBmsInstances: optionalSnapshotNumber(snapshot, "bmsInstances"),
    liveEcsCores: snapshot.ecsCores,
    liveEcsRamGb: snapshot.ecsRamGb,
  };
}

function aggregateHourlySnapshots(
  rows: ManageOneHourlySnapshotDoc[],
): ManageOneHourlySnapshotDoc | null {
  if (rows.length === 0) {
    return null;
  }

  const latestHour = rows.reduce(
    (latest, row) => Math.max(latest, row.capturedHour),
    0,
  );
  const latestRows = rows.filter((row) => row.capturedHour === latestHour);
  const [first] = latestRows;

  if (latestRows.length === 1) {
    return first;
  }

  return latestRows.slice(1).reduce(
    (aggregate, row) => ({
      ...aggregate,
      capturedAt: Math.max(aggregate.capturedAt, row.capturedAt),
      ecsInstances: aggregate.ecsInstances + row.ecsInstances,
      cceNodes: (aggregate.cceNodes ?? 0) + (row.cceNodes ?? 0),
      bmsInstances: (aggregate.bmsInstances ?? 0) + (row.bmsInstances ?? 0),
      ecsCores: aggregate.ecsCores + row.ecsCores,
      ecsRamGb: aggregate.ecsRamGb + row.ecsRamGb,
      evsGb: aggregate.evsGb + row.evsGb,
      sfsGb: (aggregate.sfsGb ?? 0) + (row.sfsGb ?? 0),
      csbsGb: (aggregate.csbsGb ?? 0) + (row.csbsGb ?? 0),
      vbsGb: (aggregate.vbsGb ?? 0) + (row.vbsGb ?? 0),
      obsGb: aggregate.obsGb + row.obsGb,
      publicIps: aggregate.publicIps + row.publicIps,
      vpcepEndpoints:
        (aggregate.vpcepEndpoints ?? 0) + (row.vpcepEndpoints ?? 0),
      loadBalancers: aggregate.loadBalancers + row.loadBalancers,
      vpnGateways: aggregate.vpnGateways + row.vpnGateways,
      natGateways: aggregate.natGateways + row.natGateways,
      wafInstances: aggregate.wafInstances + row.wafInstances,
      wafBasicInstances:
        (aggregate.wafBasicInstances ?? 0) + (row.wafBasicInstances ?? 0),
      wafEnterpriseInstances:
        (aggregate.wafEnterpriseInstances ?? 0) +
        (row.wafEnterpriseInstances ?? 0),
    }),
    first,
  );
}

async function tenantsWithLatestHourlyUsage(
  ctx: QueryCtx,
  tenants: ManageOneTenantDoc[],
  options: { forBilling?: boolean } = {},
): Promise<ManageOneTenantWithLiveUsage[]> {
  const tenantsWithUsage: ManageOneTenantWithLiveUsage[] = [];

  for (const tenant of tenants) {
    const snapshots = await ctx.db
      .query("manageOneHourlySnapshots")
      .withIndex("by_vdc_hour", (q) => q.eq("vdcId", tenant.vdcId))
      .order("desc")
      .take(24);
    const snapshot = aggregateHourlySnapshots(snapshots);

    tenantsWithUsage.push(
      tenantWithHourlyUsage(tenant, snapshot, {
        forBilling: options.forBilling ?? false,
      }),
    );
  }

  return tenantsWithUsage;
}

export function buildUsageHintsForCompany(
  tenants: UsageHintTenant[],
  catalog: UsageHintCatalogItem[],
): UsageHint[] {
  const totals = new Map<string, UsageHint>();
  const ecsLineItems: UsageHintLineItem[] = [];
  const evsLineItems: UsageHintLineItem[] = [];
  const obsLineItems: UsageHintLineItem[] = [];
  const eipBandwidthLineItems: UsageHintLineItem[] = [];
  const natGatewayLineItems: UsageHintLineItem[] = [];
  const wafLineItems: UsageHintLineItem[] = [];
  const evsCatalog = catalog.filter((item) => item.serviceCategory === "EVS");
  const evsDiskManagedFeeCatalogItem = findUniqueCatalogItemByName(
    catalog,
    "EVS - Disk Managed Fee",
  );
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

    const vpnGatewayCount = tenant.vpnGateways?.count ?? 0;
    if (vpnGatewayCount > 0) {
      const key = `VPN Gateway:${regionKey(tenantRegionFields)}`;
      const existing = totals.get(key);
      if (existing) {
        existing.quantity += vpnGatewayCount;
      } else {
        totals.set(key, {
          serviceCategory: "VPN Gateway",
          quantity: vpnGatewayCount,
          pricing: "auto",
          ...tenantRegionFields,
        });
      }
    }

    const evsDiskManagedFeeItems =
      tenant.evsDiskManagedFees?.items &&
      tenant.evsDiskManagedFees.items.length > 0
        ? tenant.evsDiskManagedFees.items
        : tenant.evsDiskManagedFees
          ? [tenant.evsDiskManagedFees]
          : [];
    for (const evsDiskManagedFee of evsDiskManagedFeeItems) {
      const evsDiskManagedFeeCount = evsDiskManagedFee.count ?? 0;
      if (evsDiskManagedFeeCount <= 0) {
        continue;
      }
      const feeRegionFields = {
        ...tenantRegionFields,
        ...optionalRegionFields(evsDiskManagedFee),
      };
      evsLineItems.push({
        label: "EVS - Disk Managed Fee",
        serviceCategory: "EVS",
        quantity: evsDiskManagedFeeCount,
        pricing: evsDiskManagedFeeCatalogItem ? "auto" : "manual",
        ...(evsDiskManagedFeeCatalogItem
          ? { suggestedCatalogItemId: evsDiskManagedFeeCatalogItem._id }
          : { needsManualPricing: true }),
        ...feeRegionFields,
      });
    }

    for (const bucket of tenant.obsBuckets ?? []) {
      if (bucket.totalGb <= 0) {
        continue;
      }

      const catalogItem = findObsCatalogItem(bucket, catalog);
      const bucketRegionFields = {
        ...tenantRegionFields,
        ...optionalRegionFields(bucket),
      };
      obsLineItems.push({
        label: bucket.catalogItemName ?? "Fusion bucket",
        serviceCategory: "OBS",
        quantity: bucket.totalGb,
        pricing: catalogItem ? "auto" : "manual",
        ...(catalogItem ? { suggestedCatalogItemId: catalogItem._id } : {}),
        ...(!catalogItem ? { needsManualPricing: true } : {}),
        ...bucketRegionFields,
      });
    }

    const cloudBastionHostCount = tenant.cloudBastionHosts?.count ?? 0;
    if (cloudBastionHostCount > 0) {
      const key = `CBH:${regionKey(tenantRegionFields)}`;
      const existing = totals.get(key);
      if (existing) {
        existing.quantity += cloudBastionHostCount;
      } else {
        totals.set(key, {
          serviceCategory: "CBH",
          quantity: cloudBastionHostCount,
          pricing: "auto",
          ...tenantRegionFields,
        });
      }
    }

    for (const natGateway of tenant.natGateways?.items ?? []) {
      const catalogItemName = natGateway.catalogItemName ?? "";
      const catalogItem = catalog.find(
        (item) =>
          item.serviceCategory === "NAT" &&
          normalizeCatalogMatch(item.itemName) ===
            normalizeCatalogMatch(catalogItemName),
      );

      natGatewayLineItems.push({
        label: catalogItemName || natGateway.name || "NAT Gateway",
        serviceCategory: "NAT",
        quantity: 1,
        pricing: catalogItem ? "auto" : "manual",
        ...(catalogItem ? { suggestedCatalogItemId: catalogItem._id } : {}),
        ...(!catalogItem ? { needsManualPricing: true } : {}),
        ...tenantRegionFields,
        ...optionalRegionFields(natGateway),
      });
    }

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

      const catalogItem = findEcsCatalogItemForFlavor(
        flavor.flavorName,
        catalog,
      );
      const serviceCategory = catalogItem?.serviceCategory ?? "ECS";

      ecsLineItems.push({
        label: flavor.flavorName,
        ...(serviceCategory !== "ECS" ? { serviceCategory } : {}),
        quantity: flavor.count,
        pricing: catalogItem ? "auto" : "manual",
        ...(catalogItem ? { suggestedCatalogItemId: catalogItem._id } : {}),
        ...(!catalogItem ? { needsManualPricing: true } : {}),
        ...tenantRegionFields,
        ...optionalRegionFields(flavor),
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
        ...optionalRegionFields(volumeType),
      });
    }

    for (const bandwidth of tenant.eipBandwidths ?? []) {
      if (bandwidth.count <= 0) {
        continue;
      }

      const normalizedTierName = normalizeCatalogMatch(bandwidth.tierName);
      const catalogItem = catalog.find(
        (item) =>
          normalizeCatalogMatch(item.itemName).includes(normalizedTierName) &&
          (item.serviceCategory.toLowerCase().includes("bandwidth") ||
            item.serviceCategory.toLowerCase().includes("eip") ||
            item.itemName.toLowerCase().includes("mbps")),
      );

      eipBandwidthLineItems.push({
        label: bandwidth.tierName,
        quantity: bandwidth.count,
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
        resource.serviceId === "cce" &&
        resource.resource === "hybrid.resource.type.cce.cluster" &&
        ecsLineItems.some((item) => item.serviceCategory === "ECS-CCE")
      ) {
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
      if (
        resource.serviceId === "vpc" &&
        resource.resource === "bandwidth_size" &&
        eipBandwidthLineItems.length > 0
      ) {
        continue;
      }
      if (
        resource.serviceId === "obsv3" &&
        resource.resource === "capacity" &&
        obsLineItems.length > 0
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
    const ecsOnlyLineItems = ecsLineItems.filter(
      (item) => item.serviceCategory !== "ECS-CCE",
    );
    const cceLineItems = ecsLineItems.filter(
      (item) => item.serviceCategory === "ECS-CCE",
    );
    const ecsHint = {
      serviceCategory: "ECS",
      quantity: ecsOnlyLineItems.reduce((sum, item) => sum + item.quantity, 0),
      pricing: ecsOnlyLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: ecsOnlyLineItems,
    };
    if (ecsOnlyLineItems.length > 0 && existingEcsHintIndex >= 0) {
      hints[existingEcsHintIndex] = ecsHint;
    } else if (ecsOnlyLineItems.length > 0) {
      hints.unshift(ecsHint);
    }

    if (cceLineItems.length > 0) {
      const existingCceHintIndex = hints.findIndex(
        (hint) => hint.serviceCategory === "ECS-CCE",
      );
      const cceHint = {
        serviceCategory: "ECS-CCE",
        quantity: cceLineItems.reduce((sum, item) => sum + item.quantity, 0),
        pricing: cceLineItems.every((item) => item.pricing === "auto")
          ? ("auto" as const)
          : ("manual" as const),
        lineItems: cceLineItems,
      };
      if (existingCceHintIndex >= 0) {
        hints[existingCceHintIndex] = cceHint;
      } else {
        hints.unshift(cceHint);
      }
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

  if (obsLineItems.length > 0) {
    const existingObsHintIndex = hints.findIndex(
      (hint) => hint.serviceCategory === "OBS",
    );
    const obsHint = {
      serviceCategory: "OBS",
      quantity: obsLineItems.reduce((sum, item) => sum + item.quantity, 0),
      pricing: obsLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: obsLineItems,
    };
    if (existingObsHintIndex >= 0) {
      hints[existingObsHintIndex] = obsHint;
    } else {
      hints.push(obsHint);
    }
  }

  if (eipBandwidthLineItems.length > 0) {
    const existingEipBandwidthHintIndex = hints.findIndex(
      (hint) => hint.serviceCategory === "EIP (bandwidth)",
    );
    const eipBandwidthHint = {
      serviceCategory: "EIP (bandwidth)",
      quantity: eipBandwidthLineItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
      pricing: eipBandwidthLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: eipBandwidthLineItems,
    };
    if (existingEipBandwidthHintIndex >= 0) {
      hints[existingEipBandwidthHintIndex] = eipBandwidthHint;
    } else {
      hints.push(eipBandwidthHint);
    }
  }

  if (natGatewayLineItems.length > 0) {
    const existingNatHintIndex = hints.findIndex(
      (hint) => hint.serviceCategory === "NAT",
    );
    const natHint = {
      serviceCategory: "NAT",
      quantity: natGatewayLineItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      ),
      pricing: natGatewayLineItems.every((item) => item.pricing === "auto")
        ? ("auto" as const)
        : ("manual" as const),
      lineItems: natGatewayLineItems,
    };
    if (existingNatHintIndex >= 0) {
      hints[existingNatHintIndex] = natHint;
    } else {
      hints.push(natHint);
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
      const serviceType = lineItem.serviceCategory ?? hint.serviceCategory;
      if (lineItem.pricing !== "auto" || !lineItem.suggestedCatalogItemId) {
        needsManualEntry.push({
          serviceType,
          label: lineItem.label,
          reason: `${serviceType} ${lineItem.label} detected but has no catalog match - add manually.`,
        });
        continue;
      }

      const catalogItem = catalog.find(
        (item) => item._id === lineItem.suggestedCatalogItemId,
      );
      if (!catalogItem || catalogItem.monthlyPrice == null) {
        needsManualEntry.push({
          serviceType,
          label: lineItem.label,
          reason: `${serviceType} ${lineItem.label} detected but catalog pricing is unavailable - add manually.`,
        });
        continue;
      }

      rows.push({
        serviceType,
        catalogItemId: catalogItem._id,
        catalogItemName: catalogItem.itemName,
        quantity: lineItem.quantity,
        amount: multiplyMoney(
          catalogItem.monthlyPrice,
          lineItem.quantity,
          `${catalogItem.itemName} usage preview`,
        ),
        alreadyLogged: existingKeys.has(
          usagePreviewKey({
            serviceType,
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

  assertNotMonitoring(user);
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
        quotas: v.optional(
          v.array(
            v.object({
              projectId: v.optional(v.string()),
              projectName: v.optional(v.string()),
              quotaUnitId: v.optional(v.string()),
              serviceId: v.string(),
              serviceName: v.optional(v.string()),
              regionId: v.optional(v.string()),
              regionName: v.optional(v.string()),
              cloudInfraId: v.optional(v.string()),
              azId: v.optional(v.string()),
              parentId: v.optional(v.string()),
              resourceId: v.string(),
              resourceName: v.optional(v.string()),
              unit: v.optional(v.string()),
              limit: v.number(),
              used: v.number(),
              remaining: v.number(),
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
              regionId: v.optional(v.string()),
              regionName: v.optional(v.string()),
            }),
          ),
        ),
        evsVolumeTypes: v.optional(
          v.array(
            v.object({
              volumeType: v.string(),
              totalGb: v.number(),
              count: v.number(),
              regionId: v.optional(v.string()),
              regionName: v.optional(v.string()),
            }),
          ),
        ),
        evsDiskManagedFees: v.optional(
          v.object({
            count: v.number(),
            resourceTypeName: v.string(),
            regionId: v.optional(v.string()),
            regionName: v.optional(v.string()),
            items: v.optional(
              v.array(
                v.object({
                  count: v.number(),
                  resourceTypeName: v.string(),
                  regionId: v.optional(v.string()),
                  regionName: v.optional(v.string()),
                }),
              ),
            ),
          }),
        ),
        obsBuckets: v.optional(
          v.array(
            v.object({
              bucketName: v.string(),
              totalGb: v.number(),
              usedMb: v.optional(v.number()),
              storageClass: v.optional(v.string()),
              catalogItemName: v.optional(v.string()),
              regionId: v.optional(v.string()),
              regionName: v.optional(v.string()),
            }),
          ),
        ),
        eipBandwidths: v.optional(
          v.array(
            v.object({
              tierName: v.string(),
              count: v.number(),
              totalMbps: v.number(),
            }),
          ),
        ),
        vpnGateways: v.optional(
          v.object({
            count: v.number(),
            resourceTypeName: v.string(),
            items: v.optional(
              v.array(
                v.object({
                  id: v.string(),
                  name: v.string(),
                  resourceTypeName: v.string(),
                }),
              ),
            ),
          }),
        ),
        cloudBastionHosts: v.optional(
          v.object({
            count: v.number(),
            resourceTypeName: v.string(),
            items: v.optional(
              v.array(
                v.object({
                  id: v.string(),
                  name: v.string(),
                  resourceTypeName: v.string(),
                }),
              ),
            ),
          }),
        ),
        natGateways: v.optional(
          v.object({
            count: v.number(),
            resourceTypeName: v.string(),
            items: v.optional(
              v.array(
                v.object({
                  id: v.string(),
                  name: v.string(),
                  resourceTypeName: v.string(),
                  spec: v.optional(v.string()),
                  catalogItemName: v.optional(v.string()),
                  regionId: v.optional(v.string()),
                  regionName: v.optional(v.string()),
                }),
              ),
            ),
          }),
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

function stableSegment(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function dailyUsageSourceKeyFor(input: {
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

async function migrateOpenDailyUsageRows(
  ctx: MutationCtx,
  tenantId: Id<"manageOneTenants">,
  companyId: Id<"companies">,
) {
  const rows = (await ctx.db.query("dailyUsageSnapshots").collect()).filter(
    (row) =>
      row.tenantId === tenantId &&
      row.companyId !== companyId &&
      !row.invoiceId &&
      !row.lockedAt,
  );

  let moved = 0;
  let merged = 0;
  let skipped = 0;

  for (const row of rows) {
    const sourceKey = dailyUsageSourceKeyFor({
      companyId,
      tenantId,
      usageDate: row.usageDate,
      serviceType: row.serviceType,
      itemName: row.itemName,
      catalogItemId: row.catalogItemId,
      regionId: row.regionId,
      regionName: row.regionName,
      dataCenterName: row.dataCenterName,
    });

    const existing = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_source_key", (q) => q.eq("sourceKey", sourceKey))
      .unique();

    if (existing && existing._id !== row._id) {
      if (existing.invoiceId || existing.lockedAt) {
        skipped++;
        continue;
      }

      const { _id: _rowId, _creationTime: _rowCreationTime, ...patch } = row;
      await ctx.db.patch(existing._id, {
        ...patch,
        companyId,
        sourceKey,
      });
      await ctx.db.delete(row._id);
      merged++;
      continue;
    }

    await ctx.db.patch(row._id, {
      companyId,
      sourceKey,
    });
    moved++;
  }

  return { moved, merged, skipped };
}

async function deleteOpenDailyUsageRows(
  ctx: MutationCtx,
  tenantId: Id<"manageOneTenants">,
) {
  const rows = (await ctx.db.query("dailyUsageSnapshots").collect()).filter(
    (row) => row.tenantId === tenantId && !row.invoiceId && !row.lockedAt,
  );

  for (const row of rows) {
    await ctx.db.delete(row._id);
  }

  return rows.length;
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

export const reassignCompany = mutation({
  args: { tenantId: v.id("manageOneTenants"), companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can reassign tenants",
      });
    }

    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tenant not found" });
    }

    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }

    await ctx.db.patch(args.tenantId, { linkedCompanyId: args.companyId });
    const usageRows = await migrateOpenDailyUsageRows(
      ctx,
      args.tenantId,
      args.companyId,
    );

    return { linkedCompanyName: company.name, usageRows };
  },
});

export const unlinkFromCompany = mutation({
  args: { tenantId: v.id("manageOneTenants") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can unlink tenants",
      });
    }

    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tenant not found" });
    }

    await ctx.db.patch(args.tenantId, { linkedCompanyId: undefined });
    const removedOpenUsageRows = await deleteOpenDailyUsageRows(
      ctx,
      args.tenantId,
    );

    return { removedOpenUsageRows };
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
    const tenants = await ctx.db
      .query("manageOneTenants")
      .withIndex("by_linked_company", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .collect();

    return await tenantsWithLatestHourlyUsage(ctx, tenants);
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
    const tenantsWithUsage = await tenantsWithLatestHourlyUsage(ctx, tenants, {
      forBilling: true,
    });

    return {
      hints: buildUsageHintsForCompany(tenantsWithUsage, catalog),
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
    const tenantsWithUsage = await tenantsWithLatestHourlyUsage(ctx, tenants, {
      forBilling: true,
    });
    const hints = buildUsageHintsForCompany(tenantsWithUsage, catalog);

    return buildBulkUsagePreview(hints, catalog, existingEntries);
  },
});
