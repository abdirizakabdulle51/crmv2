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
});
