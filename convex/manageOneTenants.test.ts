import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel.d.ts";
import {
  buildBulkUsagePreview,
  buildUsageHintsForCompany,
} from "./manageOneTenants";

function catalogItem(
  id: string,
  serviceCategory: string,
  itemName: string,
  billingUnit?: string,
  monthlyPrice?: number,
) {
  return {
    _id: id as Id<"serviceCatalog">,
    serviceCategory,
    itemName,
    ...(billingUnit ? { billingUnit } : {}),
    ...(monthlyPrice != null ? { monthlyPrice } : {}),
  };
}

describe("buildUsageHintsForCompany", () => {
  it("classifies real ManageOne resource keys and sums linked tenant usage", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "ecs", resource: "instances", used: 3 },
            { serviceId: "bms", resource: "instances", used: 1 },
            { serviceId: "rds", resource: "instance", used: 2 },
            {
              serviceId: "cce",
              resource: "hybrid.resource.type.cce.cluster",
              used: 1,
            },
            { serviceId: "evs", resource: "gigabytes", used: 500 },
            { serviceId: "sfs", resource: "gigabytes", used: 25 },
            { serviceId: "csbs", resource: "backup_capacity", used: 100 },
            { serviceId: "vpc", resource: "publicIp", used: 2 },
            { serviceId: "vpc", resource: "bandwidth_size", used: 20 },
            { serviceId: "waf", resource: "waf.instance", used: 1 },
          ],
        },
        {
          resources: [
            { serviceId: "sfs", resource: "gigabytes", used: 75 },
            { serviceId: "vbs", resource: "volume_backup_capacity", used: 80 },
            { serviceId: "vpc", resource: "loadbalancer", used: 1 },
            { serviceId: "vpc", resource: "vpn", used: 1 },
            { serviceId: "vpc", resource: "endpoint_service", used: 2 },
            { serviceId: "nat", resource: "gateway", used: 1 },
            { serviceId: "lts", resource: "gigabytes", used: 10 },
            { serviceId: "ecs", resource: "instances", used: 0 },
          ],
        },
      ],
      [
        catalogItem("bms", "BMS", "bms.physical.o2"),
        catalogItem("rds", "RDS", "RDS - Instance"),
        catalogItem("cce", "ECS-CCE", "CCE Cluster"),
        catalogItem("sfs", "SFS", "SFS_SATA"),
        catalogItem("csbs", "CSBS", "General CSBS Duplication (backup)"),
        catalogItem(
          "vbs",
          "VBS",
          "General VBS Duplication (Volume Backup Service)",
        ),
        catalogItem("eip-active", "EIP", "EIP - Active"),
        catalogItem("eip-idle", "EIP", "EIP - Idle"),
        catalogItem("eip-bw-1", "EIP Bandwidth", "1 - 5 Mbps"),
        catalogItem("eip-bw-2", "EIP Bandwidth", "6 - 50 Mbps"),
        catalogItem("eip-bw-3", "EIP Bandwidth", "51 - 200 Mbps"),
        catalogItem("elb", "ELB", "ELB - Shared"),
        catalogItem("vpn", "VPN", "General VPN Connection"),
        catalogItem("vpcep", "VPCEP", "General VPC Endpoints"),
      ],
    );

    expect(hints).toEqual(
      expect.arrayContaining([
        { serviceCategory: "ECS", quantity: 3, pricing: "manual" },
        {
          serviceCategory: "BMS",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "bms",
        },
        {
          serviceCategory: "RDS",
          quantity: 2,
          pricing: "auto",
          suggestedCatalogItemId: "rds",
        },
        {
          serviceCategory: "ECS-CCE",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "cce",
        },
        { serviceCategory: "EVS", quantity: 500, pricing: "manual" },
        {
          serviceCategory: "SFS",
          quantity: 100,
          pricing: "auto",
          suggestedCatalogItemId: "sfs",
        },
        {
          serviceCategory: "CSBS",
          quantity: 100,
          pricing: "auto",
          suggestedCatalogItemId: "csbs",
        },
        {
          serviceCategory: "VBS",
          quantity: 80,
          pricing: "auto",
          suggestedCatalogItemId: "vbs",
        },
        {
          serviceCategory: "EIP",
          quantity: 2,
          pricing: "auto",
          suggestedCatalogItemId: "eip-active",
        },
        {
          serviceCategory: "EIP (bandwidth)",
          quantity: 20,
          pricing: "auto",
          suggestedCatalogItemId: "eip-bw-2",
        },
        { serviceCategory: "WAF", quantity: 1, pricing: "manual" },
        {
          serviceCategory: "ELB",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "elb",
        },
        {
          serviceCategory: "VPN",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "vpn",
        },
        {
          serviceCategory: "VPCEP",
          quantity: 2,
          pricing: "auto",
          suggestedCatalogItemId: "vpcep",
        },
      ]),
    );
    expect(hints.map((hint) => hint.serviceCategory)).not.toContain("NAT");
    expect(hints.map((hint) => hint.serviceCategory)).not.toContain("LTS");
  });

  it("preserves ManageOne region metadata in bulk usage preview rows", () => {
    const catalog = [catalogItem("sfs", "SFS", "SFS_SATA", "per GB", 2)];
    const hints = buildUsageHintsForCompany(
      [
        {
          regionId: "hoa-mog-2",
          regionName: "Hoa-Mogadishu-2",
          resources: [
            { serviceId: "sfs", resource: "gigabytes", used: 10 },
          ],
        },
        {
          regionId: "mog-hq3",
          regionName: "Mogadishu-region-hq3",
          resources: [
            { serviceId: "sfs", resource: "gigabytes", used: 20 },
          ],
        },
      ],
      catalog,
    );

    const preview = buildBulkUsagePreview(hints, catalog, [
      {
        serviceType: "SFS",
        catalogItemId: "sfs" as Id<"serviceCatalog">,
        regionId: "hoa-mog-2",
        regionName: "Hoa-Mogadishu-2",
      },
    ]);

    expect(preview.rows).toEqual(
      expect.arrayContaining([
        {
          serviceType: "SFS",
          catalogItemId: "sfs",
          catalogItemName: "SFS_SATA",
          quantity: 10,
          amount: 20,
          alreadyLogged: true,
          regionId: "hoa-mog-2",
          regionName: "Hoa-Mogadishu-2",
        },
        {
          serviceType: "SFS",
          catalogItemId: "sfs",
          catalogItemName: "SFS_SATA",
          quantity: 20,
          amount: 40,
          alreadyLogged: false,
          regionId: "mog-hq3",
          regionName: "Mogadishu-region-hq3",
        },
      ]),
    );
  });

  it("maps raw EIP bandwidth Mbps values to real catalog tiers", () => {
    const catalog = [
      catalogItem("eip-bw-1", "EIP Bandwidth", "1 - 5 Mbps"),
      catalogItem("eip-bw-2", "EIP Bandwidth", "6 - 50 Mbps"),
      catalogItem("eip-bw-3", "EIP Bandwidth", "51 - 200 Mbps"),
    ];

    expect(
      buildUsageHintsForCompany(
        [
          {
            resources: [
              { serviceId: "vpc", resource: "bandwidth_size", used: 5 },
            ],
          },
        ],
        catalog,
      ),
    ).toContainEqual({
      serviceCategory: "EIP (bandwidth)",
      quantity: 5,
      pricing: "auto",
      suggestedCatalogItemId: "eip-bw-1",
    });

    expect(
      buildUsageHintsForCompany(
        [
          {
            resources: [
              { serviceId: "vpc", resource: "bandwidth_size", used: 6 },
            ],
          },
        ],
        catalog,
      ),
    ).toContainEqual({
      serviceCategory: "EIP (bandwidth)",
      quantity: 6,
      pricing: "auto",
      suggestedCatalogItemId: "eip-bw-2",
    });

    expect(
      buildUsageHintsForCompany(
        [
          {
            resources: [
              { serviceId: "vpc", resource: "bandwidth_size", used: 200 },
            ],
          },
        ],
        catalog,
      ),
    ).toContainEqual({
      serviceCategory: "EIP (bandwidth)",
      quantity: 200,
      pricing: "auto",
      suggestedCatalogItemId: "eip-bw-3",
    });
  });

  it("maps EIP bandwidth tiers when catalog stores Mbps items under EIP", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "vpc", resource: "bandwidth_size", used: 20 },
          ],
        },
      ],
      [
        catalogItem("eip-bw-1", "EIP", "1 - 5 Mbps"),
        catalogItem("eip-bw-2", "EIP", "6 - 50 Mbps"),
        catalogItem("eip-bw-3", "EIP", "51 - 200 Mbps"),
      ],
    );

    expect(hints).toContainEqual({
      serviceCategory: "EIP (bandwidth)",
      quantity: 20,
      pricing: "auto",
      suggestedCatalogItemId: "eip-bw-2",
    });
  });

  it("maps EIP bandwidth tiers by normalized Mbps item name across catalog category variants", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "vpc", resource: "bandwidth_size", used: 32 },
          ],
        },
      ],
      [
        catalogItem("eip-bw-1", "Network", "1-5 mbps"),
        catalogItem("eip-bw-2", "Network Bandwidth", "6-50 mbps"),
        catalogItem("eip-bw-3", "Network", "51-200 mbps"),
      ],
    );

    expect(hints).toContainEqual({
      serviceCategory: "EIP (bandwidth)",
      quantity: 32,
      pricing: "auto",
      suggestedCatalogItemId: "eip-bw-2",
    });
  });

  it("auto-prices CCE node flavors from ECS-CCE catalog SKUs and skips duplicate cluster manual note", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            {
              serviceId: "cce",
              resource: "hybrid.resource.type.cce.cluster",
              used: 8,
            },
          ],
          ecsFlavors: [
            { flavorName: "s2.xlarge.2", vcpus: 4, ramMb: 8192, count: 5 },
            { flavorName: "S2.2xlarge.2", vcpus: 8, ramMb: 16384, count: 17 },
            { flavorName: "S6_large.1", vcpus: 2, ramMb: 2048, count: 1 },
          ],
        },
      ],
      [
        catalogItem("cce-s2x", "ECS-CCE", "S2_xlarge.2"),
        catalogItem("cce-s22x", "ECS-CCE", "S2.2xlarge.2"),
        catalogItem("ecs-s6", "ECS", "S6_large.1"),
      ],
    );

    expect(hints.find((hint) => hint.serviceCategory === "ECS-CCE")).toEqual({
      serviceCategory: "ECS-CCE",
      quantity: 22,
      pricing: "auto",
      lineItems: [
        {
          label: "s2.xlarge.2",
          serviceCategory: "ECS-CCE",
          quantity: 5,
          pricing: "auto",
          suggestedCatalogItemId: "cce-s2x",
        },
        {
          label: "S2.2xlarge.2",
          serviceCategory: "ECS-CCE",
          quantity: 17,
          pricing: "auto",
          suggestedCatalogItemId: "cce-s22x",
        },
      ],
    });
    expect(hints.find((hint) => hint.serviceCategory === "ECS")).toEqual({
      serviceCategory: "ECS",
      quantity: 1,
      pricing: "auto",
      lineItems: [
        {
          label: "S6_large.1",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "ecs-s6",
        },
      ],
    });
  });

  it("turns ECS flavor breakdowns into matched auto lines and unmatched manual lines", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "ecs", resource: "instances", used: 6 },
            { serviceId: "waf", resource: "waf.instance", used: 1 },
          ],
          ecsFlavors: [
            { flavorName: "C6_12xlarge.4", vcpus: 48, ramMb: 196608, count: 2 },
            { flavorName: "s6_large.2", vcpus: 2, ramMb: 4096, count: 3 },
            {
              flavorName: "tenant-custom-aicc",
              vcpus: 8,
              ramMb: 32768,
              count: 1,
            },
          ],
        },
        {
          resources: [{ serviceId: "ecs", resource: "instances", used: 3 }],
          ecsFlavors: [
            { flavorName: "c6_12XLARGE.4", vcpus: 48, ramMb: 196608, count: 1 },
            {
              flavorName: "safariocs-custom",
              vcpus: 16,
              ramMb: 65536,
              count: 2,
            },
            { flavorName: "WAF Basic", vcpus: 0, ramMb: 0, count: 0 },
          ],
        },
      ],
      [
        catalogItem("ecs-c6", "ECS", "C6_12xlarge.4"),
        catalogItem("ecs-s6", "ECS", "S6_large.2"),
        catalogItem("waf-basic", "WAF", "WAF Basic"),
      ],
    );

    const ecsHint = hints.find((hint) => hint.serviceCategory === "ECS");
    const wafHint = hints.find((hint) => hint.serviceCategory === "WAF");

    expect(ecsHint).toEqual({
      serviceCategory: "ECS",
      quantity: 9,
      pricing: "manual",
      lineItems: [
        {
          label: "C6_12xlarge.4",
          quantity: 2,
          pricing: "auto",
          suggestedCatalogItemId: "ecs-c6",
        },
        {
          label: "s6_large.2",
          quantity: 3,
          pricing: "auto",
          suggestedCatalogItemId: "ecs-s6",
        },
        {
          label: "tenant-custom-aicc",
          quantity: 1,
          pricing: "manual",
          needsManualPricing: true,
        },
        {
          label: "c6_12XLARGE.4",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "ecs-c6",
        },
        {
          label: "safariocs-custom",
          quantity: 2,
          pricing: "manual",
          needsManualPricing: true,
        },
      ],
    });
    expect(wafHint).toEqual({
      serviceCategory: "WAF",
      quantity: 1,
      pricing: "manual",
    });
  });

  it("keeps aggregate ECS manual behavior when no flavor breakdown exists", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [{ serviceId: "ecs", resource: "instances", used: 4 }],
        },
      ],
      [catalogItem("ecs-c6", "ECS", "C6_12xlarge.4")],
    );

    expect(hints).toContainEqual({
      serviceCategory: "ECS",
      quantity: 4,
      pricing: "manual",
    });
    expect(
      hints.find((hint) => hint.serviceCategory === "ECS")?.lineItems,
    ).toBeUndefined();
  });

  it("turns EVS volume type breakdowns into per-GB auto lines and unmatched manual lines", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [{ serviceId: "evs", resource: "gigabytes", used: 48300 }],
          evsVolumeTypes: [
            { volumeType: "SSD", totalGb: 48200, count: 388 },
            { volumeType: "sata", totalGb: 100, count: 2 },
            { volumeType: "UltraHighIO", totalGb: 50, count: 1 },
          ],
        },
      ],
      [
        catalogItem("evs-ssd", "EVS", "SSD (Block Storage / NVMe)", "per GB"),
        catalogItem(
          "evs-sata",
          "EVS",
          "SATA (Object / Cold Storage)",
          "per GB",
        ),
        catalogItem("evs-ssd-hour", "EVS", "SSD Hourly", "per hour"),
      ],
    );

    expect(hints.find((hint) => hint.serviceCategory === "EVS")).toEqual({
      serviceCategory: "EVS",
      quantity: 48350,
      pricing: "manual",
      lineItems: [
        {
          label: "SSD",
          quantity: 48200,
          pricing: "auto",
          suggestedCatalogItemId: "evs-ssd",
        },
        {
          label: "sata",
          quantity: 100,
          pricing: "auto",
          suggestedCatalogItemId: "evs-sata",
        },
        {
          label: "UltraHighIO",
          quantity: 50,
          pricing: "manual",
          needsManualPricing: true,
        },
      ],
    });
  });

  it("keeps aggregate EVS manual behavior when no volume type breakdown exists", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [{ serviceId: "evs", resource: "gigabytes", used: 500 }],
        },
      ],
      [catalogItem("evs-ssd", "EVS", "SSD (Block Storage / NVMe)", "per GB")],
    );

    expect(hints).toContainEqual({
      serviceCategory: "EVS",
      quantity: 500,
      pricing: "manual",
    });
    expect(
      hints.find((hint) => hint.serviceCategory === "EVS")?.lineItems,
    ).toBeUndefined();
  });

  it("auto-prices WAF tier resources from ManageOne tier-specific keys", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "waf", resource: "waf.instance", used: 1 },
            { serviceId: "waf", resource: "waf.instance.100", used: 1 },
          ],
        },
        {
          resources: [
            { serviceId: "waf", resource: "waf.instance", used: 2 },
            { serviceId: "waf", resource: "waf.instance.500", used: 2 },
          ],
        },
      ],
      [
        catalogItem("waf-basic", "WAF", "Basic WAF", "flat/month", 15),
        catalogItem(
          "waf-enterprise",
          "WAF",
          "Enterprise WAF",
          "flat/month",
          150,
        ),
      ],
    );

    expect(hints.find((hint) => hint.serviceCategory === "WAF")).toEqual({
      serviceCategory: "WAF",
      quantity: 3,
      pricing: "auto",
      lineItems: [
        {
          label: "Basic WAF",
          quantity: 1,
          pricing: "auto",
          suggestedCatalogItemId: "waf-basic",
        },
        {
          label: "Enterprise WAF",
          quantity: 2,
          pricing: "auto",
          suggestedCatalogItemId: "waf-enterprise",
        },
      ],
    });
  });

  it("keeps WAF manual when one tenant reports conflicting tier keys", () => {
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "waf", resource: "waf.instance.100", used: 1 },
            { serviceId: "waf", resource: "waf.instance.500", used: 1 },
          ],
        },
      ],
      [
        catalogItem("waf-basic", "WAF", "Basic WAF", "flat/month", 15),
        catalogItem(
          "waf-enterprise",
          "WAF",
          "Enterprise WAF",
          "flat/month",
          150,
        ),
      ],
    );

    expect(hints.find((hint) => hint.serviceCategory === "WAF")).toEqual({
      serviceCategory: "WAF",
      quantity: 2,
      pricing: "manual",
      lineItems: [
        {
          label: "WAF tier conflict (100 and 500)",
          quantity: 2,
          pricing: "manual",
          needsManualPricing: true,
        },
      ],
    });
  });

  it("builds bulk auto-fill preview rows, manual notes, and duplicate flags", () => {
    const catalog = [
      catalogItem("eip-active", "EIP", "EIP - Active", "per IP", 3),
      catalogItem("elb", "ELB", "ELB - Shared", "per instance", 12),
      catalogItem("ecs-c6", "ECS", "C6_12xlarge.4", "per instance", 922),
      catalogItem(
        "evs-ssd",
        "EVS",
        "SSD (Block Storage / NVMe)",
        "per GB",
        0.072,
      ),
    ];
    const hints = buildUsageHintsForCompany(
      [
        {
          resources: [
            { serviceId: "vpc", resource: "publicIp", used: 2 },
            { serviceId: "vpc", resource: "loadbalancer", used: 1 },
          ],
          ecsFlavors: [
            { flavorName: "C6_12xlarge.4", vcpus: 48, ramMb: 196608, count: 2 },
            {
              flavorName: "tenant-custom",
              vcpus: 8,
              ramMb: 32768,
              count: 1,
            },
          ],
          evsVolumeTypes: [
            { volumeType: "SSD", totalGb: 100, count: 4 },
            { volumeType: "UltraHighIO", totalGb: 50, count: 1 },
          ],
        },
      ],
      catalog,
    );

    const preview = buildBulkUsagePreview(hints, catalog, [
      {
        serviceType: "EIP",
        catalogItemId: "eip-active" as Id<"serviceCatalog">,
      },
    ]);

    expect(preview.rows).toEqual(
      expect.arrayContaining([
        {
          serviceType: "EIP",
          catalogItemId: "eip-active",
          catalogItemName: "EIP - Active",
          quantity: 2,
          amount: 6,
          alreadyLogged: true,
        },
        {
          serviceType: "ELB",
          catalogItemId: "elb",
          catalogItemName: "ELB - Shared",
          quantity: 1,
          amount: 12,
          alreadyLogged: false,
        },
        {
          serviceType: "ECS",
          catalogItemId: "ecs-c6",
          catalogItemName: "C6_12xlarge.4",
          quantity: 2,
          amount: 1844,
          alreadyLogged: false,
        },
        {
          serviceType: "EVS",
          catalogItemId: "evs-ssd",
          catalogItemName: "SSD (Block Storage / NVMe)",
          quantity: 100,
          amount: 7.199999999999999,
          alreadyLogged: false,
        },
      ]),
    );
    expect(preview.needsManualEntry).toEqual(
      expect.arrayContaining([
        {
          serviceType: "ECS",
          label: "tenant-custom",
          reason:
            "ECS tenant-custom detected but has no catalog match - add manually.",
        },
        {
          serviceType: "EVS",
          label: "UltraHighIO",
          reason:
            "EVS UltraHighIO detected but has no catalog match - add manually.",
        },
      ]),
    );
  });
});
