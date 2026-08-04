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
    paymentTermDays: v.optional(
      v.union(v.literal(7), v.literal(15), v.literal(30)),
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
    ),
    description: v.optional(v.string()),
    date: v.string(),
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
    ),
    title: v.string(),
    body: v.optional(v.string()),
    entityType: v.literal("task"),
    entityId: v.id("tasks"),
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
    sourceQuoteId: v.optional(v.id("quotes")),
    sourceMonth: v.optional(v.string()),
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
    companyName: v.string(),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    taxId: v.optional(v.string()),
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
    subtotal: v.number(),
    monthlyTotal: v.number(),
    yearlyTotal: v.number(),
    grandTotal: v.number(),
    amountPaid: v.number(),
    balanceDue: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"])
    .index("by_source_quote", ["sourceQuoteId"])
    .index("by_invoice_number", ["invoiceNumber"]),

  invoicePayments: defineTable({
    invoiceId: v.id("invoices"),
    amount: v.number(),
    paidAt: v.number(),
    method: v.optional(v.string()),
    reference: v.optional(v.string()),
    recordedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_recorded_by", ["recordedBy"]),

  invoiceEvents: defineTable({
    invoiceId: v.id("invoices"),
    type: v.union(
      v.literal("draft_created"),
      v.literal("draft_updated"),
      v.literal("issued"),
      v.literal("voided"),
      v.literal("sent"),
      v.literal("payment_recorded"),
      v.literal("overdue"),
    ),
    actorId: v.optional(v.id("users")),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_type", ["type"]),

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
