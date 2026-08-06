import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel.d.ts";

const http = httpRouter();

auth.addHttpRoutes(http);

type ManageOneTenantInput = {
  vdcId: string;
  domainId?: string;
  name: string;
  level?: number;
  upperVdcId?: string;
  enabled?: boolean;
  managerName?: string;
  managerPhone?: string;
  managerEmail?: string;
  regionId?: string;
  regionName?: string;
  ecsUsed?: number;
  evsUsed?: number;
  projectCount?: number;
  resources?: ManageOneResourceInput[];
  ecsFlavors?: ManageOneEcsFlavorInput[];
  evsVolumeTypes?: ManageOneEvsVolumeTypeInput[];
  evsDiskManagedFees?: ManageOneEvsDiskManagedFeeInput;
  eipBandwidths?: ManageOneEipBandwidthInput[];
  vpnGateways?: ManageOneVpnGatewayInput;
  cloudBastionHosts?: ManageOneCloudBastionHostInput;
};

type ManageOneResourceInput = {
  serviceId: string;
  resource: string;
  used: number;
  total?: number;
};

type ManageOneEcsFlavorInput = {
  flavorName: string;
  vcpus: number;
  ramMb: number;
  count: number;
};

type ManageOneEvsVolumeTypeInput = {
  volumeType: string;
  totalGb: number;
  count: number;
};

type ManageOneEvsDiskManagedFeeInput = {
  count: number;
  resourceTypeName: string;
};

type ManageOneEipBandwidthInput = {
  tierName: string;
  count: number;
  totalMbps: number;
};

type ManageOneVpnGatewayInput = {
  count: number;
  resourceTypeName: string;
  items?: {
    id: string;
    name: string;
    resourceTypeName: string;
  }[];
};

type ManageOneCloudBastionHostInput = {
  count: number;
  resourceTypeName: string;
  items?: {
    id: string;
    name: string;
    resourceTypeName: string;
  }[];
};

type AiRecommendationSyncInput = {
  companyId: string;
  narrative: string;
  topPriority?: string;
  model: string;
  generatedAt: number;
};

type CloudCapacityRegionInput = {
  regionId: string;
  regionName: string;
  cpuUsed: number;
  cpuTotal: number;
  cpuOversubscriptionCapacity?: number;
  cpuOversubscriptionRatio?: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  memoryOversubscriptionCapacityGb?: number;
  memoryOversubscriptionRatio?: number;
  storageUsedGb: number;
  storageTotalGb: number;
  storageOversubscriptionCapacityGb?: number;
  storageOversubscriptionRatio?: number;
};

type CloudCapacitySnapshotInput = CloudCapacityRegionInput & {
  snapshotAt: number;
};

type CloudAlarmInput = {
  csn: number;
  alarmId: string;
  alarmName: string;
  severity: number;
  cleared: number;
  acked: number;
  category: number;
  eventType: number;
  meName?: string;
  meCategory?: string;
  meType?: string;
  moc?: string;
  address?: string;
  logicalRegionId?: string;
  logicalRegionName?: string;
  vdcId?: string;
  vdcName?: string;
  tenantId?: string;
  tenant?: string;
  additionalInformation?: string;
  probableCause?: string;
  occurUtc: number;
  arriveUtc: number;
  latestOccurUtc: number;
  rawPayload: unknown;
  lastSyncedAt: number;
};

type CloudHostGroupInput = {
  hostGroupId: string;
  hostGroupName: string;
  regionId: string;
  regionName: string;
  azId: string;
  azName: string;
  resourcePoolId: string;
  resourcePoolName: string;
  hypervisorType: string;
  hostCount: number;
  cpuAvgPercent: number;
  cpuMaxPercent: number;
  memoryAvgPercent: number;
  memoryMaxPercent: number;
  riskLevel: "healthy" | "watch" | "critical";
  riskReasons: string[];
  worstCpuHost?: {
    hostId: string;
    hostName: string;
    cpuPercent: number;
  };
  worstMemoryHost?: {
    hostId: string;
    hostName: string;
    memoryPercent: number;
  };
  hosts: Array<{
    hostId: string;
    hostName: string;
    manageIp?: string;
    cpuPercent: number;
    memoryPercent: number;
  }>;
  rawCluster: unknown;
  rawHostSample: unknown;
  lastSyncedAt: number;
};

type PingResultInput = {
  targetId: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
};

