import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  DAILY_USAGE_BILLING_SNAPSHOT_CALCULATION_VERSION,
  buildDailyUsageBillingInputDigest,
  buildDailyUsageBillingHealth,
  buildDailyUsageBillingSnapshotCandidate,
  buildDailyUsageReviewResult,
  buildMonthlyRollupRows,
  buildDailyUsageRowsFromManageOneTenants,
  compareDailyUsageBillingSnapshot,
  dateKeyForTimestamp,
  findCompanyForMonthBillingSnapshotTest,
  findCompaniesForMonthBillingSnapshotTest,
  findCompaniesForMonthBillingSnapshotTestPage,
  shouldWriteDailyUsageBillingSnapshot,
} from "./dailyUsage";

function catalogItem(
  id: string,
  serviceCategory: string,
  itemName: string,
  billingUnit: string,
): Doc<"serviceCatalog"> {
  return {
    _id: id as Id<"serviceCatalog">,
    _creationTime: 1,
    serviceCategory,
    itemName,
    billingUnit,
    monthlyPrice: 10,
  };
}

function company(overrides: Partial<Doc<"companies">>): Doc<"companies"> {
  return {
    _id: "company1" as Id<"companies">,
    _creationTime: 1,
    name: "Mizan-Geomatic",
    sectorId: "sector1" as Id<"sectors">,
    countryId: "country1" as Id<"countries">,
    accountManagerId: "user1" as Id<"users">,
    contractStatus: "active",
    paymentStatus: "current",
    paymentTermDays: 7,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Doc<"companies">;
}

function tenant(
  overrides: Partial<Doc<"manageOneTenants">>,
): Doc<"manageOneTenants"> {
  return {
    _id: "tenant1" as Id<"manageOneTenants">,
    _creationTime: 1,
    vdcId: "vdc-1",
    name: "Mizan-Geomatic",
    lastSyncedAt: 1786600000000,
    ...overrides,
  };
}

function dailySnapshot(
  overrides: Partial<Doc<"dailyUsageSnapshots">>,
): Doc<"dailyUsageSnapshots"> {
  return {
    _id: "daily1" as Id<"dailyUsageSnapshots">,
    _creationTime: 1,
    companyId: "company1" as Id<"companies">,
    tenantId: "tenant1" as Id<"manageOneTenants">,
    tenantName: "Mizan-Geomatic",
    tenantVdcId: "vdc-1",
    usageDate: "2026-08-13",
    month: "2026-08",
    serviceType: "OBS",
    itemName: "Fusion bucket",
    serviceCategory: "OBS",
    quantity: 1303.85,
    unit: "per GB/month",
    source: "manageone",
    sourceKey: "manageone|2026-08-13|company1|tenant1|obs|fusion-bucket",
    capturedAt: 1786600000000,
    ...overrides,
  };
}

function shadowBillingFixture() {
  const companyId = "company1" as Id<"companies">;
  const obsCatalogId = "obs-fusion" as Id<"serviceCatalog">;
  const ecsCatalogId = "ecs-c6" as Id<"serviceCatalog">;
  const companies = [company({ _id: companyId })];
  const rows = [
    dailySnapshot({
      _id: "daily-obs" as Id<"dailyUsageSnapshots">,
      companyId,
      catalogItemId: obsCatalogId,
      quantity: 310,
      capturedAt: 1786600000000,
    }),
    dailySnapshot({
      _id: "daily-ecs" as Id<"dailyUsageSnapshots">,
      companyId,
      catalogItemId: ecsCatalogId,
      usageDate: "2026-08-14",
      serviceType: "ECS",
      serviceCategory: "ECS",
      itemName: "C6_2xlarge.4",
      unit: "per instance/month",
      quantity: 31,
      capturedAt: 1786686400000,
    }),
  ];
  const catalogItems = [
    {
      ...catalogItem(obsCatalogId, "OBS", "Fusion bucket", "per GB/month"),
      monthlyPrice: 0.011,
    },
    {
      ...catalogItem(
        ecsCatalogId,
        "ECS",
        "C6_2xlarge.4",
        "per instance/month",
      ),
      monthlyPrice: 120,
    },
  ];
  const businessDate = "2026-08-14";
  const month = "2026-08";
  const reviewResult = buildDailyUsageReviewResult({
    month,
    rows,
    visibleCompanyById: new Map([[companyId, companies[0]]]),
    catalogById: new Map(catalogItems.map((item) => [item._id, item])),
    businessDate,
  });
  const inputDigest = buildDailyUsageBillingInputDigest({
    month,
    businessDate,
    rows,
    companies,
    catalogItems,
  });
  return {
    companyId,
    month,
    businessDate,
    rows,
    companies,
    catalogItems,
    reviewResult,
    inputDigest,
  };
}

function contract(
  overrides: Partial<Doc<"customerContracts">>,
): Doc<"customerContracts"> {
  return {
    _id: "contract1" as Id<"customerContracts">,
    _creationTime: 1,
    companyId: "company1" as Id<"companies">,
    contractNumber: "MZ-2026-002",
    title: "Mizan Contract Billing",
    status: "active",
    startDate: Date.UTC(2026, 7, 1),
    endDate: Date.UTC(2026, 7, 31, 23, 59, 59, 999),
    signedDate: Date.UTC(2026, 7, 12),
    currency: "USD",
    billingFrequency: "monthly",
    paymentTermDays: 30,
    createdBy: "user1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function contractLine(
  overrides: Partial<Doc<"customerContractLineItems">>,
): Doc<"customerContractLineItems"> {
  return {
    _id: "line1" as Id<"customerContractLineItems">,
    _creationTime: 1,
    contractId: "contract1" as Id<"customerContracts">,
    itemName: "Fusion bucket",
    serviceCategory: "OBS",
    includedQuantity: 3000,
    unit: "per GB/month",
    catalogUnitPrice: 0.011,
    contractUnitPrice: 0.08,
    discountType: "amount",
    discountValue: 40,
    billingUnit: "per GB/month",
    createdBy: "user1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("daily usage capture helpers", () => {
  it("builds billing health from the already-visible monthly rows", () => {
    const catalogItemId = "catalog1" as Id<"serviceCatalog">;
    const rows = [
      dailySnapshot({
        _id: "daily1" as Id<"dailyUsageSnapshots">,
        usageDate: "2026-08-13",
        serviceType: "OBS",
        catalogItemId,
        invoiceId: "invoice1" as Id<"invoices">,
      }),
      dailySnapshot({
        _id: "daily2" as Id<"dailyUsageSnapshots">,
        usageDate: "2026-08-14",
        serviceType: "ECS",
        catalogItemId,
      }),
      dailySnapshot({
        _id: "daily3" as Id<"dailyUsageSnapshots">,
        usageDate: "2026-08-14",
        serviceType: "EVS",
        catalogItemId: undefined,
      }),
    ];

    expect(buildDailyUsageBillingHealth(rows, "2026-08-14")).toEqual({
      latestUsageDate: "2026-08-14",
      capturedThroughToday: true,
      rowCount: 3,
      latestDayRowCount: 2,
      serviceRows: [
        { serviceType: "ECS", rowCount: 1 },
        { serviceType: "EVS", rowCount: 1 },
      ],
      attachedRowCount: 1,
      missingPriceRowCount: 1,
      missingServices: ["EVS"],
    });
  });

  it("formats the Africa/Mogadishu business date key", () => {
    expect(dateKeyForTimestamp(Date.UTC(2026, 7, 13, 20, 55))).toBe(
      "2026-08-13",
    );
  });

  it("builds dated daily rows from linked ManageOne tenant resources", () => {
    const companyId = "company1" as Id<"companies">;
    const catalog = [
      catalogItem("ecs-c6", "ECS", "C6_2xlarge.4", "per instance/month"),
      catalogItem("obs-fusion", "OBS", "Fusion bucket", "per GB/month"),
    ];
    const rows = buildDailyUsageRowsFromManageOneTenants(
      [
        tenant({
          linkedCompanyId: companyId,
          ecsFlavors: [
            {
              flavorName: "C6_2xlarge.4",
              vcpus: 8,
              ramMb: 32768,
              count: 2,
              regionId: "region-hq3",
              regionName: "Mogadishu-region-hq3",
            },
          ],
          obsBuckets: [
            {
              bucketName: "fusion",
              totalGb: 1303.85,
              catalogItemName: "Fusion bucket",
              regionId: "region-hq3",
              regionName: "Mogadishu-region-hq3",
            },
          ],
        }),
      ],
      catalog,
      "2026-08-13",
      1786600000000,
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          companyId,
          usageDate: "2026-08-13",
          month: "2026-08",
          serviceType: "ECS",
          itemName: "C6_2xlarge.4",
          quantity: 2,
          unit: "per instance/month",
        }),
        expect.objectContaining({
          companyId,
          usageDate: "2026-08-13",
          month: "2026-08",
          serviceType: "OBS",
          itemName: "Fusion bucket",
          quantity: 1303.85,
          unit: "per GB/month",
        }),
      ]),
    );
    expect(new Set(rows.map((row) => row.sourceKey)).size).toBe(2);
  });

  it("ignores ManageOne tenants that are not linked to a CRM company", () => {
    const rows = buildDailyUsageRowsFromManageOneTenants(
      [
        tenant({
          linkedCompanyId: undefined,
          ecsFlavors: [
            {
              flavorName: "C6_2xlarge.4",
              vcpus: 8,
              ramMb: 32768,
              count: 1,
            },
          ],
        }),
      ],
      [catalogItem("ecs-c6", "ECS", "C6_2xlarge.4", "per instance/month")],
      "2026-08-13",
      1786600000000,
    );

    expect(rows).toEqual([]);
  });

  it("prices active contract daily usage from the contract minimum before catalog price", () => {
    const companyId = "company1" as Id<"companies">;
    const obsCatalogId = "obs-fusion" as Id<"serviceCatalog">;
    const activeContract = contract({ companyId });
    const line = contractLine({
      contractId: activeContract._id,
      catalogItemId: obsCatalogId,
    });
    const [row] = buildMonthlyRollupRows({
      rows: [
        dailySnapshot({
          companyId,
          catalogItemId: obsCatalogId,
          quantity: 1303.85,
        }),
      ],
      catalogById: new Map([
        [
          obsCatalogId,
          {
            ...catalogItem(
              obsCatalogId,
              "OBS",
              "Fusion bucket",
              "per GB/month",
            ),
            monthlyPrice: 0.011,
          },
        ],
      ]),
      companyNameById: new Map([[companyId, "Mizan-Geomatic"]]),
      month: "2026-08",
      contractPricingByCompany: new Map([
        [companyId, { contract: activeContract, lines: [line], groupDiscountByKey: new Map() }],
      ]),
    });

    expect(row.pricingSource).toBe("contract");
    expect(row.contractNumber).toBe("MZ-2026-002");
    expect(row.unit).toBe("contract/month");
    expect(row.billableQuantity).toBeCloseTo(1 / 31, 5);
    expect(row.monthlyUnitPrice).toBe(200);
    expect(row.estimatedAmount).toBe(6.45);
  });

  it("keeps pre-contract usage at catalog price when a customer converts mid-month", () => {
    const companyId = "company1" as Id<"companies">;
    const catalogId = "obs-fusion" as Id<"serviceCatalog">;
    const activeContract = contract({
      companyId,
      startDate: Date.UTC(2026, 7, 16),
    });
    const rows = buildMonthlyRollupRows({
      rows: [
        dailySnapshot({
          _id: "before" as Id<"dailyUsageSnapshots">,
          companyId,
          catalogItemId: catalogId,
          usageDate: "2026-08-10",
          quantity: 310,
        }),
        dailySnapshot({
          _id: "after" as Id<"dailyUsageSnapshots">,
          companyId,
          catalogItemId: catalogId,
          usageDate: "2026-08-20",
          quantity: 620,
        }),
      ],
      catalogById: new Map([
        [
          catalogId,
          {
            ...catalogItem(catalogId, "OBS", "Fusion bucket", "per GB/month"),
            monthlyPrice: 0.011,
          },
        ],
      ]),
      companyNameById: new Map([[companyId, "Mizan-Geomatic"]]),
      month: "2026-08",
      contractPricingByCompany: new Map([
        [
          companyId,
          {
            contract: activeContract,
            lines: [
              contractLine({
                contractId: activeContract._id,
                catalogItemId: catalogId,
              }),
            ],
            groupDiscountByKey: new Map(),
          },
        ],
      ]),
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.pricingSource === "catalog")).toMatchObject({
      itemName: "Fusion bucket (pre-contract)",
      pricingSource: "catalog",
      dailyQuantityTotal: 310,
      estimatedAmount: 0.11,
    });
    expect(rows.find((row) => row.pricingSource === "contract")).toMatchObject({
      itemName: "Fusion bucket",
      pricingSource: "contract",
      dailyQuantityTotal: 620,
    });
  });

  it("builds the Daily Usage review result from already-loaded inputs without changing rollup output", () => {
    const companyId = "company1" as Id<"companies">;
    const hiddenCompanyId = "company2" as Id<"companies">;
    const obsCatalogId = "obs-fusion" as Id<"serviceCatalog">;
    const ecsCatalogId = "ecs-c6" as Id<"serviceCatalog">;
    const activeContract = contract({ companyId });
    const contractLines = [
      contractLine({
        contractId: activeContract._id,
        catalogItemId: obsCatalogId,
      }),
      contractLine({
        _id: "line2" as Id<"customerContractLineItems">,
        contractId: activeContract._id,
        catalogItemId: ecsCatalogId,
        itemName: "C6_2xlarge.4",
        serviceCategory: "ECS",
        includedQuantity: 1,
        unit: "per instance/month",
        catalogUnitPrice: 120,
        contractUnitPrice: 100,
        discountType: undefined,
        discountValue: undefined,
        overageUnitPrice: 20,
        billingUnit: "per instance/month",
        productGroup: "compute",
      }),
    ];
    const rows = [
      dailySnapshot({
        _id: "obs-row" as Id<"dailyUsageSnapshots">,
        companyId,
        catalogItemId: obsCatalogId,
        usageDate: "2026-08-13",
        quantity: 1303.85,
        invoiceId: "invoice1" as Id<"invoices">,
        regionId: "mog-hq3",
        regionName: "Mogadishu-region-hq3",
        dataCenterName: "htgcloud-region-02",
      }),
      dailySnapshot({
        _id: "ecs-row" as Id<"dailyUsageSnapshots">,
        companyId,
        catalogItemId: ecsCatalogId,
        usageDate: "2026-08-14",
        serviceType: "ECS",
        itemName: "C6_2xlarge.4",
        serviceCategory: "ECS",
        quantity: 62,
        unit: "per instance/month",
        lockedAt: 1786690000000,
        regionId: "mog-hq3",
        regionName: "Mogadishu-region-hq3",
        dataCenterName: "htgcloud-region-02",
      }),
      dailySnapshot({
        _id: "missing-row" as Id<"dailyUsageSnapshots">,
        companyId,
        catalogItemId: undefined,
        usageDate: "2026-08-14",
        serviceType: "EVS",
        itemName: "SSD",
        serviceCategory: "EVS",
        quantity: 100,
      }),
      dailySnapshot({
        _id: "hidden-row" as Id<"dailyUsageSnapshots">,
        companyId: hiddenCompanyId,
        usageDate: "2026-08-14",
      }),
    ];
    const catalogById = new Map([
      [
        obsCatalogId,
        {
          ...catalogItem(obsCatalogId, "OBS", "Fusion bucket", "per GB/month"),
          monthlyPrice: 0.011,
        },
      ],
      [
        ecsCatalogId,
        {
          ...catalogItem(
            ecsCatalogId,
            "ECS",
            "C6_2xlarge.4",
            "per instance/month",
          ),
          monthlyPrice: 120,
        },
      ],
    ]);
    const visibleCompanyById = new Map([[companyId, company({ _id: companyId })]]);
    const contractPricingByCompany = new Map([
      [
        companyId,
        {
          contract: activeContract,
          lines: contractLines,
          groupDiscountByKey: new Map([["compute", 10]]),
        },
      ],
    ]);

    const result = buildDailyUsageReviewResult({
      month: "2026-08",
      rows,
      visibleCompanyById,
      catalogById,
      contractPricingByCompany,
      businessDate: "2026-08-14",
    });
    const directRollup = buildMonthlyRollupRows({
      rows: rows.filter((row) => row.companyId === companyId),
      catalogById,
      companyNameById: new Map([[companyId, "Mizan-Geomatic"]]),
      month: "2026-08",
      contractPricingByCompany,
    });

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row._id)).toEqual([
      "ecs-row",
      "missing-row",
      "obs-row",
    ]);
    expect(result.rows.every((row) => row.companyName === "Mizan-Geomatic")).toBe(
      true,
    );
    expect(result.rollup.rows).toEqual(directRollup);
    expect(result.rollup.totals.unpricedCount).toBe(1);
    expect(result.rollup.totals.attachedCount).toBe(2);
    expect(result.summary).toMatchObject({
      rowCount: 3,
      capturedCount: 2,
      lockedCount: 1,
      companyCount: 1,
      serviceCount: 3,
      dayCount: 2,
    });
    expect(result.billingHealth).toMatchObject({
      latestUsageDate: "2026-08-14",
      capturedThroughToday: true,
      rowCount: 3,
      latestDayRowCount: 2,
      attachedRowCount: 2,
      missingPriceRowCount: 1,
    });
    expect(result.filters.companies).toEqual([
      { companyId, companyName: "Mizan-Geomatic" },
    ]);
    expect(result.filters.serviceTypes).toEqual(["ECS", "EVS", "OBS"]);
    expect(result.filters.usageDates).toEqual(["2026-08-13", "2026-08-14"]);
    expect(
      result.rollup.rows.find((row) => row.serviceType === "ECS"),
    ).toMatchObject({
      pricingSource: "contract",
      overageQuantity: 1.967742,
      overageUnitPrice: 120,
      regionId: "mog-hq3",
      dataCenterName: "htgcloud-region-02",
    });
    expect(
      result.rollup.rows.find((row) => row.serviceType === "ECS")
        ?.contractDiscountAmount,
    ).toBeGreaterThan(0);
  });

  it("preserves current flexible-value contract behavior when no service override matches usage", () => {
    const companyId = "company1" as Id<"companies">;
    const catalogId = "ecs-c6" as Id<"serviceCatalog">;
    const flexibleContract = contract({
      companyId,
      commitmentModel: "flexible_value",
      pricingBasis: "total_contract",
      contractValue: 14110.52,
    });

    const result = buildDailyUsageReviewResult({
      month: "2026-08",
      rows: [
        dailySnapshot({
          companyId,
          catalogItemId: catalogId,
          serviceType: "ECS",
          itemName: "C6_2xlarge.4",
          serviceCategory: "ECS",
          quantity: 31,
          unit: "per instance/month",
        }),
      ],
      visibleCompanyById: new Map([[companyId, company({ _id: companyId })]]),
      catalogById: new Map([
        [
          catalogId,
          {
            ...catalogItem(
              catalogId,
              "ECS",
              "C6_2xlarge.4",
              "per instance/month",
            ),
            monthlyPrice: 120,
          },
        ],
      ]),
      contractPricingByCompany: new Map([
        [
          companyId,
          {
            contract: flexibleContract,
            lines: [],
            groupDiscountByKey: new Map(),
          },
        ],
      ]),
      businessDate: "2026-08-13",
    });

    expect(result.rollup.rows).toHaveLength(1);
    expect(result.rollup.rows[0]).toMatchObject({
      pricingSource: "catalog",
      monthlyUnitPrice: 120,
      estimatedAmount: 120,
    });
  });

  it("matches a persisted shadow snapshot built from the same canonical inputs", () => {
    const fixture = shadowBillingFixture();
    const persisted = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 100,
    });
    const liveCandidate = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 200,
    });

    expect(
      compareDailyUsageBillingSnapshot(persisted, liveCandidate),
    ).toEqual({ status: "match", reason: "identical" });
  });

  it("treats an identical rebuild as idempotent", () => {
    const fixture = shadowBillingFixture();
    const first = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 100,
    });
    const second = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 200,
    });

    expect(shouldWriteDailyUsageBillingSnapshot(first, second)).toBe(false);
  });

  it("marks calculation-version and input changes as stale", () => {
    const fixture = shadowBillingFixture();
    const candidate = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 100,
    });

    expect(
      compareDailyUsageBillingSnapshot(
        { ...candidate, calculationVersion: "older-calculation" },
        candidate,
      ),
    ).toEqual({
      status: "stale",
      reason: "calculation_version_changed",
    });
    expect(
      compareDailyUsageBillingSnapshot(
        { ...candidate, inputDigest: "older-inputs" },
        candidate,
      ),
    ).toEqual({ status: "stale", reason: "inputs_changed" });
  });

  it("detects a billing-result mismatch for identical version and inputs", () => {
    const fixture = shadowBillingFixture();
    const candidate = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 100,
    });

    expect(
      compareDailyUsageBillingSnapshot(
        { ...candidate, billingResultDigest: "different-result" },
        candidate,
      ),
    ).toEqual({ status: "mismatch", reason: "billing_result_changed" });
  });

  it("builds deterministic input digests regardless of document ordering", () => {
    const fixture = shadowBillingFixture();
    const reorderedDigest = buildDailyUsageBillingInputDigest({
      month: fixture.month,
      businessDate: fixture.businessDate,
      rows: [...fixture.rows].reverse(),
      companies: [...fixture.companies].reverse(),
      catalogItems: [...fixture.catalogItems].reverse(),
    });

    expect(reorderedDigest).toBe(fixture.inputDigest);
  });

  it("projects a shadow snapshot without mutating live billing output", () => {
    const fixture = shadowBillingFixture();
    const liveOutputBefore = JSON.stringify(fixture.reviewResult);
    const candidate = buildDailyUsageBillingSnapshotCandidate({
      companyId: fixture.companyId,
      month: fixture.month,
      rows: fixture.rows,
      reviewResult: fixture.reviewResult,
      inputDigest: fixture.inputDigest,
      computedAt: 100,
    });

    expect(JSON.stringify(fixture.reviewResult)).toBe(liveOutputBefore);
    expect(candidate.calculationVersion).toBe(
      DAILY_USAGE_BILLING_SNAPSHOT_CALCULATION_VERSION,
    );
    expect(candidate.estimatedAmount).toBe(
      fixture.reviewResult.rollup.totals.estimatedAmount,
    );
  });
  it("exposes an internal-only company selector for shadow snapshot testing", () => {
    expect(findCompanyForMonthBillingSnapshotTest).toBeDefined();
  });

  it("exposes an internal-only multi-company selector for shadow snapshot testing", () => {
    expect(findCompaniesForMonthBillingSnapshotTest).toBeDefined();
  });

  it("exposes an internal-only paged company selector for all-company shadow testing", () => {
    expect(findCompaniesForMonthBillingSnapshotTestPage).toBeDefined();
  });

});
