import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  buildMonthlyRollupRows,
  buildDailyUsageRowsFromManageOneTenants,
  dateKeyForTimestamp,
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
  it("does not mount heavy health while loading the global rollup", () => {
    const source = readFileSync(
      new URL("../src/pages/finance/daily-usage/page.tsx", import.meta.url),
      "utf8",
    );
    const healthBlock = source.slice(
      source.indexOf("const health = useQuery"),
      source.indexOf("const rows = useMemo"),
    );

    expect(healthBlock).toContain("api.dailyUsage.health");
    expect(healthBlock).toContain("shouldLoadHealth");
    expect(healthBlock).not.toContain("shouldLoadDetailedQueries");
  });

  it("keeps initial status hourly reads to one indexed row", () => {
    const source = readFileSync(
      new URL("./dailyUsage.ts", import.meta.url),
      "utf8",
    );
    const statusSource = source.slice(
      source.indexOf("export const status"),
      source.indexOf("export const createDraftInvoiceFromRollup"),
    );

    expect(statusSource).toContain('.withIndex("by_hour")');
    expect(statusSource).toContain('.order("desc")');
    expect(statusSource).toContain(".first()");
    expect(statusSource).not.toContain(".take(500)");
    expect(statusSource).not.toContain("latestHourlyRows.reduce");
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

  it("uses hourly billing totals instead of stale structured resource breakdowns", () => {
    const companyId = "company1" as Id<"companies">;
    const rows = buildDailyUsageRowsFromManageOneTenants(
      [
        {
          ...tenant({
            linkedCompanyId: companyId,
            evsVolumeTypes: [
              {
                volumeType: "SSD",
                totalGb: 2188,
                count: 10,
              },
            ],
            natGateways: {
              count: 1,
              resourceTypeName: "NAT Gateway",
              items: [
                {
                  id: "nat-1",
                  name: "nat-1",
                  resourceTypeName: "NAT Gateway",
                },
              ],
            },
            resources: [
              { serviceId: "evs", resource: "gigabytes", used: 150959 },
              { serviceId: "vpc", resource: "nat", used: 17 },
            ],
          }),
          billingFromHourly: true,
        },
      ] as Array<Doc<"manageOneTenants"> & { billingFromHourly: true }>,
      [],
      "2026-08-19",
      1787120000000,
    );

    const quantityFor = (serviceType: string) =>
      rows
        .filter((row) => row.serviceType === serviceType)
        .reduce((sum, row) => sum + row.quantity, 0);

    expect(quantityFor("EVS")).toBe(150959);
    expect(quantityFor("NAT")).toBe(17);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceType: "EVS",
          itemName: "Unclassified EVS",
          quantity: 148771,
        }),
        expect.objectContaining({
          serviceType: "NAT",
          itemName: "Unclassified NAT",
          quantity: 16,
        }),
      ]),
    );
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
        [companyId, { contract: activeContract, lines: [line] }],
      ]),
    });

    expect(row.pricingSource).toBe("contract");
    expect(row.contractNumber).toBe("MZ-2026-002");
    expect(row.unit).toBe("contract/month");
    expect(row.billableQuantity).toBeCloseTo(1 / 31, 5);
    expect(row.monthlyUnitPrice).toBe(200);
    expect(row.estimatedAmount).toBe(6.45);
  });

  it("matches the frozen production rollup baseline across catalogue and contract pricing", () => {
    const companyId = "company1" as Id<"companies">;
    const catalogId = "catalog-ecs" as Id<"serviceCatalog">;
    const contractId = "contract1" as Id<"customerContracts">;
    const contractLineId = "line1" as Id<"customerContractLineItems">;
    const activeContract = contract({ _id: contractId, companyId });
    const activeLine = contractLine({
      _id: contractLineId,
      contractId,
      itemName: "Contract-only ECS",
      serviceCategory: "ECS",
      unit: "per instance/month",
      billingUnit: "per instance/month",
      includedQuantity: 300,
      contractUnitPrice: 0.1,
      overageUnitPrice: 0.2,
      discountType: "percentage",
      discountValue: 10,
    });
    const rows = buildMonthlyRollupRows({
      rows: [
        dailySnapshot({
          _id: "catalog-row-a" as Id<"dailyUsageSnapshots">,
          usageDate: "2026-08-01",
          catalogItemId: catalogId,
          itemName: "C6_2xlarge.4",
          serviceType: "ECS",
          serviceCategory: "ECS",
          unit: "per instance/month",
          quantity: 310,
        }),
        dailySnapshot({
          _id: "catalog-row-b" as Id<"dailyUsageSnapshots">,
          usageDate: "2026-08-02",
          catalogItemId: catalogId,
          itemName: "C6_2xlarge.4",
          serviceType: "ECS",
          serviceCategory: "ECS",
          unit: "per instance/month",
          quantity: 310,
        }),
        dailySnapshot({
          _id: "contract-row-a" as Id<"dailyUsageSnapshots">,
          usageDate: "2026-08-01",
          catalogItemId: undefined,
          itemName: "Contract-only ECS",
          serviceType: "ECS",
          serviceCategory: "ECS",
          unit: "per instance/month",
          quantity: 310,
          sourceKey: "contract-row-a",
        }),
        dailySnapshot({
          _id: "contract-row-b" as Id<"dailyUsageSnapshots">,
          usageDate: "2026-08-02",
          catalogItemId: undefined,
          itemName: "Contract-only ECS",
          serviceType: "ECS",
          serviceCategory: "ECS",
          unit: "per instance/month",
          quantity: 310,
          sourceKey: "contract-row-b",
          lockedAt: 1785600000000,
          invoiceId: "invoice1" as Id<"invoices">,
        }),
        dailySnapshot({
          _id: "missing-price-row" as Id<"dailyUsageSnapshots">,
          usageDate: "2026-08-02",
          catalogItemId: undefined,
          itemName: "Unknown ECS",
          serviceType: "ECS",
          serviceCategory: "ECS",
          unit: "per instance/month",
          quantity: 5,
          sourceKey: "missing-price-row",
        }),
      ],
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
            monthlyPrice: 2,
          },
        ],
      ]),
      companyNameById: new Map([[companyId, "Mizan-Geomatic"]]),
      month: "2026-08",
      contractPricingByCompany: new Map([
        [companyId, { contract: activeContract, lines: [activeLine] }],
      ]),
    });

    expect(
      rows.map((row) => ({
        itemName: row.itemName,
        capturedDays: row.capturedDays,
        dailyQuantityTotal: row.dailyQuantityTotal,
        billableQuantity: row.billableQuantity,
        monthlyUnitPrice: row.monthlyUnitPrice,
        estimatedAmount: row.estimatedAmount,
        pricingSource: row.pricingSource,
        unit: row.unit,
      })),
    ).toEqual([
      {
        itemName: "C6_2xlarge.4",
        capturedDays: 2,
        dailyQuantityTotal: 620,
        billableQuantity: 20,
        monthlyUnitPrice: 2,
        estimatedAmount: 40,
        pricingSource: "catalog",
        unit: "per instance/month",
      },
      {
        itemName: "Contract-only ECS",
        capturedDays: 2,
        dailyQuantityTotal: 620,
        billableQuantity: 2 / 31,
        monthlyUnitPrice: 27,
        estimatedAmount: 1.87,
        pricingSource: "contract",
        unit: "contract/month",
      },
      {
        itemName: "Unknown ECS",
        capturedDays: 1,
        dailyQuantityTotal: 5,
        billableQuantity: 5 / 31,
        monthlyUnitPrice: undefined,
        estimatedAmount: undefined,
        pricingSource: undefined,
        unit: "per instance/month",
      },
    ]);
  });
});