type ServiceHealthResultInput = {
  targetId: string;
  success: boolean;
  latencyMs?: number;
  statusCode?: number;
  resolvedValue?: string;
  error?: string;
  checkedAt: number;
};

type TenantUsageHistoryInput = {
  vdcId: string;
  domainId: string;
  tenantName: string;
  managerEmail?: string | null;
  ecsInstances: number;
  ecsCores: number;
  ecsRamGb: number;
  rdsInstances: number;
  cceClusters: number;
  evsGb: number;
  obsGb: number;
  sfsGb: number;
  publicIps: number;
  wafInstances: number;
  syncedAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(tenant: Record<string, unknown>, key: "vdcId" | "name") {
  const value = tenant[key];
  if (typeof value !== "string") {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(
  tenant: Record<string, unknown>,
  key: keyof Pick<
    ManageOneTenantInput,
    | "domainId"
    | "upperVdcId"
    | "managerName"
    | "managerPhone"
    | "managerEmail"
    | "regionId"
    | "regionName"
  >,
) {
  const value = tenant[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function optionalNumber(
  tenant: Record<string, unknown>,
  key: keyof Pick<
    ManageOneTenantInput,
    "level" | "ecsUsed" | "evsUsed" | "projectCount"
  >,
) {
  const value = tenant[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function optionalBoolean(
  tenant: Record<string, unknown>,
  key: keyof Pick<ManageOneTenantInput, "enabled">,
) {
  const value = tenant[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function optionalResources(
  tenant: Record<string, unknown>,
): ManageOneResourceInput[] | undefined {
  const value = tenant.resources;
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("resources must be an array");
  }

  return value.map((resourceValue) => {
    if (!isRecord(resourceValue)) {
      throw new Error("Each resource must be an object");
    }

    const serviceId = resourceValue.serviceId;
    const resource = resourceValue.resource;
    const used = resourceValue.used;
    const total = resourceValue.total;

    if (typeof serviceId !== "string") {
      throw new Error("resources.serviceId must be a string");
    }
    if (typeof resource !== "string") {
      throw new Error("resources.resource must be a string");
    }
    if (typeof used !== "number") {
      throw new Error("resources.used must be a number");
    }
    if (total != null && typeof total !== "number") {
      throw new Error("resources.total must be a number");
    }

    return {
      serviceId,
      resource,
      used,
      ...(typeof total === "number" && total !== -1 ? { total } : {}),
    };
  });
}

function optionalEcsFlavors(
  tenant: Record<string, unknown>,
): ManageOneEcsFlavorInput[] | undefined {
  const value = tenant.ecsFlavors;
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("ecsFlavors must be an array");
  }

  return value.map((flavorValue) => {
    if (!isRecord(flavorValue)) {
      throw new Error("Each ecsFlavor must be an object");
    }

    const flavorName = flavorValue.flavorName;
    const vcpus = flavorValue.vcpus;
    const ramMb = flavorValue.ramMb;
    const count = flavorValue.count;

    if (typeof flavorName !== "string") {
      throw new Error("ecsFlavors.flavorName must be a string");
    }
    if (typeof vcpus !== "number") {
      throw new Error("ecsFlavors.vcpus must be a number");
    }
    if (typeof ramMb !== "number") {
      throw new Error("ecsFlavors.ramMb must be a number");
    }
    if (typeof count !== "number") {
      throw new Error("ecsFlavors.count must be a number");
    }

    return {
      flavorName,
      vcpus,
      ramMb,
      count,
    };
  });
}

function optionalEvsVolumeTypes(
  tenant: Record<string, unknown>,
): ManageOneEvsVolumeTypeInput[] | undefined {
  const value = tenant.evsVolumeTypes;
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("evsVolumeTypes must be an array");
  }

  return value.map((volumeValue) => {
    if (!isRecord(volumeValue)) {
      throw new Error("Each evsVolumeType must be an object");
    }

    const volumeType = volumeValue.volumeType;
    const totalGb = volumeValue.totalGb;
    const count = volumeValue.count;

    if (typeof volumeType !== "string") {
      throw new Error("evsVolumeTypes.volumeType must be a string");
    }
    if (typeof totalGb !== "number") {
      throw new Error("evsVolumeTypes.totalGb must be a number");
    }
    if (typeof count !== "number") {
      throw new Error("evsVolumeTypes.count must be a number");
    }

    return {
      volumeType,
      totalGb,
      count,
    };
  });
}

function optionalEvsDiskManagedFees(
  tenant: Record<string, unknown>,
): ManageOneEvsDiskManagedFeeInput | undefined {
  const value = tenant.evsDiskManagedFees;
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("evsDiskManagedFees must be an object");
  }

  const count = value.count;
  const resourceTypeName = value.resourceTypeName;

  if (typeof count !== "number") {
    throw new Error("evsDiskManagedFees.count must be a number");
  }
  if (typeof resourceTypeName !== "string") {
    throw new Error("evsDiskManagedFees.resourceTypeName must be a string");
  }

  return {
    count,
    resourceTypeName,
  };
}

function optionalEipBandwidths(
  tenant: Record<string, unknown>,
): ManageOneEipBandwidthInput[] | undefined {
  const value = tenant.eipBandwidths;
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("eipBandwidths must be an array");
  }

  return value.map((bandwidthValue) => {
    if (!isRecord(bandwidthValue)) {
      throw new Error("Each eipBandwidth must be an object");
    }

    const tierName = bandwidthValue.tierName;
    const count = bandwidthValue.count;
    const totalMbps = bandwidthValue.totalMbps;

    if (typeof tierName !== "string") {
      throw new Error("eipBandwidths.tierName must be a string");
    }
    if (typeof count !== "number") {
      throw new Error("eipBandwidths.count must be a number");
    }
    if (typeof totalMbps !== "number") {
      throw new Error("eipBandwidths.totalMbps must be a number");
    }

    return {
      tierName,
      count,
      totalMbps,
    };
  });
}

function optionalVpnGateways(
  tenant: Record<string, unknown>,
): ManageOneVpnGatewayInput | undefined {
  const value = tenant.vpnGateways;
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("vpnGateways must be an object");
  }

  const count = value.count;
  const resourceTypeName = value.resourceTypeName;
  const items = value.items;

  if (typeof count !== "number") {
    throw new Error("vpnGateways.count must be a number");
  }
  if (typeof resourceTypeName !== "string") {
    throw new Error("vpnGateways.resourceTypeName must be a string");
  }
  if (items != null && !Array.isArray(items)) {
    throw new Error("vpnGateways.items must be an array");
  }

  return {
    count,
    resourceTypeName,
    ...(Array.isArray(items)
      ? {
          items: items.map((itemValue) => {
            if (!isRecord(itemValue)) {
              throw new Error("Each vpnGateways item must be an object");
            }

            const id = itemValue.id;
            const name = itemValue.name;
            const itemResourceTypeName = itemValue.resourceTypeName;

            if (typeof id !== "string") {
              throw new Error("vpnGateways.items.id must be a string");
            }
            if (typeof name !== "string") {
              throw new Error("vpnGateways.items.name must be a string");
            }
            if (typeof itemResourceTypeName !== "string") {
              throw new Error(
                "vpnGateways.items.resourceTypeName must be a string",
              );
            }

            return {
              id,
              name,
              resourceTypeName: itemResourceTypeName,
            };
          }),
        }
      : {}),
  };
}

function optionalCloudBastionHosts(
  tenant: Record<string, unknown>,
): ManageOneCloudBastionHostInput | undefined {
  const value = tenant.cloudBastionHosts;
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("cloudBastionHosts must be an object");
  }

  const count = value.count;
  const resourceTypeName = value.resourceTypeName;
  const items = value.items;

  if (typeof count !== "number") {
    throw new Error("cloudBastionHosts.count must be a number");
  }
  if (typeof resourceTypeName !== "string") {
    throw new Error("cloudBastionHosts.resourceTypeName must be a string");
  }
  if (items != null && !Array.isArray(items)) {
    throw new Error("cloudBastionHosts.items must be an array");
  }

  return {
    count,
    resourceTypeName,
    ...(Array.isArray(items)
      ? {
          items: items.map((itemValue) => {
            if (!isRecord(itemValue)) {
              throw new Error("Each cloudBastionHosts item must be an object");
            }

            const id = itemValue.id;
            const name = itemValue.name;
            const itemResourceTypeName = itemValue.resourceTypeName;

            if (typeof id !== "string") {
              throw new Error("cloudBastionHosts.items.id must be a string");
            }
            if (typeof name !== "string") {
              throw new Error("cloudBastionHosts.items.name must be a string");
            }
            if (typeof itemResourceTypeName !== "string") {
              throw new Error(
                "cloudBastionHosts.items.resourceTypeName must be a string",
              );
            }

            return {
              id,
              name,
              resourceTypeName: itemResourceTypeName,
            };
          }),
        }
      : {}),
  };
}

export function normalizeTenant(value: unknown): ManageOneTenantInput {
  if (!isRecord(value)) {
    throw new Error("Each tenant must be an object");
  }

  return {
    vdcId: requireString(value, "vdcId"),
    name: requireString(value, "name"),
    ...(optionalString(value, "domainId") !== undefined
      ? { domainId: optionalString(value, "domainId") }
      : {}),
    ...(optionalNumber(value, "level") !== undefined
      ? { level: optionalNumber(value, "level") }
      : {}),
    ...(optionalString(value, "upperVdcId") !== undefined
      ? { upperVdcId: optionalString(value, "upperVdcId") }
      : {}),
    ...(optionalBoolean(value, "enabled") !== undefined
      ? { enabled: optionalBoolean(value, "enabled") }
      : {}),
    ...(optionalString(value, "managerName") !== undefined
      ? { managerName: optionalString(value, "managerName") }
      : {}),
    ...(optionalString(value, "managerPhone") !== undefined
      ? { managerPhone: optionalString(value, "managerPhone") }
      : {}),
    ...(optionalString(value, "managerEmail") !== undefined
      ? { managerEmail: optionalString(value, "managerEmail") }
      : {}),
    ...(optionalString(value, "regionId") !== undefined
      ? { regionId: optionalString(value, "regionId") }
      : {}),
    ...(optionalString(value, "regionName") !== undefined
      ? { regionName: optionalString(value, "regionName") }
      : {}),
    ...(optionalNumber(value, "ecsUsed") !== undefined
      ? { ecsUsed: optionalNumber(value, "ecsUsed") }
      : {}),
    ...(optionalNumber(value, "evsUsed") !== undefined
      ? { evsUsed: optionalNumber(value, "evsUsed") }
      : {}),
    ...(optionalNumber(value, "projectCount") !== undefined
      ? { projectCount: optionalNumber(value, "projectCount") }
      : {}),
    ...(optionalResources(value) !== undefined
      ? { resources: optionalResources(value) }
      : {}),
    ...(optionalEcsFlavors(value) !== undefined
      ? { ecsFlavors: optionalEcsFlavors(value) }
      : {}),
    ...(optionalEvsVolumeTypes(value) !== undefined
      ? { evsVolumeTypes: optionalEvsVolumeTypes(value) }
      : {}),
    ...(optionalEvsDiskManagedFees(value) !== undefined
      ? { evsDiskManagedFees: optionalEvsDiskManagedFees(value) }
      : {}),
    ...(optionalEipBandwidths(value) !== undefined
      ? { eipBandwidths: optionalEipBandwidths(value) }
      : {}),
    ...(optionalVpnGateways(value) !== undefined
      ? { vpnGateways: optionalVpnGateways(value) }
      : {}),
    ...(optionalCloudBastionHosts(value) !== undefined
      ? { cloudBastionHosts: optionalCloudBastionHosts(value) }
      : {}),
  };
}

function hasValidSyncSecret(request: Request, envKey: string) {
  const expectedSecret = process.env[envKey];
  const providedSecret = request.headers.get("X-Sync-Secret");
  return !!expectedSecret && providedSecret === expectedSecret;
}

function normalizeAiRecommendation(value: unknown): AiRecommendationSyncInput {
  if (!isRecord(value)) {
    throw new Error("Each AI recommendation must be an object");
  }

  const companyId = value.companyId;
  const narrative = value.narrative;
  const topPriority = value.topPriority;
  const model = value.model;
  const generatedAt = value.generatedAt;

  if (typeof companyId !== "string") {
    throw new Error("companyId is required");
  }
  if (typeof narrative !== "string") {
    throw new Error("narrative is required");
  }
  if (topPriority != null && typeof topPriority !== "string") {
    throw new Error("topPriority must be a string");
  }
  if (typeof model !== "string") {
    throw new Error("model is required");
  }
  if (typeof generatedAt !== "number") {
    throw new Error("generatedAt is required");
  }

  return {
    companyId,
    narrative,
    ...(topPriority != null ? { topPriority } : {}),
    model,
    generatedAt,
  };
}

function requireUnknownString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${key} is required`);
  }
  return value;
}

function requireUnknownNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalUnknownNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function optionalUnknownString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function normalizeCloudCapacityRegion(
  value: unknown,
): CloudCapacityRegionInput {
  if (!isRecord(value)) {
    throw new Error("Each capacity region must be an object");
  }

  return {
    regionId: requireUnknownString(value, "regionId"),
    regionName: requireUnknownString(value, "regionName"),
    cpuUsed: requireUnknownNumber(value, "cpuUsed"),
    cpuTotal: requireUnknownNumber(value, "cpuTotal"),
    ...(optionalUnknownNumber(value, "cpuOversubscriptionCapacity") !==
    undefined
      ? {
          cpuOversubscriptionCapacity: optionalUnknownNumber(
            value,
            "cpuOversubscriptionCapacity",
          ),
        }
      : {}),
    ...(optionalUnknownNumber(value, "cpuOversubscriptionRatio") !== undefined
      ? {
          cpuOversubscriptionRatio: optionalUnknownNumber(
            value,
            "cpuOversubscriptionRatio",
          ),
        }
      : {}),
    memoryUsedGb: requireUnknownNumber(value, "memoryUsedGb"),
    memoryTotalGb: requireUnknownNumber(value, "memoryTotalGb"),
    ...(optionalUnknownNumber(value, "memoryOversubscriptionCapacityGb") !==
    undefined
      ? {
          memoryOversubscriptionCapacityGb: optionalUnknownNumber(
            value,
            "memoryOversubscriptionCapacityGb",
          ),
        }
      : {}),
    ...(optionalUnknownNumber(value, "memoryOversubscriptionRatio") !==
    undefined
      ? {
          memoryOversubscriptionRatio: optionalUnknownNumber(
            value,
            "memoryOversubscriptionRatio",
          ),
        }
      : {}),
    storageUsedGb: requireUnknownNumber(value, "storageUsedGb"),
    storageTotalGb: requireUnknownNumber(value, "storageTotalGb"),
    ...(optionalUnknownNumber(value, "storageOversubscriptionCapacityGb") !==
    undefined
      ? {
          storageOversubscriptionCapacityGb: optionalUnknownNumber(
            value,
            "storageOversubscriptionCapacityGb",
          ),
        }
      : {}),
    ...(optionalUnknownNumber(value, "storageOversubscriptionRatio") !==
    undefined
      ? {
          storageOversubscriptionRatio: optionalUnknownNumber(
            value,
            "storageOversubscriptionRatio",
          ),
        }
      : {}),
  };
}

function normalizeCloudCapacitySnapshot(
  value: unknown,
): CloudCapacitySnapshotInput {
  if (!isRecord(value)) {
    throw new Error("Each capacity snapshot must be an object");
  }

  return {
    ...normalizeCloudCapacityRegion(value),
    snapshotAt: requireUnknownNumber(value, "snapshotAt"),
  };
}

function normalizeCloudAlarm(
  value: unknown,
  fallbackSyncedAt: number,
): CloudAlarmInput {
  if (!isRecord(value)) {
    throw new Error("Each cloud alarm must be an object");
  }

  return {
    csn: requireUnknownNumber(value, "csn"),
    alarmId: requireUnknownString(value, "alarmId"),
    alarmName: requireUnknownString(value, "alarmName"),
    severity: requireUnknownNumber(value, "severity"),
    cleared: requireUnknownNumber(value, "cleared"),
    acked: requireUnknownNumber(value, "acked"),
    category: requireUnknownNumber(value, "category"),
    eventType: requireUnknownNumber(value, "eventType"),
    ...(optionalUnknownString(value, "meName") !== undefined
      ? { meName: optionalUnknownString(value, "meName") }
      : {}),
    ...(optionalUnknownString(value, "meCategory") !== undefined
      ? { meCategory: optionalUnknownString(value, "meCategory") }
      : {}),
    ...(optionalUnknownString(value, "meType") !== undefined
      ? { meType: optionalUnknownString(value, "meType") }
      : {}),
    ...(optionalUnknownString(value, "moc") !== undefined
      ? { moc: optionalUnknownString(value, "moc") }
      : {}),
    ...(optionalUnknownString(value, "address") !== undefined
      ? { address: optionalUnknownString(value, "address") }
      : {}),
    ...(optionalUnknownString(value, "logicalRegionId") !== undefined
      ? { logicalRegionId: optionalUnknownString(value, "logicalRegionId") }
      : {}),
    ...(optionalUnknownString(value, "logicalRegionName") !== undefined
      ? { logicalRegionName: optionalUnknownString(value, "logicalRegionName") }
      : {}),
    ...(optionalUnknownString(value, "vdcId") !== undefined
      ? { vdcId: optionalUnknownString(value, "vdcId") }
      : {}),
    ...(optionalUnknownString(value, "vdcName") !== undefined
      ? { vdcName: optionalUnknownString(value, "vdcName") }
      : {}),
    ...(optionalUnknownString(value, "tenantId") !== undefined
      ? { tenantId: optionalUnknownString(value, "tenantId") }
      : {}),
    ...(optionalUnknownString(value, "tenant") !== undefined
      ? { tenant: optionalUnknownString(value, "tenant") }
      : {}),
    ...(optionalUnknownString(value, "additionalInformation") !== undefined
      ? {
          additionalInformation: optionalUnknownString(
            value,
            "additionalInformation",
          ),
        }
      : {}),
    ...(optionalUnknownString(value, "probableCause") !== undefined
      ? { probableCause: optionalUnknownString(value, "probableCause") }
      : {}),
    occurUtc: requireUnknownNumber(value, "occurUtc"),
    arriveUtc: requireUnknownNumber(value, "arriveUtc"),
    latestOccurUtc: requireUnknownNumber(value, "latestOccurUtc"),
    rawPayload: value.rawPayload ?? value,
    lastSyncedAt:
      optionalUnknownNumber(value, "lastSyncedAt") ?? fallbackSyncedAt,
  };
}

function normalizeHostGroupRiskLevel(value: unknown) {
  if (value === "healthy" || value === "watch" || value === "critical") {
    return value;
  }
  throw new Error("riskLevel must be healthy, watch, or critical");
}

function normalizeHostGroupRiskReasons(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("riskReasons must be an array");
  }
  return value.map((reason) => {
    if (typeof reason !== "string") {
      throw new Error("riskReasons must contain only strings");
    }
    return reason;
  });
}

function normalizeWorstCpuHost(value: unknown) {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("worstCpuHost must be an object");
  }
  return {
    hostId: requireUnknownString(value, "hostId"),
    hostName: requireUnknownString(value, "hostName"),
    cpuPercent: requireUnknownNumber(value, "cpuPercent"),
  };
}

function normalizeWorstMemoryHost(value: unknown) {
  if (value == null) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("worstMemoryHost must be an object");
  }
  return {
    hostId: requireUnknownString(value, "hostId"),
    hostName: requireUnknownString(value, "hostName"),
    memoryPercent: requireUnknownNumber(value, "memoryPercent"),
  };
}

function normalizeHost(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Each host must be an object");
  }

  return {
    hostId: requireUnknownString(value, "hostId"),
    hostName: requireUnknownString(value, "hostName"),
    ...(optionalUnknownString(value, "manageIp") !== undefined
      ? { manageIp: optionalUnknownString(value, "manageIp") }
      : {}),
    cpuPercent: requireUnknownNumber(value, "cpuPercent"),
    memoryPercent: requireUnknownNumber(value, "memoryPercent"),
  };
}

function normalizeCloudHostGroup(
  value: unknown,
  fallbackSyncedAt: number,
): CloudHostGroupInput {
  if (!isRecord(value)) {
    throw new Error("Each host group must be an object");
  }
  if (!Array.isArray(value.hosts)) {
    throw new Error("hosts must be an array");
  }

  const worstCpuHost = normalizeWorstCpuHost(value.worstCpuHost);
  const worstMemoryHost = normalizeWorstMemoryHost(value.worstMemoryHost);

  return {
    hostGroupId: requireUnknownString(value, "hostGroupId"),
    hostGroupName: requireUnknownString(value, "hostGroupName"),
    regionId: requireUnknownString(value, "regionId"),
    regionName: requireUnknownString(value, "regionName"),
    azId: requireUnknownString(value, "azId"),
    azName: requireUnknownString(value, "azName"),
    resourcePoolId: requireUnknownString(value, "resourcePoolId"),
    resourcePoolName: requireUnknownString(value, "resourcePoolName"),
    hypervisorType: requireUnknownString(value, "hypervisorType"),
    hostCount: requireUnknownNumber(value, "hostCount"),
    cpuAvgPercent: requireUnknownNumber(value, "cpuAvgPercent"),
    cpuMaxPercent: requireUnknownNumber(value, "cpuMaxPercent"),
    memoryAvgPercent: requireUnknownNumber(value, "memoryAvgPercent"),
    memoryMaxPercent: requireUnknownNumber(value, "memoryMaxPercent"),
    riskLevel: normalizeHostGroupRiskLevel(value.riskLevel),
    riskReasons: normalizeHostGroupRiskReasons(value.riskReasons),
    ...(worstCpuHost ? { worstCpuHost } : {}),
    ...(worstMemoryHost ? { worstMemoryHost } : {}),
    hosts: value.hosts.map(normalizeHost),
    rawCluster: value.rawCluster ?? {},
    rawHostSample: value.rawHostSample ?? {},
    lastSyncedAt: optionalUnknownNumber(value, "lastSyncedAt") ?? fallbackSyncedAt,
  };
}

function normalizePingResult(value: unknown): PingResultInput {
  if (!isRecord(value)) {
    throw new Error("Each ping result must be an object");
  }

  const success = value.success;
  const error = value.error;
  if (typeof success !== "boolean") {
    throw new Error("success is required");
  }
  if (error != null && typeof error !== "string") {
    throw new Error("error must be a string");
  }

  return {
    targetId: requireUnknownString(value, "targetId"),
    success,
    ...(optionalUnknownNumber(value, "latencyMs") !== undefined
      ? { latencyMs: optionalUnknownNumber(value, "latencyMs") }
      : {}),
    ...(error != null ? { error } : {}),
    checkedAt: requireUnknownNumber(value, "checkedAt"),
  };
}

function normalizeServiceHealthResult(
  value: unknown,
): ServiceHealthResultInput {
  if (!isRecord(value)) {
    throw new Error("Each service health result must be an object");
  }

  const success = value.success;
  const resolvedValue = value.resolvedValue;
  const error = value.error;
  if (typeof success !== "boolean") {
    throw new Error("success is required");
  }
  if (resolvedValue != null && typeof resolvedValue !== "string") {
    throw new Error("resolvedValue must be a string");
  }
  if (error != null && typeof error !== "string") {
    throw new Error("error must be a string");
  }

  return {
    targetId: requireUnknownString(value, "targetId"),
    success,
    ...(optionalUnknownNumber(value, "latencyMs") !== undefined
      ? { latencyMs: optionalUnknownNumber(value, "latencyMs") }
      : {}),
    ...(optionalUnknownNumber(value, "statusCode") !== undefined
      ? { statusCode: optionalUnknownNumber(value, "statusCode") }
      : {}),
    ...(resolvedValue != null ? { resolvedValue } : {}),
    ...(error != null ? { error } : {}),
    checkedAt: requireUnknownNumber(value, "checkedAt"),
  };
}

function normalizeTenantUsageHistory(value: unknown): TenantUsageHistoryInput {
  if (!isRecord(value)) {
    throw new Error("Each tenant usage history row must be an object");
  }

  return {
    vdcId: requireUnknownString(value, "vdcId"),
    domainId: requireUnknownString(value, "domainId"),
    tenantName: requireUnknownString(value, "tenantName"),
    ...(value.managerEmail !== undefined
      ? {
          managerEmail:
            value.managerEmail === null
              ? null
              : requireUnknownString(value, "managerEmail"),
        }
      : {}),
    ecsInstances: requireUnknownNumber(value, "ecsInstances"),
    ecsCores: requireUnknownNumber(value, "ecsCores"),
    ecsRamGb: requireUnknownNumber(value, "ecsRamGb"),
    rdsInstances: requireUnknownNumber(value, "rdsInstances"),
    cceClusters: requireUnknownNumber(value, "cceClusters"),
    evsGb: requireUnknownNumber(value, "evsGb"),
    obsGb: requireUnknownNumber(value, "obsGb"),
    sfsGb: requireUnknownNumber(value, "sfsGb"),
    publicIps: requireUnknownNumber(value, "publicIps"),
    wafInstances: requireUnknownNumber(value, "wafInstances"),
    syncedAt: requireUnknownNumber(value, "syncedAt"),
  };
}

http.route({
  path: "/cloud-alarms/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "MANAGEONE_ALARMS_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!isRecord(body)) {
        return Response.json(
          { success: false, error: "Request body must be an object" },
          { status: 400 },
        );
      }
      if (!Array.isArray(body.alarms)) {
        return Response.json(
          { success: false, error: "alarms must be an array" },
          { status: 400 },
        );
      }
      if (typeof body.syncedAt !== "number") {
        return Response.json(
          { success: false, error: "syncedAt is required" },
          { status: 400 },
        );
      }

      const alarms = body.alarms.map((alarm) =>
        normalizeCloudAlarm(alarm, body.syncedAt as number),
      );
      const summary = await ctx.runMutation(internal.cloudAlarms.bulkSync, {
        alarms,
        syncedAt: body.syncedAt,
      });

      return Response.json({ success: true, ...summary });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/manageone/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "MANAGEONE_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const tenants = body.map(normalizeTenant);

      const count = await ctx.runMutation(
        internal.manageOneTenants.bulkUpsert,
        {
          tenants,
        },
      );

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/ai-recs/context",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "AI_RECS_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const context = await ctx.runQuery(
      internal.recommendations.listContextForSync,
      {},
    );

    return Response.json({ success: true, companies: context });
  }),
});

http.route({
  path: "/ai-recs/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "AI_RECS_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const context = await ctx.runQuery(
        internal.recommendations.listContextForSync,
        {},
      );
      const rulesByCompany = new Map(
        context.map((companyContext) => [
          companyContext.companyId,
          companyContext.recommendations,
        ]),
      );
      const items = body.map(normalizeAiRecommendation).map((item) => {
        const companyId = item.companyId as Id<"companies">;
        return {
          ...item,
          companyId,
          ruleSnapshot: rulesByCompany.get(companyId) ?? [],
        };
      });

      const count = await ctx.runMutation(
        internal.aiRecommendations.bulkUpsert,
        { items },
      );

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/cloud-capacity/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "CLOUD_HEALTH_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const regions = body.map(normalizeCloudCapacityRegion);
      const count = await ctx.runMutation(internal.cloudCapacity.bulkUpsert, {
        regions,
      });

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/ping-targets/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "CLOUD_HEALTH_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const targets = await ctx.runQuery(
      internal.pingTargets.listActiveForSync,
      {},
    );
    return Response.json({ success: true, targets });
  }),
});

http.route({
  path: "/ping-results/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "CLOUD_HEALTH_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const results = body.map(normalizePingResult).map((result) => ({
        ...result,
        targetId: result.targetId as Id<"pingTargets">,
      }));
      const count = await ctx.runMutation(internal.pingResults.bulkUpsert, {
        results,
      });

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/tenant-usage/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "TENANT_HISTORY_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const rows = body.map(normalizeTenantUsageHistory);
      const summary = await ctx.runMutation(
        internal.tenantUsageHistory.bulkInsert,
        { rows },
      );

      return Response.json({
        success: true,
        count: summary.inserted,
        inserted: summary.inserted,
        skippedNoLinkedCompany: summary.skippedNoLinkedCompany,
      });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/cloud-capacity/snapshot",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "CLOUD_HEALTH_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const snapshots = body.map(normalizeCloudCapacitySnapshot);
      const count = await ctx.runMutation(
        internal.cloudCapacitySnapshots.append,
        { snapshots },
      );

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/service-health-targets/list",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "CLOUD_HEALTH_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const targets = await ctx.runQuery(
      internal.serviceHealthTargets.listActiveForSync,
      {},
    );
    return Response.json({ success: true, targets });
  }),
});

http.route({
  path: "/service-health-results/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "CLOUD_HEALTH_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body)) {
        return Response.json(
          { success: false, error: "Request body must be an array" },
          { status: 400 },
        );
      }

      const results = body.map(normalizeServiceHealthResult).map((result) => ({
        ...result,
        targetId: result.targetId as Id<"serviceHealthTargets">,
      }));
      const count = await ctx.runMutation(
        internal.serviceHealthResults.bulkInsert,
        { results },
      );

      return Response.json({ success: true, count });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/cloud-host-groups/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!hasValidSyncSecret(request, "HOST_GROUPS_SYNC_SECRET")) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    try {
      const body = await request.json();
      if (!isRecord(body)) {
        return Response.json(
          { success: false, error: "Request body must be an object" },
          { status: 400 },
        );
      }
      if (!Array.isArray(body.hostGroups)) {
        return Response.json(
          { success: false, error: "hostGroups must be an array" },
          { status: 400 },
        );
      }
      if (typeof body.syncedAt !== "number") {
        return Response.json(
          { success: false, error: "syncedAt is required" },
          { status: 400 },
        );
      }

      const hostGroups = body.hostGroups.map((hostGroup) =>
        normalizeCloudHostGroup(hostGroup, body.syncedAt as number),
      );
      const summary = await ctx.runMutation(internal.cloudHostGroups.bulkSync, {
        hostGroups,
        syncedAt: body.syncedAt,
      });

      return Response.json({ success: true, ...summary });
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Sync failed",
        },
        { status: 400 },
      );
    }
  }),
});

export default http;
