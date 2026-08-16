import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import ManageOneTenantsPage from "./page.tsx";

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
    countries: { list: "countries.list" },
    manageOneTenants: {
      createCompanyFromTenant: "manageOneTenants.createCompanyFromTenant",
      linkToCompany: "manageOneTenants.linkToCompany",
      listWithSuggestions: "manageOneTenants.listWithSuggestions",
      reassignCompany: "manageOneTenants.reassignCompany",
      unlinkFromCompany: "manageOneTenants.unlinkFromCompany",
    },
    sectors: { list: "sectors.list" },
    users: { listAll: "users.listAll" },
  },
}));

const mocks = vi.hoisted(() => ({
  tenants: [] as Array<
    Doc<"manageOneTenants"> & {
      linkedCompanyName?: string | null;
      suggestedCompanyId?: Id<"companies"> | null;
      suggestedCompanyName?: string | null;
    }
  >,
  companies: [] as Doc<"companies">[],
  countries: [] as Doc<"countries">[],
  sectors: [] as Doc<"sectors">[],
  users: [] as Doc<"users">[],
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (query: string) => {
    if (query === "manageOneTenants.listWithSuggestions") return mocks.tenants;
    if (query === "companies.list") return mocks.companies;
    if (query === "countries.list") return mocks.countries;
    if (query === "sectors.list") return mocks.sectors;
    if (query === "users.listAll") return mocks.users;
    return undefined;
  },
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ isAdmin: true }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function tenant(index: number): Doc<"manageOneTenants"> {
  return {
    _id: `tenant-${index}` as Id<"manageOneTenants">,
    _creationTime: index,
    name: `Tenant ${String(index).padStart(3, "0")}`,
    vdcId: `vdc-${index}`,
    level: 1,
    ecsUsed: index,
    evsUsed: index * 10,
    projectCount: 1,
    lastSyncedAt: 1_800_000_000_000 + index,
  };
}

function seedTenants() {
  mocks.tenants = Array.from({ length: 66 }, (_, index) => tenant(index + 1));
  mocks.companies = [];
  mocks.countries = [];
  mocks.sectors = [];
  mocks.users = [];
}

describe("ManageOneTenantsPage pagination", () => {
  it("changes page size and navigates tenant pages", async () => {
    const user = userEvent.setup();
    seedTenants();

    render(<ManageOneTenantsPage />);

    expect(screen.getAllByText("Showing 1-50 of 66")).toHaveLength(2);
    expect(screen.getByText("Tenant 001")).toBeInTheDocument();
    expect(screen.queryByText("Tenant 051")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getAllByText("Showing 51-66 of 66")).toHaveLength(2);
    expect(screen.queryByText("Tenant 001")).not.toBeInTheDocument();
    expect(screen.getByText("Tenant 051")).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "ManageOne tenants per page" }),
    );
    await user.click(screen.getByRole("option", { name: "25 per page" }));

    expect(screen.getAllByText("Showing 1-25 of 66")).toHaveLength(2);
    expect(screen.getByText("Tenant 001")).toBeInTheDocument();
    expect(screen.queryByText("Tenant 026")).not.toBeInTheDocument();
  });
});
