import { describe, expect, it } from "vitest";
import { generateRecommendations } from "./rules";

const sector = { _id: "sector-banking", name: "Banking" };
const catalog = [
  {
    serviceCategory: "CSBS",
    itemName: "General CSBS Duplication (backup)",
    billingUnit: "per GB",
    monthlyPrice: 0.024,
  },
  {
    serviceCategory: "OBS",
    itemName: "Fusion bucket - Standard",
    billingUnit: "per GB",
    monthlyPrice: 0.012,
  },
  {
    serviceCategory: "CBH",
    itemName: "Managed Secure Gate",
    billingUnit: "flat/month",
    monthlyPrice: 45,
  },
];

describe("generateRecommendations estimate values", () => {
  it("scales backup and object storage opportunity by small company storage quantity", () => {
    const recommendations = generateRecommendations(
      [
        {
          _id: "small-co",
          name: "Small Co",
          sectorId: sector._id,
        },
      ],
      [
        {
          companyId: "small-co",
          month: "2026-07",
          serviceType: "ECS",
          amount: 100,
          quantity: 4,
        },
        {
          companyId: "small-co",
          month: "2026-07",
          serviceType: "EVS",
          amount: 72,
          quantity: 1000,
        },
      ],
      [sector],
      catalog,
    );

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "backup",
          estimatedMonthlyValue: 24,
          estimatedValue: "Estimated upsell: ~$24.00/month",
          estimateBasis: "1,000 GB protected storage (2026-07) x $0.024/per GB",
          estimateCatalogItemName: "General CSBS Duplication (backup)",
        }),
        expect.objectContaining({
          rule: "object_storage",
          estimatedMonthlyValue: 12,
          estimatedValue: "Estimated upsell: ~$12.00/month",
          estimateBasis: "1,000 GB storage footprint (2026-07) x $0.012/per GB",
          estimateCatalogItemName: "Fusion bucket - Standard",
        }),
      ]),
    );
  });

  it("scales the same catalog rates for a large storage footprint", () => {
    const recommendations = generateRecommendations(
      [
        {
          _id: "large-co",
          name: "Large Co",
          sectorId: sector._id,
        },
      ],
      [
        {
          companyId: "large-co",
          month: "2026-07",
          serviceType: "ECS",
          amount: 4000,
          quantity: 42,
        },
        {
          companyId: "large-co",
          month: "2026-07",
          serviceType: "EVS",
          amount: 1480,
          quantity: 20556,
        },
      ],
      [sector],
      catalog,
    );

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "backup",
          estimatedMonthlyValue: 493.344,
          estimatedValue: "Estimated upsell: ~$493.34/month",
          estimateBasis:
            "20,556 GB protected storage (2026-07) x $0.024/per GB",
        }),
        expect.objectContaining({
          rule: "object_storage",
          estimatedMonthlyValue: 246.672,
          estimatedValue: "Estimated upsell: ~$246.67/month",
          estimateBasis:
            "20,556 GB storage footprint (2026-07) x $0.012/per GB",
        }),
      ]),
    );
  });

  it("keeps flat-fee recommendations numeric without using usage quantity", () => {
    const recommendations = generateRecommendations(
      [
        {
          _id: "bank-co",
          name: "Bank Co",
          sectorId: sector._id,
        },
      ],
      [
        {
          companyId: "bank-co",
          month: "2026-07",
          serviceType: "ECS",
          amount: 100,
          quantity: 2,
        },
      ],
      [sector],
      catalog,
    );

    expect(recommendations).toContainEqual(
      expect.objectContaining({
        rule: "compliance",
        estimatedMonthlyValue: 45,
        estimatedValue: "Estimated upsell: ~$45.00/month",
        estimateBasis: "Flat catalog rate: $45.00/mo per flat/month",
      }),
    );
  });
});
