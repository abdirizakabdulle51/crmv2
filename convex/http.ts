import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

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

http.route({
  path: "/manageone/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.MANAGEONE_SYNC_SECRET;
    const providedSecret = request.headers.get("X-Sync-Secret");

    if (!expectedSecret || providedSecret !== expectedSecret) {
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

export default http;
