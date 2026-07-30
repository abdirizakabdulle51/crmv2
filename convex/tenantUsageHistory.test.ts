import { describe, expect, it } from "vitest";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { aggregateTenantUsageHistoryRows } from "./tenantUsageHistory";

function historyRow(
  tenantName: string,
  syncedAt: number,
  metrics: Partial<
    Pick<
      Doc<"tenantUsageHistory">,
      | "ecsInstances"
      | "ecsCores"
      | "ecsRamGb"
      | "rdsInstances"
      | "cceClusters"
      | "evsGb"
      | "obsGb"
      | "sfsGb"
      | "publicIps"
      | "wafInstances"
    >
  >,
): Doc<"tenantUsageHistory"> {
  return {
    _id: `${tenantName}-${syncedAt}` as Id<"tenantUsageHistory">,
    _creationTime: syncedAt,
    linkedCompanyId: "company" as Id<"companies">,
    tenantName,
    ecsInstances: metrics.ecsInstances ?? 0,
    ecsCores: metrics.ecsCores ?? 0,
    ecsRamGb: metrics.ecsRamGb ?? 0,
    rdsInstances: metrics.rdsInstances ?? 0,
    cceClusters: metrics.cceClusters ?? 0,
    evsGb: metrics.evsGb ?? 0,
    obsGb: metrics.obsGb ?? 0,
    sfsGb: metrics.sfsGb ?? 0,
    publicIps: metrics.publicIps ?? 0,
    wafInstances: metrics.wafInstances ?? 0,
    syncedAt,
  };
}

describe("aggregateTenantUsageHistoryRows", () => {
  it("sums multiple tenant rows from the same sync window into one company-level point", () => {
    const rows = [
      historyRow("WAAFIPAY", 1785396120000, {
        ecsInstances: 1,
        ecsCores: 2,
        ecsRamGb: 4,
        evsGb: 20,
        publicIps: 1,
      }),
      historyRow("WAAFI", 1785396000000, {
        ecsInstances: 10,
        ecsCores: 40,
        ecsRamGb: 96,
        evsGb: 20556,
        publicIps: 3,
        wafInstances: 1,
      }),
    ];

    expect(aggregateTenantUsageHistoryRows(rows, 90)).toMatchObject([
      {
        tenantName: "WAAFI, WAAFIPAY",
        syncedAt: 1785396000000,
        ecsInstances: 11,
        ecsCores: 42,
        ecsRamGb: 100,
        evsGb: 20576,
        publicIps: 4,
        wafInstances: 1,
      },
    ]);
  });

  it("keeps separate sync runs separate and limits by aggregated points", () => {
    const rows = [
      historyRow("WAAFI", 1785396000000, { ecsInstances: 10 }),
      historyRow("WAAFIPAY", 1785396060000, { ecsInstances: 1 }),
      historyRow("WAAFI", 1785482400000, { ecsInstances: 12 }),
      historyRow("WAAFIPAY", 1785482460000, { ecsInstances: 2 }),
    ];

    expect(aggregateTenantUsageHistoryRows(rows, 1)).toMatchObject([
      {
        tenantName: "WAAFI, WAAFIPAY",
        syncedAt: 1785482400000,
        ecsInstances: 14,
      },
    ]);
  });
});
