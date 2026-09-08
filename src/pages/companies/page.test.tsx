import { describe, expect, it } from "vitest";
import { matchesOwnerFilter } from "./owner-filter";

describe("company owner filtering", () => {
  it("includes only unassigned rows for the unassigned filter", () => {
    expect(matchesOwnerFilter(undefined, "unassigned")).toBe(true);
    expect(matchesOwnerFilter("user-1", "unassigned")).toBe(false);
  });

  it("preserves mine and named-owner filtering", () => {
    expect(matchesOwnerFilter("user-1", "mine", "user-1")).toBe(true);
    expect(matchesOwnerFilter("user-2", "mine", "user-1")).toBe(false);
    expect(matchesOwnerFilter("user-1", "user-1")).toBe(true);
    expect(matchesOwnerFilter("user-2", "user-1")).toBe(false);
  });
});
