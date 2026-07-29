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
  ecsUsed?: number;
  evsUsed?: number;
  projectCount?: number;
  resources?: ManageOneResourceInput[];
  ecsFlavors?: ManageOneEcsFlavorInput[];
  evsVolumeTypes?: ManageOneEvsVolumeTypeInput[];
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

type PingResultInput = {
  targetId: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: number;
};

type TenantUsageHistoryInput = {
  linkedCompanyId: string;
  tenantName: string;
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
    "domainId" | "upperVdcId" | "managerName" | "managerPhone" | "managerEmail"
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

function normalizeTenant(value: unknown): ManageOneTenantInput {
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

function normalizeTenantUsageHistory(value: unknown): TenantUsageHistoryInput {
  if (!isRecord(value)) {
    throw new Error("Each tenant usage history row must be an object");
  }

  return {
    linkedCompanyId: requireUnknownString(value, "linkedCompanyId"),
    tenantName: requireUnknownString(value, "tenantName"),
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

      const rows = body.map(normalizeTenantUsageHistory).map((row) => ({
        ...row,
        linkedCompanyId: row.linkedCompanyId as Id<"companies">,
      }));
      const count = await ctx.runMutation(
        internal.tenantUsageHistory.bulkInsert,
        { rows },
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

export default http;
