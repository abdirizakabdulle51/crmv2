import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

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

export const list = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db.query("serviceCatalog").collect();
  },
});

export const create = mutation({
  args: {
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    return await ctx.db.insert("serviceCatalog", {
      serviceCategory: args.serviceCategory,
      itemName: args.itemName,
      specs: args.specs,
      billingUnit: args.billingUnit,
      monthlyPrice: args.monthlyPrice,
      yearlyPrice: args.yearlyPrice,
      hourlyPrice: args.hourlyPrice,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("serviceCatalog"),
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("serviceCatalog") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    await ctx.db.delete(args.id);
  },
});

export const bulkCreate = mutation({
  args: {
    items: v.array(
      v.object({
        serviceCategory: v.string(),
        itemName: v.string(),
        specs: v.optional(v.string()),
        billingUnit: v.string(),
        monthlyPrice: v.number(),
        yearlyPrice: v.optional(v.number()),
        hourlyPrice: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({ code: "FORBIDDEN", message: "Admin only" });
    }
    for (const item of args.items) {
      await ctx.db.insert("serviceCatalog", item);
    }
    return { inserted: args.items.length };
  },
});

type SeedServiceCatalogItem = {
  serviceCategory: string;
  itemName: string;
  specs: string | null;
  billingUnit: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  hourlyPrice: number | null;
};

const SEED_SERVICE_CATALOG_ITEMS: SeedServiceCatalogItem[] = [
  {
    serviceCategory: "ECS",
    itemName: "S6_64U_512G",
    specs: "64 vCPU, 512GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 1339.85,
    yearlyPrice: null,
    hourlyPrice: null,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_64U_256G",
    specs: "64 vCPU, 256GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 1078.448,
    yearlyPrice: 11862.928,
    hourlyPrice: 2.05184,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_16xlarge.4",
    specs: "64 vCPU, 256GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 1230.4,
    yearlyPrice: 13534.4,
    hourlyPrice: 3.4,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_12xlarge.4",
    specs: "48 vCPU, 192GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 922,
    yearlyPrice: 10142,
    hourlyPrice: 2.64,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_48U_160G",
    specs: "48 vCPU, 160GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 776.16,
    yearlyPrice: 8537.76,
    hourlyPrice: 1.078,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_32U_128G",
    specs: "32 vCPU, 128GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 539.224,
    yearlyPrice: 5931.464,
    hourlyPrice: 1.02592,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_16xlarge.2",
    specs: "64 vCPU, 128GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 986.8,
    yearlyPrice: 10854.8,
    hourlyPrice: 2.04,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_8xlarge.4",
    specs: "24 vCPU, 96GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 615.2,
    yearlyPrice: 6767.2,
    hourlyPrice: 1.7,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_6xlarge.4",
    specs: "24 vCPU, 96GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 461,
    yearlyPrice: 5071,
    hourlyPrice: 1.32,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_12xlarge.2",
    specs: "48 vCPU, 96GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 740.2,
    yearlyPrice: 8142.2,
    hourlyPrice: 1.54,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_32U_64G",
    specs: "32 vCPU, 64GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 430.906,
    yearlyPrice: 4739.966,
    hourlyPrice: 0.81984,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_16U_64G",
    specs: "16 vCPU, 64GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 269.612,
    yearlyPrice: 2965.732,
    hourlyPrice: 0.51296,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_12U_64G",
    specs: "12 vCPU, 64GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 221.76,
    yearlyPrice: 2661.12,
    hourlyPrice: 0.336,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_2xlarge.8",
    specs: "8 vCPU, 64GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 175.218074,
    yearlyPrice: 1927.398815,
    hourlyPrice: 0.489881,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_8xlarge.2",
    specs: "24 vCPU, 48GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 493.4,
    yearlyPrice: 5427.4,
    hourlyPrice: 1.02,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_6xlarge.2",
    specs: "24 vCPU, 48GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 370.1,
    yearlyPrice: 4071.1,
    hourlyPrice: 0.77,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_4xlarge.4",
    specs: "16 vCPU, 48GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 307.5,
    yearlyPrice: 3382.5,
    hourlyPrice: 0.8,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_4xlarge.2",
    specs: "16 vCPU, 32GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 258.5436,
    yearlyPrice: 2843.9796,
    hourlyPrice: 0.359088,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_4U_32G",
    specs: "4 vCPU, 32GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 165.733077,
    yearlyPrice: 1823.063846,
    hourlyPrice: 0.230185,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_2xlarge.4",
    specs: "8 vCPU, 32GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 107.66,
    yearlyPrice: 1184.26,
    hourlyPrice: 0.301,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_16U_32G",
    specs: "16 vCPU, 32GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 215.453,
    yearlyPrice: 2369.983,
    hourlyPrice: 0.40992,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_2xlarge.4",
    specs: "8 vCPU, 32GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 153.8,
    yearlyPrice: 1691.8,
    hourlyPrice: 0.43,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_3xlarge.4",
    specs: "12 vCPU, 28GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 230.7,
    yearlyPrice: 2537.7,
    hourlyPrice: 0.66,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_8U_24G",
    specs: "8 vCPU, 24GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 215.453,
    yearlyPrice: 2369.983,
    hourlyPrice: 0.40992,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_4xlarge.2",
    specs: "16 vCPU, 24GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 246.7,
    yearlyPrice: 2713.7,
    hourlyPrice: 0.51,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_3xlarge.2",
    specs: "12 vCPU, 24GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 202.6,
    yearlyPrice: 2228.6,
    hourlyPrice: 0.42,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_xlarge.4",
    specs: "4 vCPU, 16GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 49.985,
    yearlyPrice: 549.835,
    hourlyPrice: 0.1365,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_2xlarge.2",
    specs: "8 vCPU, 16GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 94.5,
    yearlyPrice: 1039.5,
    hourlyPrice: 0.196,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_xlarge.4",
    specs: "4 vCPU, 16GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 76.9,
    yearlyPrice: 845.9,
    hourlyPrice: 0.21,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_2xlarge.2",
    specs: "8 vCPU, 16GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 135,
    yearlyPrice: 1485,
    hourlyPrice: 0.28,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_4U_12G",
    specs: "4 vCPU, 12GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 132.586462,
    yearlyPrice: 1458.451077,
    hourlyPrice: 0.184148,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_xlarge.2",
    specs: "4 vCPU, 8GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 43.875,
    yearlyPrice: 482.625,
    hourlyPrice: 0.091,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_large.4",
    specs: "2 vCPU, 8GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 24.96,
    yearlyPrice: 274.56,
    hourlyPrice: 0.065,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_xlarge.2",
    specs: "4 vCPU, 8GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 67.5,
    yearlyPrice: 742.5,
    hourlyPrice: 0.14,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_large.4",
    specs: "2 vCPU, 8GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 38.4,
    yearlyPrice: 422.4,
    hourlyPrice: 0.1,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_large.2",
    specs: "2 vCPU, 4GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 18.5055,
    yearlyPrice: 203.5605,
    hourlyPrice: 0.026,
  },
  {
    serviceCategory: "ECS",
    itemName: "C6_large.2",
    specs: "2 vCPU, 4GB RAM, 1:1 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 28.47,
    yearlyPrice: 313.17,
    hourlyPrice: 0.04,
  },
  {
    serviceCategory: "ECS",
    itemName: "S6_large.1",
    specs: "2 vCPU, 2GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 8.025,
    yearlyPrice: 96.3,
    hourlyPrice: 0.011146,
  },
  {
    serviceCategory: "ECS-CCE",
    itemName: "S2_xlarge.2",
    specs: "4 vCPU, 8GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 43.875,
    yearlyPrice: 482.625,
    hourlyPrice: 0.091,
  },
  {
    serviceCategory: "ECS-CCE",
    itemName: "S2_2xlarge.2",
    specs: "8 vCPU, 16GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 94.5,
    yearlyPrice: 1039.5,
    hourlyPrice: 0.196,
  },
  {
    serviceCategory: "ECS-CCE",
    itemName: "S2_4xlarge.2",
    specs: "16 vCPU, 32GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 258.5436,
    yearlyPrice: 2843.9796,
    hourlyPrice: 0.359088,
  },
  {
    serviceCategory: "ECS-CCE",
    itemName: "S2_8xlarge.2",
    specs: "32 vCPU, 64GB RAM, 1:3 overcommit",
    billingUnit: "per instance/month",
    monthlyPrice: 430.906,
    yearlyPrice: 4739.966,
    hourlyPrice: 0.81984,
  },
  {
    serviceCategory: "BMS",
    itemName: "bms.physical.o2",
    specs: "72 vCPU, 512GB RAM, 47048GB storage",
    billingUnit: "per instance/month",
    monthlyPrice: 1642.5,
    yearlyPrice: 19710,
    hourlyPrice: 2.25,
  },
  {
    serviceCategory: "EVS",
    itemName: "SSD (Block Storage / NVMe)",
    specs: null,
    billingUnit: "per GB/month",
    monthlyPrice: 0.072,
    yearlyPrice: 0.864,
    hourlyPrice: 0.000099,
  },
  {
    serviceCategory: "EVS",
    itemName: "SATA (Object / Cold Storage)",
    specs: null,
    billingUnit: "per GB/month",
    monthlyPrice: 0.011,
    yearlyPrice: 0.132,
    hourlyPrice: 0.000015,
  },
  {
    serviceCategory: "SFS",
    itemName: "SFS_SATA",
    specs: "Capacity",
    billingUnit: "per GB/month",
    monthlyPrice: 0.045,
    yearlyPrice: 0.54,
    hourlyPrice: 0.000062,
  },
  {
    serviceCategory: "OBS",
    itemName: "Fusion bucket",
    specs: "Standard",
    billingUnit: "per GB/month",
    monthlyPrice: 0.012,
    yearlyPrice: 0.144,
    hourlyPrice: 0.000016,
  },
  {
    serviceCategory: "OBS",
    itemName: "Fusion bucket",
    specs: "Archive",
    billingUnit: "per GB/month",
    monthlyPrice: 0.0035,
    yearlyPrice: 0.042,
    hourlyPrice: 0.000005,
  },
  {
    serviceCategory: "CSBS",
    itemName: "General CSBS Duplication (backup)",
    specs: "Standard Backup",
    billingUnit: "per GB/month",
    monthlyPrice: 0.024,
    yearlyPrice: 0.288,
    hourlyPrice: 0.000033,
  },
  {
    serviceCategory: "VBS",
    itemName: "General VBS Duplication (Volume Backup Service)",
    specs: "Standard",
    billingUnit: "per GB/month",
    monthlyPrice: 0.018,
    yearlyPrice: 0.216,
    hourlyPrice: 0.000025,
  },
  {
    serviceCategory: "EIP",
    itemName: "EIP - Active",
    specs: "Per public IP address",
    billingUnit: "per IP/month",
    monthlyPrice: 5,
    yearlyPrice: 60,
    hourlyPrice: 0.006849,
  },
  {
    serviceCategory: "EIP",
    itemName: "EIP - Idle",
    specs: "Per public IP address",
    billingUnit: "per IP/month",
    monthlyPrice: 0,
    yearlyPrice: 0,
    hourlyPrice: 0,
  },
  {
    serviceCategory: "EIP",
    itemName: "EIP Bandwidth - 1 - 5 Mbps",
    specs: "Per Mbps bandwidth tier",
    billingUnit: "per Mbps/month",
    monthlyPrice: 3,
    yearlyPrice: 36,
    hourlyPrice: 0.00411,
  },
  {
    serviceCategory: "EIP",
    itemName: "EIP Bandwidth - 6 - 50 Mbps",
    specs: "Per Mbps bandwidth tier",
    billingUnit: "per Mbps/month",
    monthlyPrice: 4.5,
    yearlyPrice: 54,
    hourlyPrice: 0.006164,
  },
  {
    serviceCategory: "EIP",
    itemName: "EIP Bandwidth - 51 - 200 Mbps",
    specs: "Per Mbps bandwidth tier",
    billingUnit: "per Mbps/month",
    monthlyPrice: 6,
    yearlyPrice: 72,
    hourlyPrice: 0.008219,
  },
  {
    serviceCategory: "ELB",
    itemName: "ELB - Shared",
    specs: "Per load balancer",
    billingUnit: "per instance/month",
    monthlyPrice: 14.6,
    yearlyPrice: 175.2,
    hourlyPrice: 0.02,
  },
  {
    serviceCategory: "NAT",
    itemName: "Small (150 Mbps)",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 7,
    yearlyPrice: 84,
    hourlyPrice: 0.009589,
  },
  {
    serviceCategory: "NAT",
    itemName: "Medium (600 Mbps)",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 18,
    yearlyPrice: 216,
    hourlyPrice: 0.024658,
  },
  {
    serviceCategory: "NAT",
    itemName: "Large (1.5 Gbps)",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 45,
    yearlyPrice: 540,
    hourlyPrice: 0.061644,
  },
  {
    serviceCategory: "NAT",
    itemName: "Extra-large (4 Gbps+)",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 85,
    yearlyPrice: 1020,
    hourlyPrice: 0.116438,
  },
  {
    serviceCategory: "VPN",
    itemName: "General VPN Connection",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 36.5,
    yearlyPrice: 438,
    hourlyPrice: 0.05,
  },
  {
    serviceCategory: "VPN Gateway",
    itemName: "VPN Gateway",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 65,
    yearlyPrice: 780,
    hourlyPrice: 0.090278,
  },
  {
    serviceCategory: "VPCEP",
    itemName: "General VPC Endpoints",
    specs: "Instance",
    billingUnit: "per instance/month",
    monthlyPrice: 7.3,
    yearlyPrice: 87.6,
    hourlyPrice: 0.01,
  },
  {
    serviceCategory: "WAF",
    itemName: "Basic WAF",
    specs:
      "5 TB included traffic - OWASP Top 10 protection, Core Rule Set (CRS)",
    billingUnit: "flat fee/month",
    monthlyPrice: 15,
    yearlyPrice: 180,
    hourlyPrice: null,
  },
  {
    serviceCategory: "WAF",
    itemName: "Advanced WAF",
    specs:
      "20 TB included traffic - Custom Regex rules, IP Rate Limiting, Bot Mitigation",
    billingUnit: "flat fee/month",
    monthlyPrice: 45,
    yearlyPrice: 540,
    hourlyPrice: null,
  },
  {
    serviceCategory: "WAF",
    itemName: "Enterprise WAF",
    specs: "Unlimited traffic - Geo-fencing, API Security, Dedicated Support",
    billingUnit: "flat fee/month",
    monthlyPrice: 150,
    yearlyPrice: 1800,
    hourlyPrice: null,
  },
  {
    serviceCategory: "LTS",
    itemName: "LTS Lite",
    specs: "50 GB included, 7 Days retention",
    billingUnit: "flat fee/month",
    monthlyPrice: 15,
    yearlyPrice: 180,
    hourlyPrice: null,
  },
  {
    serviceCategory: "LTS",
    itemName: "LTS Standard",
    specs: "200 GB included, 30 Days retention",
    billingUnit: "flat fee/month",
    monthlyPrice: 45,
    yearlyPrice: 540,
    hourlyPrice: null,
  },
  {
    serviceCategory: "LTS",
    itemName: "LTS Compliance",
    specs: "1 TB included, 180 Days retention",
    billingUnit: "flat fee/month",
    monthlyPrice: 120,
    yearlyPrice: 1440,
    hourlyPrice: null,
  },
];

function stripNullPriceListFields(item: SeedServiceCatalogItem) {
  return {
    serviceCategory: item.serviceCategory,
    itemName: item.itemName,
    ...(item.specs !== null ? { specs: item.specs } : {}),
    billingUnit: item.billingUnit,
    monthlyPrice: item.monthlyPrice,
    ...(item.yearlyPrice !== null ? { yearlyPrice: item.yearlyPrice } : {}),
    ...(item.hourlyPrice !== null ? { hourlyPrice: item.hourlyPrice } : {}),
  };
}

export const seedServiceCatalogOnce = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("serviceCatalog").collect();
    if (existing.length > 0) {
      return { skipped: true, existingCount: existing.length };
    }

    let inserted = 0;
    for (const item of SEED_SERVICE_CATALOG_ITEMS) {
      await ctx.db.insert("serviceCatalog", stripNullPriceListFields(item));
      inserted++;
    }

    return { inserted };
  },
});
