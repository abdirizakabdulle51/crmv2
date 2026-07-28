import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import RecommendationsPage from "./page.tsx";
import type { Recommendation } from "./_lib/recommendation-engine.ts";

Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
  value: vi.fn(() => false),
});
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
});

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    companies: { list: "companies.list" },
    consumption: { list: "consumption.list" },
    sectors: { list: "sectors.list" },
    serviceCatalog: { list: "serviceCatalog.list" },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  consumption: [] as Doc<"consumption">[],
  sectors: [] as Doc<"sectors">[],
  catalog: [] as Doc<"serviceCatalog">[],
  recommendations: [] as Recommendation[],
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "companies.list") return mocks.companies;
    if (query === "consumption.list") return mocks.consumption;
    if (query === "sectors.list") return mocks.sectors;
    if (query === "serviceCatalog.list") return mocks.catalog;
    return undefined;
  },
}));

vi.mock("./_lib/recommendation-engine.ts", () => ({
  generateRecommendations: () => mocks.recommendations,
}));

function company(id: string, name: string): Doc<"companies"> {
  return {
    _id: id as Id<"companies">,
    _creationTime: 1,
    name,
    sectorId: "sector-1" as Id<"sectors">,
    countryId: "country-1" as Id<"countries">,
    accountManagerId: "user-1" as Id<"users">,
    contractStatus: "active",
  };
}

function recommendation(index: number, priority: Recommendation["priority"]) {
  return {
    companyId: `company-${index}` as Id<"companies">,
    companyName: `Company ${String(index).padStart(2, "0")}`,
    rule: index % 2 === 0 ? "backup" : "waf",
    triggerReason: `Recommendation ${index}`,
    recommendedService: "Managed service",
    estimatedValue: "$10.00/mo",
    priority,
  };
}

function seedRecommendations() {
  mocks.companies = Array.from({ length: 60 }, (_, index) =>
    company(
      `company-${index + 1}`,
      `Company ${String(index + 1).padStart(2, "0")}`,
    ),
  );
  mocks.consumption = [];
  mocks.sectors = [];
  mocks.catalog = [];
  mocks.recommendations = [
    ...Array.from({ length: 55 }, (_, index) =>
      recommendation(index + 1, "medium"),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      recommendation(index + 56, "low"),
    ),
  ];
}

describe("RecommendationsPage pagination", () => {
  it("changes page size and navigates recommendation pages", async () => {
    const user = userEvent.setup();
    seedRecommendations();

    render(<RecommendationsPage />);

    expect(screen.getAllByText("Showing 1-50 of 60")).toHaveLength(2);
    expect(screen.getByText("Company 01")).toBeInTheDocument();
    expect(screen.queryByText("Company 51")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Recommendations per page" }),
    );
    await user.click(screen.getByRole("option", { name: "25 per page" }));

    expect(screen.getAllByText("Showing 1-25 of 60")).toHaveLength(2);
    expect(screen.queryByText("Company 26")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Next" })[0]);

    expect(screen.getAllByText("Showing 26-50 of 60")).toHaveLength(2);
    expect(screen.queryByText("Company 01")).not.toBeInTheDocument();
    expect(screen.getByText("Company 26")).toBeInTheDocument();
  });

  it("resets to page 1 when an existing filter changes", async () => {
    const user = userEvent.setup();
    seedRecommendations();

    render(<RecommendationsPage />);

    await user.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect(screen.getAllByText("Showing 51-60 of 60")).toHaveLength(2);

    await user.click(screen.getAllByRole("combobox")[2]);
    await user.click(screen.getByRole("option", { name: "Low" }));

    expect(screen.getAllByText("Showing 1-5 of 5")).toHaveLength(2);
    expect(screen.getByText("Company 56")).toBeInTheDocument();
  });
});
