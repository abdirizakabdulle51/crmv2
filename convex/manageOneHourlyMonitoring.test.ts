import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const monitoringSource = readFileSync(
  new URL("./manageOneHourlyMonitoring.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/pages/manageone-hourly/page.tsx", import.meta.url),
  "utf8",
);

describe("Hourly Monitoring initial latest query", () => {
  it("uses the existing bounded default window from the initial page", () => {
    expect(pageSource).toContain("api.manageOneHourlyMonitoring.latest");
    expect(pageSource).toContain("canView ? { limit: 100 } : \"skip\"");
    expect(monitoringSource).toContain("const MAX_LATEST_ROWS = 100;");
    expect(monitoringSource).toContain("MAX_LATEST_ROWS,\n    );");
    expect(monitoringSource).not.toContain("), 500);");
  });

  it("keeps raw metrics out of the public initial snapshot shape", () => {
    expect(monitoringSource).toContain(
      "const { rawMetrics: _rawMetrics, ...snapshot } = row;",
    );
    expect(pageSource).not.toContain("row.rawMetrics");
    expect(pageSource).toContain("row.ecsInstances");
    expect(pageSource).toContain("row.regionId");
    expect(pageSource).toContain("row.tenantName");
  });

  it("leaves ingestion and 30-day retention behavior unchanged", () => {
    expect(monitoringSource).toContain(
      "const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;",
    );
    expect(monitoringSource).toContain(
      "const MAX_RETENTION_DELETE_PER_SYNC = 200;",
    );
    expect(monitoringSource).toContain("export const bulkUpsert = internalMutation");
    expect(monitoringSource).toContain("await pruneOldSnapshots(");
    expect(monitoringSource).toContain("await ctx.db.insert(\"manageOneHourlySnapshots\"");
  });
});
