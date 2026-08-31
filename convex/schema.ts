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
        v.literal("monitoring"),
      ),
    ),
    organizationScope: v.optional(
      v.union(v.literal("country"), v.literal("global")),
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
    paymentTermDays: v.optional(
      v.union(v.literal(7), v.literal(15), v.literal(30)),
    ),
    notes: v.optional(v.string()),
    website: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    commercialModel: v.optional(
      v.union(v.literal("payg"), v.literal("contracted")),
    ),
  })
    .index("by_account_manager", ["accountManagerId"])
    .index("by_country", ["countryId"])
    .index("by_sector", ["sectorId"])
    .index("by_status", ["contractStatus"]),

  leads: defineTable({
    opportunityNumber: v.optional(v.string()),
    title: v.string(),
    companyId: v.optional(v.id("companies")),
    countryId: v.optional(v.id("countries")),
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
    nextActionDate: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    source: v.optional(v.string()),
    serviceInterests: v.optional(v.array(v.string())),
    lossReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_account_manager", ["accountManagerId"])
    .index("by_country", ["countryId"])
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
    lastSyncedAt: v.number(),
    linkedCompanyId: v.optional(v.id("companies")),
  })
    .index("by_vdc_id", ["vdcId"])
    .index("by_domain_id", ["domainId"])
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
    storagePools: v.optional(
      v.array(
        v.object({
          volumeType: v.string(),
          usedGb: v.number(),
          totalGb: v.number(),
          freeGb: v.number(),
          usedRatio: v.number(),
          oversubscriptionTotalGb: v.optional(v.number()),
          oversubscriptionAllocatedGb: v.optional(v.number()),
          oversubscriptionFreeGb: v.optional(v.number()),
          oversubscriptionAllocatedRatio: v.optional(v.number()),
        }),
      ),
    ),
    ecsFlavorAvailabilityStatus: v.optional(
      v.union(v.literal("verified"), v.literal("unavailable")),
    ),
    ecsFlavorAvailabilityMessage: v.optional(v.string()),
    ecsFlavorAvailability: v.optional(
      v.array(
        v.object({
          name: v.string(),
          vcpus: v.number(),
          ramGb: v.number(),
          cpuVendor: v.optional(v.string()),
          available: v.boolean(),
          matchedName: v.optional(v.string()),
          availabilityZones: v.optional(v.array(v.string())),
          estimatedFitCount: v.optional(v.number()),
          status: v.optional(
            v.union(
              v.literal("available"),
              v.literal("low_capacity"),
              v.literal("not_offered"),
            ),
          ),
        }),
      ),
    ),
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
    storagePools: v.optional(
      v.array(
        v.object({
          volumeType: v.string(),
          usedGb: v.number(),
          totalGb: v.number(),
          freeGb: v.number(),
          usedRatio: v.number(),
          oversubscriptionTotalGb: v.optional(v.number()),
          oversubscriptionAllocatedGb: v.optional(v.number()),
          oversubscriptionFreeGb: v.optional(v.number()),
          oversubscriptionAllocatedRatio: v.optional(v.number()),
        }),
      ),
    ),
    ecsFlavorAvailabilityStatus: v.optional(
      v.union(v.literal("verified"), v.literal("unavailable")),
    ),
    ecsFlavorAvailabilityMessage: v.optional(v.string()),
    ecsFlavorAvailability: v.optional(
      v.array(
        v.object({
          name: v.string(),
          vcpus: v.number(),
          ramGb: v.number(),
          cpuVendor: v.optional(v.string()),
          available: v.boolean(),
          matchedName: v.optional(v.string()),
          availabilityZones: v.optional(v.array(v.string())),
          estimatedFitCount: v.optional(v.number()),
          status: v.optional(
            v.union(
              v.literal("available"),
              v.literal("low_capacity"),
              v.literal("not_offered"),
            ),
          ),
        }),
      ),
    ),
    snapshotAt: v.number(),
  }).index("by_region_snapshot_at", ["regionId", "snapshotAt"]),

  cloudAlarms: defineTable({
    csn: v.number(),
    alarmId: v.string(),
    alarmName: v.string(),
    severity: v.number(),
    cleared: v.number(),
    acked: v.number(),
    category: v.number(),
    eventType: v.number(),
    meName: v.optional(v.string()),
    meCategory: v.optional(v.string()),
    meType: v.optional(v.string()),
    moc: v.optional(v.string()),
    address: v.optional(v.string()),
    logicalRegionId: v.optional(v.string()),
    logicalRegionName: v.optional(v.string()),
    vdcId: v.optional(v.string()),
    vdcName: v.optional(v.string()),
    tenantId: v.optional(v.string()),
    tenant: v.optional(v.string()),
    additionalInformation: v.optional(v.string()),
    probableCause: v.optional(v.string()),
    occurUtc: v.number(),
    arriveUtc: v.number(),
    latestOccurUtc: v.number(),
    rawPayload: v.any(),
    active: v.boolean(),
    firstSeenAt: v.number(),
    lastSyncedAt: v.number(),
    inactiveAt: v.optional(v.number()),
    linkedCompanyId: v.optional(v.id("companies")),
  })
    .index("by_csn", ["csn"])
    .index("by_active", ["active"])
    .index("by_region_active", ["logicalRegionId", "active"])
    .index("by_linked_company", ["linkedCompanyId"]),

  cloudHostGroups: defineTable({
    hostGroupId: v.string(),
    hostGroupName: v.string(),
    regionId: v.string(),
    regionName: v.string(),
    azId: v.string(),
    azName: v.string(),
    resourcePoolId: v.string(),
    resourcePoolName: v.string(),
    hypervisorType: v.string(),
    hostCount: v.number(),
    cpuAvgPercent: v.number(),
    cpuMaxPercent: v.number(),
    memoryAvgPercent: v.number(),
    memoryMaxPercent: v.number(),
    riskLevel: v.union(
      v.literal("healthy"),
      v.literal("watch"),
      v.literal("critical"),
    ),
    riskReasons: v.array(v.string()),
    worstCpuHost: v.optional(
      v.object({
        hostId: v.string(),
        hostName: v.string(),
        cpuPercent: v.number(),
      }),
    ),
    worstMemoryHost: v.optional(
      v.object({
        hostId: v.string(),
        hostName: v.string(),
        memoryPercent: v.number(),
      }),
    ),
    hosts: v.array(
      v.object({
        hostId: v.string(),
        hostName: v.string(),
        manageIp: v.optional(v.string()),
        cpuPercent: v.number(),
        memoryPercent: v.number(),
      }),
    ),
    rawCluster: v.any(),
    rawHostSample: v.any(),
    active: v.boolean(),
    firstSeenAt: v.number(),
    lastSyncedAt: v.number(),
    inactiveAt: v.optional(v.number()),
  })
    .index("by_host_group_id", ["hostGroupId"])
    .index("by_active", ["active"])
    .index("by_region_active", ["regionId", "active"])
    .index("by_risk_active", ["riskLevel", "active"]),

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
    bmsInstances: v.optional(v.number()),
    wafInstances: v.number(),
    wafBasicInstances: v.optional(v.number()),
    wafEnterpriseInstances: v.optional(v.number()),
    syncedAt: v.number(),
  }).index("by_company_synced_at", ["linkedCompanyId", "syncedAt"]),

  manageOneHourlySnapshots: defineTable({
    snapshotKey: v.string(),
    vdcId: v.string(),
    domainId: v.optional(v.string()),
    tenantName: v.string(),
    linkedCompanyId: v.optional(v.id("companies")),
    regionId: v.optional(v.string()),
    regionName: v.optional(v.string()),
    capturedHour: v.number(),
    capturedAt: v.number(),
    ecsInstances: v.number(),
    cceNodes: v.optional(v.number()),
    ecsCores: v.number(),
    ecsRamGb: v.number(),
    evsGb: v.number(),
    sfsGb: v.optional(v.number()),
    csbsGb: v.optional(v.number()),
    vbsGb: v.optional(v.number()),
    obsGb: v.number(),
    publicIps: v.number(),
    vpcepEndpoints: v.optional(v.number()),
    bmsInstances: v.optional(v.number()),
    loadBalancers: v.number(),
    vpnGateways: v.number(),
    natGateways: v.number(),
    wafInstances: v.number(),
    wafBasicInstances: v.optional(v.number()),
    wafEnterpriseInstances: v.optional(v.number()),
    rawMetrics: v.optional(v.any()),
  })
    .index("by_snapshot_key", ["snapshotKey"])
    .index("by_hour", ["capturedHour"])
    .index("by_company_hour", ["linkedCompanyId", "capturedHour"])
    .index("by_vdc_hour", ["vdcId", "capturedHour"]),

  manageOneHourlySyncRuns: defineTable({
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(
      v.literal("running"),
      v.literal("success"),
      v.literal("failed"),
    ),
    rowsReceived: v.number(),
    rowsUpserted: v.number(),
    rowsSkipped: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_started_at", ["startedAt"])
    .index("by_status_started_at", ["status", "startedAt"]),

  dailyUsageSnapshots: defineTable({
    companyId: v.id("companies"),
    tenantId: v.id("manageOneTenants"),
    tenantName: v.string(),
    tenantVdcId: v.string(),
    tenantDomainId: v.optional(v.string()),
    usageDate: v.string(), // YYYY-MM-DD, Africa/Mogadishu business day.
    month: v.string(), // YYYY-MM
    serviceType: v.string(),
    itemName: v.string(),
    serviceCategory: v.string(),
    quantity: v.number(),
    unit: v.string(),
    catalogItemId: v.optional(v.id("serviceCatalog")),
    source: v.literal("manageone"),
    sourceKey: v.string(),
    sourceSyncedAt: v.optional(v.number()),
    capturedAt: v.number(),
    regionId: v.optional(v.string()),
    regionName: v.optional(v.string()),
    dataCenterName: v.optional(v.string()),
    invoiceId: v.optional(v.id("invoices")),
    lockedAt: v.optional(v.number()),
  })
    .index("by_source_key", ["sourceKey"])
    .index("by_company_date", ["companyId", "usageDate"])
    .index("by_company_month", ["companyId", "month"])
    .index("by_month", ["month"])
    .index("by_invoice", ["invoiceId"]),

  dailyUsageBillingSnapshots: defineTable({
    companyId: v.id("companies"),
    month: v.string(),
    calculationVersion: v.string(),
    inputDigest: v.string(),
    billingResultDigest: v.string(),
    computedAt: v.number(),
    sourceLatestCapturedAt: v.optional(v.number()),
    rowCount: v.number(),
    serviceCount: v.number(),
    dayCount: v.number(),
    capturedCount: v.number(),
    lockedCount: v.number(),
    attachedCount: v.number(),
    unpricedCount: v.number(),
    rollupRowCount: v.number(),
    estimatedAmount: v.number(),
    catalogPricedRowCount: v.number(),
    contractPricedRowCount: v.number(),
    latestUsageDate: v.optional(v.string()),
    capturedThroughToday: v.boolean(),
    latestDayRowCount: v.number(),
    missingPriceRowCount: v.number(),
    missingServiceCount: v.number(),
  })
    .index("by_company_month", ["companyId", "month"])
    .index("by_month", ["month"])
    .index("by_version_month", ["calculationVersion", "month"]),

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

  documentationSections: defineTable({
    slug: v.string(),
    title: v.string(),
    group: v.string(),
    content: v.string(),
    order: v.number(),
    visibility: v.union(v.literal("public"), v.literal("restricted")),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_slug", ["slug"])
    .index("by_order", ["order"]),

  activities: defineTable({
    accountManagerId: v.id("users"),
    leadId: v.id("leads"),
    type: v.union(
      v.literal("call"),
      v.literal("meeting"),
      v.literal("proposal_sent"),
      v.literal("email"),
      v.literal("note"),
      v.literal("follow_up"),
      v.literal("stage_changed"),
      v.literal("quote_created"),
      v.literal("quote_sent"),
      v.literal("quote_accepted"),
      v.literal("won"),
      v.literal("lost"),
    ),
    description: v.optional(v.string()),
    date: v.string(),
    createdAt: v.optional(v.number()),
  })
    .index("by_account_manager", ["accountManagerId"])
    .index("by_lead", ["leadId"])
    .index("by_date", ["date"]),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("blocked"),
      v.literal("done"),
      v.literal("canceled"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    createdBy: v.id("users"),
    assigneeId: v.optional(v.id("users")),
    reportToId: v.optional(v.id("users")),
    companyId: v.optional(v.id("companies")),
    leadId: v.optional(v.id("leads")),
    quoteId: v.optional(v.id("quotes")),
    dueDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_assignee_status", ["assigneeId", "status"])
    .index("by_report_to_status", ["reportToId", "status"])
    .index("by_creator", ["createdBy"])
    .index("by_company", ["companyId"])
    .index("by_status", ["status"])
    .index("by_due_date", ["dueDate"])
    .index("by_updated_at", ["updatedAt"]),

  taskComments: defineTable({
    taskId: v.id("tasks"),
    body: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_task", ["taskId"])
    .index("by_created_by", ["createdBy"]),

  taskAttachments: defineTable({
    taskId: v.id("tasks"),
    commentId: v.optional(v.id("taskComments")),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
  })
    .index("by_task", ["taskId"])
    .index("by_comment", ["commentId"])
    .index("by_uploaded_by", ["uploadedBy"])
    .index("by_storage_id", ["storageId"]),

  notifications: defineTable({
    recipientId: v.id("users"),
    actorId: v.optional(v.id("users")),
    type: v.union(
      v.literal("task_assigned"),
      v.literal("task_report_to"),
      v.literal("task_status_changed"),
      v.literal("task_commented"),
      v.literal("quote_discount_approval_requested"),
      v.literal("quote_discount_approved"),
      v.literal("quote_discount_rejected"),
    ),
    title: v.string(),
    body: v.optional(v.string()),
    entityType: v.union(v.literal("task"), v.literal("quote")),
    entityId: v.union(v.id("tasks"), v.id("quotes")),
    href: v.string(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_recipient_created", ["recipientId", "createdAt"])
    .index("by_recipient_read", ["recipientId", "readAt"])
    .index("by_entity", ["entityType", "entityId"]),

  consumption: defineTable({
    companyId: v.id("companies"),
    month: v.string(), // YYYY-MM format
    usageDate: v.optional(v.string()),
    serviceType: v.string(),
    amount: v.number(),
    quantity: v.optional(v.number()),
    catalogItemId: v.optional(v.id("serviceCatalog")),
    isManualOverride: v.optional(v.boolean()),
    regionId: v.optional(v.string()),
    regionName: v.optional(v.string()),
    dataCenterName: v.optional(v.string()),
  })
    .index("by_company", ["companyId"])
    .index("by_company_month", ["companyId", "month"])
    .index("by_month", ["month"]),

  serviceCatalog: defineTable({
    productGroup: v.optional(v.string()),
    serviceCode: v.optional(v.string()),
    serviceCategory: v.string(),
    itemName: v.string(),
    specs: v.optional(v.string()),
    billingUnit: v.string(),
    monthlyPrice: v.number(),
    yearlyPrice: v.optional(v.number()),
    hourlyPrice: v.optional(v.number()),
  })
    .index("by_category", ["serviceCategory"])
    .index("by_product_group", ["productGroup"])
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

  cloudAdvisorStatuses: defineTable({
    recommendationKey: v.string(),
    companyId: v.id("companies"),
    rule: v.string(),
    recommendedService: v.string(),
    status: v.union(
      v.literal("acknowledged"),
      v.literal("in_progress"),
      v.literal("snoozed"),
      v.literal("dismissed"),
      v.literal("resolved"),
    ),
    snoozedUntil: v.optional(v.number()),
    acknowledgedAt: v.optional(v.number()),
    inProgressAt: v.optional(v.number()),
    dismissedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_key", ["recommendationKey"])
    .index("by_company", ["companyId"])
    .index("by_status", ["status"]),

  invoices: defineTable({
    companyId: v.id("companies"),
    contractId: v.optional(v.id("customerContracts")),
    sourceType: v.optional(
      v.union(
        v.literal("quote"),
        v.literal("contract"),
        v.literal("daily_usage"),
      ),
    ),
    sourceContractId: v.optional(v.id("customerContracts")),
    contractPeriodStartMonth: v.optional(v.string()),
    contractPeriodEndMonth: v.optional(v.string()),
    sourceQuoteId: v.optional(v.id("quotes")),
    sourceMonth: v.optional(v.string()),
    sourceReference: v.optional(v.string()),
    cycleStartMonth: v.optional(v.string()),
    cycleEndMonth: v.optional(v.string()),
    billingTiming: v.optional(
      v.union(v.literal("prepaid"), v.literal("postpaid")),
    ),
    contractInvoiceKind: v.optional(
      v.union(v.literal("cycle"), v.literal("overage_settlement")),
    ),
    contractUsageSummary: v.optional(
      v.object({
        catalogueUsage: v.number(),
        discountedUsage: v.number(),
        monthlyMinimum: v.number(),
        minimumShortfall: v.number(),
        payable: v.number(),
        usageEntries: v.number(),
      }),
    ),
    revenueAllocations: v.optional(
      v.array(v.object({ month: v.string(), amount: v.number() })),
    ),
    receivableAllocations: v.optional(
      v.array(v.object({ month: v.string(), amount: v.number() })),
    ),
    grossBeforeCredit: v.optional(v.number()),
    onboardingCreditId: v.optional(v.id("customerCredits")),
    onboardingCreditApplied: v.optional(v.number()),
    invoiceProfileId: v.optional(v.id("invoiceProfiles")),
    createdBy: v.id("users"),
    invoiceNumber: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("issued"),
      v.literal("sent"),
      v.literal("partially_paid"),
      v.literal("paid"),
      v.literal("overdue"),
      v.literal("void"),
      v.literal("cancelled"),
    ),
    issueDate: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    lockedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    sentTo: v.optional(v.string()),
    sentBy: v.optional(v.id("users")),
    lastInternalReminderAt: v.optional(v.number()),
    internalReminderCount: v.optional(v.number()),
    lastCustomerReminderAt: v.optional(v.number()),
    customerReminderCount: v.optional(v.number()),
    isTest: v.optional(v.boolean()),
    hiddenAt: v.optional(v.number()),
    hiddenBy: v.optional(v.id("users")),
    companyName: v.string(),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    taxId: v.optional(v.string()),
    sellerLegalName: v.optional(v.string()),
    sellerAddressLines: v.optional(v.array(v.string())),
    sellerPhone: v.optional(v.string()),
    sellerEmail: v.optional(v.string()),
    sellerWebsite: v.optional(v.string()),
    sellerSlogan: v.optional(v.string()),
    sellerTaxId: v.optional(v.string()),
    sellerBankName: v.optional(v.string()),
    sellerBankAccountNumber: v.optional(v.string()),
    sellerBankAccountName: v.optional(v.string()),
    sellerBankLocation: v.optional(v.string()),
    sellerCurrency: v.optional(v.string()),
    sellerCurrencyNote: v.optional(v.string()),
    sellerPaymentInstructions: v.optional(v.string()),
    sellerFooterText: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        catalogItemId: v.optional(v.id("serviceCatalog")),
        itemName: v.string(),
        serviceCategory: v.string(),
        billingUnit: v.string(),
        quantity: v.number(),
        monthlyUnitPrice: v.number(),
        monthlyTotal: v.number(),
        yearlyTotal: v.number(),
        monthlyUnitPriceCents: v.optional(v.number()),
        monthlyTotalCents: v.optional(v.number()),
        yearlyTotalCents: v.optional(v.number()),
        regionId: v.optional(v.string()),
        regionName: v.optional(v.string()),
        dataCenterName: v.optional(v.string()),
      }),
    ),
    subtotal: v.number(),
    monthlyTotal: v.number(),
    yearlyTotal: v.number(),
    grandTotal: v.number(),
    amountPaid: v.number(),
    balanceDue: v.number(),
    subtotalCents: v.optional(v.number()),
    monthlyTotalCents: v.optional(v.number()),
    yearlyTotalCents: v.optional(v.number()),
    grandTotalCents: v.optional(v.number()),
    amountPaidCents: v.optional(v.number()),
    balanceDueCents: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"])
    .index("by_source_quote", ["sourceQuoteId"])
    .index("by_contract", ["contractId"])
    .index("by_invoice_number", ["invoiceNumber"]),

  invoicePayments: defineTable({
    invoiceId: v.id("invoices"),
    receivingAccountId: v.optional(v.id("receivingAccounts")),
    amount: v.number(),
    amountCents: v.optional(v.number()),
    appliedAmount: v.optional(v.number()),
    extraServiceRevenueAmount: v.optional(v.number()),
    paidAt: v.number(),
    method: v.optional(v.string()),
    reference: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    receivingBankName: v.optional(v.string()),
    receivingAccountNumber: v.optional(v.string()),
    receivingAccountName: v.optional(v.string()),
    receivingBankLocation: v.optional(v.string()),
    receivingCurrencyNote: v.optional(v.string()),
    recordedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_recorded_by", ["recordedBy"])
    .index("by_receiving_account", ["receivingAccountId"])
    .index("by_account_transaction", ["receivingAccountId", "transactionId"]),

  financialInstitutions: defineTable({
    countryId: v.id("countries"),
    name: v.string(),
    code: v.optional(v.string()),
    swiftCode: v.optional(v.string()),
    type: v.union(v.literal("bank"), v.literal("mobile_money")),
    normalizedName: v.string(),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_country", ["countryId"])
    .index("by_country_name", ["countryId", "normalizedName"])
    .index("by_active", ["isActive"]),

  receivingAccounts: defineTable({
    countryId: v.optional(v.id("countries")),
    institutionId: v.optional(v.id("financialInstitutions")),
    name: v.string(),
    providerName: v.string(),
    accountNumber: v.string(),
    uniquenessKey: v.optional(v.string()),
    searchText: v.optional(v.string()),
    accountHolderName: v.string(),
    type: v.union(
      v.literal("bank"),
      v.literal("mobile_money"),
      v.literal("cash"),
    ),
    usage: v.optional(
      v.union(v.literal("incoming"), v.literal("outgoing"), v.literal("both")),
    ),
    currency: v.string(),
    location: v.optional(v.string()),
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_country", ["countryId"])
    .index("by_country_active", ["countryId", "isActive"])
    .index("by_uniqueness_key", ["uniquenessKey"])
    .index("by_type_active", ["type", "isActive"])
    .searchIndex("search_accounts", {
      searchField: "searchText",
      filterFields: ["countryId", "isActive"],
    }),

  invoiceEvents: defineTable({
    invoiceId: v.id("invoices"),
    type: v.union(
      v.literal("draft_created"),
      v.literal("draft_updated"),
      v.literal("issued"),
      v.literal("cancelled"),
      v.literal("voided"),
      v.literal("marked_test"),
      v.literal("unmarked_test"),
      v.literal("sent"),
      v.literal("payment_recorded"),
      v.literal("overdue"),
      v.literal("internal_reminder_sent"),
      v.literal("customer_reminder_sent"),
    ),
    actorId: v.optional(v.id("users")),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_type", ["type"]),

  expenseCategories: defineTable({
    name: v.string(),
    code: v.optional(v.string()),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    requiresReceipt: v.optional(v.boolean()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_is_active", ["isActive"])
    .index("by_name", ["name"]),

  expenseRequests: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    categoryId: v.id("expenseCategories"),
    amount: v.number(),
    currency: v.string(),
    expenseDate: v.number(),
    vendor: v.optional(v.string()),
    requestedBy: v.id("users"),
    companyId: v.optional(v.id("companies")),
    countryId: v.optional(v.id("countries")),
    status: v.union(
      v.literal("draft"),
      v.literal("submitted"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("paid"),
      v.literal("cancelled"),
    ),
    submittedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
    fundingAccountId: v.optional(v.id("receivingAccounts")),
    fundingAccountName: v.optional(v.string()),
    fundingProviderName: v.optional(v.string()),
    fundingAccountNumber: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.id("users")),
    rejectionReason: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.id("users")),
    paymentMethod: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    paymentTransactionId: v.optional(v.string()),
    fundingAccountType: v.optional(
      v.union(v.literal("bank"), v.literal("mobile_money"), v.literal("cash")),
    ),
    onboardingCreditId: v.optional(v.id("customerCredits")),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  })
    .index("by_requested_by", ["requestedBy"])
    .index("by_status", ["status"])
    .index("by_category", ["categoryId"])
    .index("by_company", ["companyId"])
    .index("by_country", ["countryId"])
    .index("by_created_at", ["createdAt"])
    .index("by_expense_date", ["expenseDate"])
    .index("by_funding_account", ["fundingAccountId"])
    .index("by_account_transaction", [
      "fundingAccountId",
      "paymentTransactionId",
    ]),

  expenseEvents: defineTable({
    expenseId: v.id("expenseRequests"),
    type: v.union(
      v.literal("created"),
      v.literal("submitted"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("marked_paid"),
      v.literal("cancelled"),
      v.literal("updated"),
      v.literal("receipt_uploaded"),
      v.literal("receipt_removed"),
    ),
    message: v.string(),
    actorId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_expense", ["expenseId"])
    .index("by_actor", ["actorId"]),

  expenseReceipts: defineTable({
    expenseId: v.id("expenseRequests"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
  })
    .index("by_expense", ["expenseId"])
    .index("by_uploaded_by", ["uploadedBy"])
    .index("by_storage_id", ["storageId"]),

  financeSettings: defineTable({
    key: v.literal("default"),
    countryApprovalLimit: v.number(),
    businessApprovalLimit: v.number(),
    currency: v.string(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  invoiceProfiles: defineTable({
    name: v.string(),
    countryId: v.optional(v.id("countries")),
    region: v.optional(v.string()),
    isDefault: v.boolean(),
    isActive: v.boolean(),
    legalName: v.string(),
    logoPath: v.optional(v.string()),
    slogan: v.optional(v.string()),
    addressLines: v.array(v.string()),
    phone: v.string(),
    email: v.string(),
    website: v.string(),
    taxId: v.optional(v.string()),
    bankName: v.string(),
    bankAccountNumber: v.string(),
    bankAccountName: v.string(),
    bankLocation: v.string(),
    currency: v.string(),
    currencyNote: v.string(),
    paymentInstructions: v.string(),
    footerText: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_country", ["countryId"])
    .index("by_default_active", ["isDefault", "isActive"])
    .index("by_active", ["isActive"]),

  customerContracts: defineTable({
    companyId: v.id("companies"),
    contractNumber: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("terminated"),
      v.literal("renewed"),
    ),
    startDate: v.number(),
    endDate: v.number(),
    signedDate: v.optional(v.number()),
    currency: v.string(),
    billingFrequency: v.union(
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("every_3_months"),
      v.literal("semiannual"),
      v.literal("yearly"),
    ),
    billingTiming: v.optional(
      v.union(v.literal("prepaid"), v.literal("postpaid")),
    ),
    pricingBasis: v.optional(
      v.union(v.literal("service_lines"), v.literal("total_contract")),
    ),
    commitmentModel: v.optional(v.literal("flexible_value")),
    pricingModel: v.optional(
      v.union(
        v.literal("flexible_total_commitment"),
        v.literal("monthly_minimum"),
        v.literal("discounted_usage"),
      ),
    ),
    monthlyMinimum: v.optional(v.number()),
    contractValue: v.optional(v.number()),
    defaultDiscountType: v.optional(
      v.union(v.literal("percentage"), v.literal("amount")),
    ),
    defaultDiscountValue: v.optional(v.number()),
    overagePricingPolicy: v.optional(
      v.union(
        v.literal("current_catalog"),
        v.literal("frozen_catalog"),
        v.literal("custom"),
      ),
    ),
    paymentTermDays: v.optional(v.number()),
    signedDocumentUrl: v.optional(v.string()),
    signedDocumentStorageId: v.optional(v.id("_storage")),
    signedDocumentFileName: v.optional(v.string()),
    signedDocumentMimeType: v.optional(v.string()),
    signedDocumentSize: v.optional(v.number()),
    signedDocumentUploadedBy: v.optional(v.id("users")),
    signedDocumentUploadedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    activatedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_status", ["status"])
    .index("by_contract_number", ["contractNumber"])
    .index("by_start_date", ["startDate"]),

  customerContractEvents: defineTable({
    contractId: v.id("customerContracts"),
    actorId: v.id("users"),
    type: v.union(
      v.literal("created"),
      v.literal("updated"),
      v.literal("activated"),
      v.literal("amended"),
      v.literal("terminated"),
      v.literal("expired"),
      v.literal("renewed"),
    ),
    message: v.string(),
    createdAt: v.number(),
  })
    .index("by_contract", ["contractId"])
    .index("by_actor", ["actorId"])
    .index("by_type", ["type"]),

  customerContractAmendments: defineTable({
    contractId: v.id("customerContracts"),
    amendmentNumber: v.string(),
    type: v.union(
      v.literal("upgrade"),
      v.literal("downgrade"),
      v.literal("renewal"),
      v.literal("commercial_change"),
      v.literal("correction"),
      v.literal("other"),
    ),
    effectiveDate: v.number(),
    summary: v.string(),
    monthlyDelta: v.optional(v.number()),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("cancelled"),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_contract", ["contractId"])
    .index("by_status", ["status"])
    .index("by_effective_date", ["effectiveDate"]),

  customerContractLineItems: defineTable({
    contractId: v.id("customerContracts"),
    catalogItemId: v.optional(v.id("serviceCatalog")),
    itemName: v.string(),
    serviceCategory: v.string(),
    productGroup: v.optional(v.string()),
    serviceCode: v.optional(v.string()),
    description: v.optional(v.string()),
    includedQuantity: v.number(),
    unit: v.string(),
    catalogUnitPrice: v.optional(v.number()),
    contractUnitPrice: v.number(),
    discountType: v.optional(
      v.union(v.literal("percentage"), v.literal("amount")),
    ),
    discountValue: v.optional(v.number()),
    overageUnitPrice: v.optional(v.number()),
    billingUnit: v.string(),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_contract", ["contractId"])
    .index("by_catalog_item", ["catalogItemId"])
    .index("by_service_category", ["serviceCategory"]),

  customerContractGroupDiscounts: defineTable({
    contractId: v.id("customerContracts"),
    productGroup: v.string(),
    discountPercent: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_contract", ["contractId"])
    .index("by_contract_group", ["contractId", "productGroup"]),

  customerCredits: defineTable({
    companyId: v.id("companies"),
    originalAmount: v.number(),
    remainingAmount: v.number(),
    reservedAmount: v.number(),
    currency: v.string(),
    policy: v.union(
      v.literal("first_invoice_only"),
      v.literal("carry_forward"),
    ),
    appliesTo: v.union(
      v.literal("all"),
      v.literal("contract"),
      v.literal("non_contract"),
    ),
    status: v.union(
      v.literal("available"),
      v.literal("reserved"),
      v.literal("consumed"),
      v.literal("expired"),
    ),
    expiresAt: v.optional(v.number()),
    description: v.optional(v.string()),
    expenseId: v.optional(v.id("expenseRequests")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_status", ["status"]),

  customerCreditLedger: defineTable({
    creditId: v.id("customerCredits"),
    companyId: v.id("companies"),
    invoiceId: v.optional(v.id("invoices")),
    type: v.union(
      v.literal("granted"),
      v.literal("reserved"),
      v.literal("released"),
      v.literal("consumed"),
      v.literal("restored"),
      v.literal("expired"),
    ),
    amount: v.number(),
    balanceAfter: v.number(),
    actorId: v.optional(v.id("users")),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_credit", ["creditId"])
    .index("by_company", ["companyId"])
    .index("by_invoice", ["invoiceId"]),

  quotes: defineTable({
    companyId: v.id("companies"),
    leadId: v.optional(v.id("leads")),
    commercialModel: v.optional(
      v.union(v.literal("payg"), v.literal("contracted")),
    ),
    contractTerms: v.optional(
      v.object({
        pricingModel: v.union(
          v.literal("flexible_total_commitment"),
          v.literal("monthly_minimum"),
          v.literal("discounted_usage"),
        ),
        contractValue: v.optional(v.number()),
        monthlyMinimum: v.optional(v.number()),
        groupDiscounts: v.array(
          v.object({ productGroup: v.string(), discountPercent: v.number() }),
        ),
      }),
    ),
    createdBy: v.id("users"),
    quoteNumber: v.optional(v.string()),
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
        serviceDiscountPercent: v.optional(v.number()),
        monthlyTotal: v.number(),
        yearlyTotal: v.number(),
        monthlyUnitPriceCents: v.optional(v.number()),
        monthlyTotalCents: v.optional(v.number()),
        yearlyTotalCents: v.optional(v.number()),
        regionId: v.optional(v.string()),
        regionName: v.optional(v.string()),
        dataCenterName: v.optional(v.string()),
      }),
    ),
    monthlyGrandTotal: v.number(),
    yearlyGrandTotal: v.number(),
    monthlyGrandTotalCents: v.optional(v.number()),
    yearlyGrandTotalCents: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    monthlySubtotal: v.optional(v.number()),
    yearlySubtotal: v.optional(v.number()),
    monthlyDiscountTotal: v.optional(v.number()),
    yearlyDiscountTotal: v.optional(v.number()),
    discountApprovalStatus: v.optional(
      v.union(
        v.literal("not_required"),
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
    ),
    discountApprovalLevel: v.optional(
      v.union(
        v.literal("self"),
        v.literal("account_manager"),
        v.literal("country_gm"),
        v.literal("head_of_business"),
        v.literal("ceo"),
      ),
    ),
    discountRequestedBy: v.optional(v.id("users")),
    discountRequestedAt: v.optional(v.number()),
    discountApprovedBy: v.optional(v.id("users")),
    discountApprovedAt: v.optional(v.number()),
    discountRejectedBy: v.optional(v.id("users")),
    discountRejectedAt: v.optional(v.number()),
    discountApprovalNote: v.optional(v.string()),
    notes: v.optional(v.string()),
    sourceMonth: v.optional(v.string()),
  })
    .index("by_company", ["companyId"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"])
    .index("by_quote_number", ["quoteNumber"]),

  combinedQuotes: defineTable({
    parentCompanyName: v.string(),
    createdBy: v.id("users"),
    quoteNumber: v.optional(v.string()),
    date: v.string(),
    expirationDate: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("accepted"),
    ),
    sourceMonth: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        sourceCompanyId: v.optional(v.id("companies")),
        sourceCompanyName: v.optional(v.string()),
        source: v.union(
          v.literal("usage"),
          v.literal("latest_accepted_quote"),
          v.literal("manual"),
        ),
        product: v.string(),
        quantity: v.number(),
        unitPrice: v.number(),
        taxRate: v.number(),
        discountPercent: v.number(),
        amount: v.number(),
      }),
    ),
    subtotal: v.number(),
    taxTotal: v.number(),
    discountTotal: v.number(),
    grandTotal: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"])
    .index("by_quote_number", ["quoteNumber"]),
});
