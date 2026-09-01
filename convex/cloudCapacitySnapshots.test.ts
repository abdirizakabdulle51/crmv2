import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const snapshotsSource = readFileSync(
  new URL("./cloudCapacitySnapshots.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/pages/cloud-health/region-page.tsx", import.meta.url),
  "utf8",
);

describe("Cloud Capacity region history", () => {
  it("uses a bounded chart-sized history window", () => {
    expect(pageSource).toContain(
      "{ regionId: decodedRegionId, limit: 90 }",
    );
    expect(snapshotsSource).toContain(
      "const MAX_REGION_HISTORY_POINTS = 90;",
    );
    expect(snapshotsSource).toContain("MAX_REGION_HISTORY_POINTS,");
    expect(snapshotsSource).not.toContain("5_000");
    expect(snapshotsSource).not.toContain("10_000");
  });

  it("returns only fields consumed by the capacity trend", () => {
    const projection = snapshotsSource.slice(
      snapshotsSource.indexOf(".map((snapshot) => ({"),
      snapshotsSource.indexOf("      }));", snapshotsSource.indexOf(".map((snapshot) => ({")) + 9,
    );

    expect(projection).toContain("snapshot.cpuUsed");
    expect(projection).toContain("snapshot.cpuTotal");
    expect(projection).toContain("snapshot.memoryUsedGb");
    expect(projection).toContain("snapshot.memoryTotalGb");
    expect(projection).toContain("snapshot.storageUsedGb");
    expect(projection).toContain("snapshot.storageTotalGb");
    expect(projection).toContain("snapshot.snapshotAt");
    expect(projection).not.toContain("storagePools");
    expect(projection).not.toContain("ecsFlavorAvailability");
    expect(projection).not.toContain("availabilityMessage");
  });

  it("keeps chart percentage inputs and capacity ingestion/retention paths", () => {
    expect(pageSource).toContain(
      "cpu: percentage(snapshot.cpuUsed, snapshot.cpuTotal)",
    );
    expect(pageSource).toContain(
      "memory: percentage(snapshot.memoryUsedGb, snapshot.memoryTotalGb)",
    );
    expect(pageSource).toContain(
      "storage: percentage(snapshot.storageUsedGb, snapshot.storageTotalGb)",
    );
    expect(snapshotsSource).toContain("export const append = internalMutation");
    expect(snapshotsSource).toContain(
      "const DEFAULT_CAPACITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;",
    );
    expect(snapshotsSource).toContain("export const dryRunOldCapacitySnapshotsPage");
  });
});
