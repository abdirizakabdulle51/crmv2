import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    mustChangePassword: v.optional(v.boolean()),
    isDisabled: v.optional(v.boolean()),
    role: v.optional(
      v.union(
        v.literal("account_manager"),
        v.literal("country_gm"),
        v.literal("head_of_business"),
        v.literal("ceo"),
      ),
    ),
    countryId: v.optional(v.id("countries")),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_role", ["role"])
    .index("by_country", ["countryId"]),

  countries: defineTable({
    name: v.string(),
    region: v.string(),
  }).index("by_name", ["name"]),

  sectors: defineTable({
    name: v.string(),
  }).index("by_name", ["name"]),

  companies: defineTable({
    name: v.string(),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
    accountManagerId: v.optional(v.id("users")),
    contractStatus: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("expired"),
      v.literal("terminated"),
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("current"),
        v.literal("overdue"),
        v.literal("delinquent"),
      ),
    ),
    notes: v.optional(v.string()),
    website: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  })
    .index("by_account_manager", ["accountManagerId"])
    .index("by_country", ["countryId"])
    .index("by_sector", ["sectorId"])
    .index("by_status", ["contractStatus"]),

  leads: defineTable({
    title: v.string(),
    companyId: v.id("companies"),
    accountManagerId: v.optional(v.id("users")),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    potentialValue: v.number(),
    expectedCloseDate: v.string(),
    nextAction: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index("by_account_manager", ["accountManagerId"])
    .index("by_stage", ["stage"])
    .index("by_company", ["companyId"]),

  salesTargets: defineTable({
    accountManagerId: v.optional(v.id("users")),
    year: v.number(),
    quarter: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
    target: v.number(),
  }).index("by_am_year_quarter", ["accountManagerId", "year", "quarter"]),

  manageOneTenants: defineTable({
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
    lastSyncedAt: v.number(),
    linkedCompanyId: v.optional(v.id("companies")),
  })
    .index("by_vdc_id", ["vdcId"])
    .index("by_region_id", ["regionId"])
    .index("by_linked_company", ["linkedCompanyId"]),

  cloudCapacityRegions: defineTable({
    regionId: v.string(),
    regionName: v.string(),
    cpuUsed: v.number(),
    cpuTotal: v.number(),
    cpuOversubscriptionCapacity: v.optional(v.number()),
    cpuOversubscriptionRatio: v.optional(v.number()),
    memoryUsedGb: v.number(),
    memoryTotalGb: v.number(),
    memoryOversubscriptionCapacityGb: v.optional(v.number()),
    memoryOversubscriptionRatio: v.optional(v.number()),
    storageUsedGb: v.number(),
    storageTotalGb: v.number(),
    storageOversubscriptionCapacityGb: v.optional(v.number()),
    storageOversubscriptionRatio: v.optional(v.number()),
    lastSyncedAt: v.number(),
  }).index("by_region_id", ["regionId"]),

  cloudCapacitySnapshots: defineTable({
    regionId: v.string(),
    regionName: v.string(),
    cpuUsed: v.number(),
    cpuTotal: v.number(),
    cpuOversubscriptionCapacity: v.optional(v.number()),
    cpuOversubscriptionRatio: v.optional(v.number()),
    memoryUsedGb: v.number(),
    memoryTotalGb: v.number(),
    memoryOversubscriptionCapacityGb: v.optional(v.number()),
    memoryOversubscriptionRatio: v.optional(v.number()),
    storageUsedGb: v.number(),
    storageTotalGb: v.number(),
    storageOversubscriptionCapacityGb: v.optional(v.number()),
    storageOversubscriptionRatio: v.optional(v.number()),
    snapshotAt: v.number(),
  }).index("by_region_snapshot_at", ["regionId", "snapshotAt"]),

  tenantUsageHistory: defineTable({
    linkedCompanyId: v.id("companies"),
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
  }).index("by_company_synced_at", ["linkedCompanyId", "syncedAt"]),

  pingTargets: defineTable({
    name: v.string(),
    ip: v.string(),
    active: v.boolean(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["active"])
    .index("by_ip", ["ip"]),

  pingResults: defineTable({
    targetId: v.id("pingTargets"),
    success: v.boolean(),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  })
    .index("by_target_checked_at", ["targetId", "checkedAt"])
    .index("by_checked_at", ["checkedAt"]),

  serviceHealthTargets: defineTable({
    name: v.string(),
    checkType: v.union(v.literal("http"), v.literal("tcp"), v.literal("dns")),
    target: v.string(),
    expectedStatusCode: v.optional(v.number()),
    expectedResponseContains: v.optional(v.string()),
    expectedIp: v.optional(v.string()),
    active: v.boolean(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_active", ["active"]),

  serviceHealthResults: defineTable({
    targetId: v.id("serviceHealthTargets"),
    success: v.boolean(),
    latencyMs: v.optional(v.number()),
    statusCode: v.optional(v.number()),
    resolvedValue: v.optional(v.string()),
    error: v.optional(v.string()),
    checkedAt: v.number(),
  })
    .index("by_target_checked_at", ["targetId", "checkedAt"])
    .index("by_checked_at", ["checkedAt"]),

  activities: defineTable({
    accountManagerId: v.id("users"),
    leadId: v.id("leads"),
    type: v.union(
      v.literal("call"),
      v.literal("meeting"),
      v.literal("proposal_sent"),
    ),
    description: v.optional(v.string()),
    date: v.string(),
  })
    .index("by_account_manager", ["accountManagerId"])
    .index("by_lead", ["leadId"])
    .index("by_date", ["date"]),

  consumption: defineTable({
    companyId: v.id("companies"),
    month: v.string(), // YYYY-MM format
    serviceType: v.string(),
    amount: v.number(),
    quantity: v.optional(v.number()),
    catalogItemId: v.optional(v.id("serviceCatalog")),
    isManualOverride: v.optional(v.boolean()),
  })
    .index("by_company", ["companyId"])
    .index("by_company_month", ["companyId", "month"])
    .index("by_month", ["month"]),

  serviceCatalog: defineTable({
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  })
    .index("by_category", ["serviceCategory"])
    .index("by_name", ["itemName"]),

  aiRecommendations: defineTable({
    companyId: v.id("companies"),
    narrative: v.string(),
    topPriority: v.optional(v.string()),
    ruleSnapshot: v.array(
      v.object({
        companyId: v.id("companies"),
        companyName: v.string(),
        rule: v.string(),
        triggerReason: v.string(),
        recommendedService: v.string(),
        estimatedValue: v.string(),
        estimatedMonthlyValue: v.optional(v.number()),
        estimateBasis: v.optional(v.string()),
        estimateCatalogItemName: v.optional(v.string()),
        priority: v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low"),
        ),
      }),
    ),
    generatedAt: v.number(),
    model: v.string(),
  }).index("by_company", ["companyId"]),

  quotes: defineTable({
    companyId: v.id("companies"),
    createdBy: v.id("users"),
    date: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
    ),
    lineItems: v.array(
      v.object({
        catalogItemId: v.id("serviceCatalog"),
        itemName: v.string(),
        serviceCategory: v.string(),
        billingUnit: v.string(),
        quantity: v.number(),
        monthlyUnitPrice: v.number(),
        monthlyTotal: v.number(),
        yearlyTotal: v.number(),
      }),
    ),
    monthlyGrandTotal: v.number(),
    yearlyGrandTotal: v.number(),
    notes: v.optional(v.string()),
    sourceMonth: v.optional(v.string()),
  })
    .index("by_company", ["companyId"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"]),
});
