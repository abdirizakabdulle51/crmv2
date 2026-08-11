import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { canViewCloudHealth, isMonitoring } from "./authorization";

async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
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

function cpuCoresForTenant(tenant: Doc<"manageOneTenants">) {
  return (tenant.ecsFlavors ?? []).reduce(
    (sum, flavor) => sum + flavor.vcpus * flavor.count,
    0,
  );
}

function memoryGbForTenant(tenant: Doc<"manageOneTenants">) {
  const ramMb = (tenant.ecsFlavors ?? []).reduce(
    (sum, flavor) => sum + flavor.ramMb * flavor.count,
    0,
  );
  return Math.round((ramMb / 1024) * 10) / 10;
}

function storageGbForTenant(tenant: Doc<"manageOneTenants">) {
  const evsVolumeGb = (tenant.evsVolumeTypes ?? []).reduce(
    (sum, volumeType) => sum + volumeType.totalGb,
    0,
  );
  if (evsVolumeGb > 0) {
    return evsVolumeGb;
  }

  const evsResourceGb = (tenant.resources ?? [])
    .filter(
      (resource) =>
        resource.serviceId === "evs" &&
        resource.resource === "gigabytes" &&
        resource.used > 0,
    )
    .reduce((sum, resource) => sum + resource.used, 0);
  if (evsResourceGb > 0) {
    return evsResourceGb;
  }

  return tenant.evsUsed ?? 0;
}

function metricValueForTenant(
  tenant: Doc<"manageOneTenants">,
  metric: "cpu" | "memory" | "storage",
) {
  if (metric === "cpu") {
    return cpuCoresForTenant(tenant);
  }
  if (metric === "memory") {
    return memoryGbForTenant(tenant);
  }
  return storageGbForTenant(tenant);
}

export const topConsumersByRegion = query({
  args: {
    regionName: v.optional(v.string()),
    regionId: v.optional(v.string()),
    metric: v.union(
      v.literal("cpu"),
      v.literal("memory"),
      v.literal("storage"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewCloudHealth(user);

    const allTenants = await ctx.db.query("manageOneTenants").collect();
    const normalizedRegionName = args.regionName?.trim().toLowerCase();
    const tenants = normalizedRegionName
      ? allTenants.filter(
          (tenant) =>
            tenant.regionName?.trim().toLowerCase() === normalizedRegionName,
        )
      : allTenants.filter((tenant) => tenant.regionId === args.regionId);
    const companyIds = new Set(
      tenants
        .map((tenant) => tenant.linkedCompanyId)
        .filter((companyId) => companyId !== undefined),
    );
    const companies = await Promise.all(
      [...companyIds].map((companyId) => ctx.db.get(companyId)),
    );
    const companyNameById = new Map(
      companies
        .filter((company) => company !== null)
        .map((company) => [company._id, company.name]),
    );

    const visibleConsumers = tenants
      .map((tenant) => ({
        tenantId: tenant._id,
        tenantName: tenant.name,
        linkedCompanyId: tenant.linkedCompanyId,
        companyName: tenant.linkedCompanyId
          ? (companyNameById.get(tenant.linkedCompanyId) ?? null)
          : null,
        value: metricValueForTenant(tenant, args.metric),
      }))
      .filter((consumer) => consumer.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    if (!isMonitoring(user)) {
      return visibleConsumers;
    }

    return visibleConsumers.map((consumer, index) => {
      const {
        tenantId: _tenantId,
        linkedCompanyId: _linkedCompanyId,
        ...redacted
      } = consumer;
      return {
        ...redacted,
        tenantName: `Consumer ${index + 1}`,
        companyName: null,
      };
    });
  },
});
