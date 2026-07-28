import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel.d.ts";
import { buildUsageHintsForCompany } from "./manageOneTenants";

function catalogItem(id: string, serviceCategory: string, itemName: string) {
  return {
    _id: id as Id<"serviceCatalog">,
    serviceCategory,
    itemName,
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
            { serviceId: "evs", resource: "gigabytes", used: 500 },
            { serviceId: "sfs", resource: "gigabytes", used: 25 },
            { serviceId: "csbs", resource: "backup_capacity", used: 100 },
            { serviceId: "vpc", resource: "publicIp", used: 2 },
            { serviceId: "vpc", resource: "bandwidth_size", used: 20 },
            { serviceId: "waf", resource: "instance", used: 1 },
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
        catalogItem("sfs", "SFS", "SFS_SATA"),
        catalogItem("csbs", "CSBS", "General CSBS Duplication (backup)"),
        catalogItem(
          "vbs",
          "VBS",
          "General VBS Duplication (Volume Backup Service)",
        ),
        catalogItem("eip-active", "EIP", "EIP - Active"),
        catalogItem("eip-idle", "EIP", "EIP - Idle"),
        catalogItem("eip-bw-1", "EIP", "EIP Bandwidth - 1 - 5 Mbps"),
        catalogItem("eip-bw-2", "EIP", "EIP Bandwidth - 6 - 50 Mbps"),
        catalogItem("eip-bw-3", "EIP", "EIP Bandwidth - 51 - 200 Mbps"),
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
});
