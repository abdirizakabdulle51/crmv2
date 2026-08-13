import { describe, expect, it } from "vitest";
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
});
