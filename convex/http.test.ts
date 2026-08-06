import { describe, expect, it } from "vitest";
import { normalizeTenant } from "./http";

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
