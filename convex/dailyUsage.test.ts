import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
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
});
