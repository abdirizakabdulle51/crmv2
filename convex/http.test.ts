import { describe, expect, it } from "vitest";
import { normalizeCloudCapacityRegion, normalizeTenant } from "./http";

describe("normalizeTenant", () => {
  it("preserves EIP bandwidth tier breakdowns from ManageOne sync payloads", () => {
    expect(
      normalizeTenant({
        vdcId: "vdc-waafi",
        name: "WAAFI",
        eipBandwidths: [
          { tierName: "1 - 5 Mbps", count: 3, totalMbps: 9 },
          { tierName: "6 - 50 Mbps", count: 7, totalMbps: 140 },
        ],
      }),
    ).toEqual({
      vdcId: "vdc-waafi",
      name: "WAAFI",
      eipBandwidths: [
        { tierName: "1 - 5 Mbps", count: 3, totalMbps: 9 },
        { tierName: "6 - 50 Mbps", count: 7, totalMbps: 140 },
      ],
    });
  });

  it("preserves VPN Gateway breakdowns from ManageOne sync payloads", () => {
    expect(
      normalizeTenant({
        vdcId: "vdc-waafi",
        name: "WAAFI",
        vpnGateways: {
          count: 2,
          resourceTypeName: "CLOUD_VPN_SERVICE",
          items: [
            {
              id: "vpn-1",
              name: "vpngw-cef6",
              resourceTypeName: "CLOUD_VPN_SERVICE",
            },
          ],
        },
      }),
    ).toEqual({
      vdcId: "vdc-waafi",
      name: "WAAFI",
      vpnGateways: {
        count: 2,
        resourceTypeName: "CLOUD_VPN_SERVICE",
        items: [
          {
            id: "vpn-1",
            name: "vpngw-cef6",
            resourceTypeName: "CLOUD_VPN_SERVICE",
          },
        ],
      },
    });
  });

  it("preserves NAT Gateway breakdowns from ManageOne sync payloads", () => {
    expect(
      normalizeTenant({
        vdcId: "vdc-credit-score",
        name: "HS-Credit-Score-Program",
        natGateways: {
          count: 1,
          resourceTypeName: "CLOUD_NAT_GATEWAY",
          items: [
            {
              id: "nat-1",
              name: "NAT_Credit_Score",
              resourceTypeName: "CLOUD_NAT_GATEWAY",
              spec: "1",
              catalogItemName: "Small (150 Mbps)",
              regionId: "hoa-mogadishu-2",
              regionName: "Hoa-Mogadishu-2",
            },
          ],
        },
      }),
    ).toEqual({
      vdcId: "vdc-credit-score",
      name: "HS-Credit-Score-Program",
      natGateways: {
        count: 1,
        resourceTypeName: "CLOUD_NAT_GATEWAY",
        items: [
          {
            id: "nat-1",
            name: "NAT_Credit_Score",
            resourceTypeName: "CLOUD_NAT_GATEWAY",
            spec: "1",
            catalogItemName: "Small (150 Mbps)",
            regionId: "hoa-mogadishu-2",
            regionName: "Hoa-Mogadishu-2",
          },
        ],
      },
    });
  });

  it("preserves EVS disk managed fee and Cloud Bastion Host breakdowns", () => {
    expect(
      normalizeTenant({
        vdcId: "vdc-waafi",
        name: "WAAFI",
        evsDiskManagedFees: {
          count: 440,
          resourceTypeName: "CLOUD_EVS_INSTANCE",
        },
        cloudBastionHosts: {
          count: 1,
          resourceTypeName: "CLOUD_CBH",
          items: [
            {
              id: "cbh-1",
              name: "bastion-basic",
              resourceTypeName: "CLOUD_CBH",
            },
          ],
        },
      }),
    ).toEqual({
      vdcId: "vdc-waafi",
      name: "WAAFI",
      evsDiskManagedFees: {
        count: 440,
        resourceTypeName: "CLOUD_EVS_INSTANCE",
      },
      cloudBastionHosts: {
        count: 1,
        resourceTypeName: "CLOUD_CBH",
        items: [
          {
            id: "cbh-1",
            name: "bastion-basic",
            resourceTypeName: "CLOUD_CBH",
          },
        ],
      },
    });
  });

  it("preserves OBS bucket breakdowns from ManageOne sync payloads", () => {
    expect(
      normalizeTenant({
        vdcId: "vdc-mizan",
        name: "Mizan-Geomatics",
        obsBuckets: [
          {
            bucketName: "mizan-main",
            totalGb: 1225.282,
            usedMb: 1254688.125,
            storageClass: "Standard",
            catalogItemName: "Fusion bucket",
            regionId: "hoa-mogadishu-2",
            regionName: "Hoa-Mogadishu-2",
          },
        ],
      }),
    ).toEqual({
      vdcId: "vdc-mizan",
      name: "Mizan-Geomatics",
      obsBuckets: [
        {
          bucketName: "mizan-main",
          totalGb: 1225.282,
          usedMb: 1254688.125,
          storageClass: "Standard",
          catalogItemName: "Fusion bucket",
          regionId: "hoa-mogadishu-2",
          regionName: "Hoa-Mogadishu-2",
        },
      ],
    });
  });

  it("preserves resource-space regions on ECS and EVS breakdown items", () => {
    expect(
      normalizeTenant({
        vdcId: "vdc-ncsc",
        name: "NationalCivilServiceCommission",
        regionName: "Mogadishu-region-hq3",
        ecsFlavors: [
          {
            flavorName: "S6_large.1",
            vcpus: 2,
            ramMb: 4096,
            count: 1,
            regionId: "hoa-mogadishu-2",
            regionName: "Hoa-Mogadishu-2",
          },
        ],
        evsVolumeTypes: [
          {
            volumeType: "SSD",
            totalGb: 9984,
            count: 9,
            regionId: "htgcloud-region-02",
            regionName: "Mogadishu-region-hq3",
          },
        ],
        evsDiskManagedFees: {
          count: 12,
          resourceTypeName: "CLOUD_EVS_INSTANCE",
          items: [
            {
              count: 3,
              resourceTypeName: "CLOUD_EVS_INSTANCE",
              regionId: "hoa-mogadishu-2",
              regionName: "Hoa-Mogadishu-2",
            },
            {
              count: 9,
              resourceTypeName: "CLOUD_EVS_INSTANCE",
              regionId: "htgcloud-region-02",
              regionName: "Mogadishu-region-hq3",
            },
          ],
        },
      }),
    ).toMatchObject({
      ecsFlavors: [
        {
          regionId: "hoa-mogadishu-2",
          regionName: "Hoa-Mogadishu-2",
        },
      ],
      evsVolumeTypes: [
        {
          regionId: "htgcloud-region-02",
          regionName: "Mogadishu-region-hq3",
        },
      ],
      evsDiskManagedFees: {
        items: [
          { regionName: "Hoa-Mogadishu-2" },
          { regionName: "Mogadishu-region-hq3" },
        ],
      },
    });
  });
});

describe("normalizeCloudCapacityRegion", () => {
  it("preserves storage pool capacity breakdowns from Cloud Capacity sync payloads", () => {
    expect(
      normalizeCloudCapacityRegion({
        regionId: "region-hq3",
        regionName: "Mogadishu-region-hq3",
        cpuUsed: 10,
        cpuTotal: 100,
        memoryUsedGb: 20,
        memoryTotalGb: 200,
        storageUsedGb: 160000,
        storageTotalGb: 1600000,
        storagePools: [
          {
            volumeType: "SSD",
            usedGb: 10000,
            totalGb: 500000,
            freeGb: 490000,
            usedRatio: 2,
          },
          {
            volumeType: "SATA",
            usedGb: 512,
            totalGb: 200000,
            freeGb: 199488,
            usedRatio: 0.3,
            oversubscriptionAllocatedRatio: 10,
          },
        ],
        ecsFlavorAvailabilityStatus: "verified",
        ecsFlavorAvailabilityMessage: "ManageOne returned 74 ECS flavor(s).",
        ecsFlavorAvailability: [
          {
            name: "C6_2xlarge.4",
            vcpus: 8,
            ramGb: 32,
            cpuVendor: "Intel",
            available: true,
            matchedName: "C6_2xlarge.4",
            availabilityZones: ["AZ_Mogadishu_2a"],
            estimatedFitCount: 20,
            status: "available",
          },
        ],
      }),
    ).toMatchObject({
      regionId: "region-hq3",
      storagePools: [
        {
          volumeType: "SSD",
          usedGb: 10000,
          totalGb: 500000,
          freeGb: 490000,
          usedRatio: 2,
        },
        {
          volumeType: "SATA",
          oversubscriptionAllocatedRatio: 10,
        },
      ],
      ecsFlavorAvailabilityStatus: "verified",
      ecsFlavorAvailability: [
        {
          name: "C6_2xlarge.4",
          vcpus: 8,
          ramGb: 32,
          available: true,
          estimatedFitCount: 20,
          status: "available",
        },
      ],
    });
  });
});
