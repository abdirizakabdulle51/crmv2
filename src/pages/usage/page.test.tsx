import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import UsagePage from "./page.tsx";

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
    consumption: {
      list: "consumption.list",
      remove: "consumption.remove",
      bulkCreateFromManageOne: "consumption.bulkCreateFromManageOne",
    },
    manageOneTenants: {
      getBulkUsagePreview: "manageOneTenants.getBulkUsagePreview",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  consumption: [] as Doc<"consumption">[],
  bulkPreview: undefined as
    | {
        rows: Array<{
          serviceType: string;
          catalogItemId: Id<"serviceCatalog">;
          catalogItemName: string;
          quantity: number;
          amount: number;
          alreadyLogged: boolean;
        }>;
        needsManualEntry: Array<{
          serviceType: string;
          label: string;
          reason: string;
        }>;
      }
    | undefined,
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (query: string) => {
    if (query === "companies.list") {
      return mocks.companies;
    }
    if (query === "consumption.list") {
      return mocks.consumption;
    }
    if (query === "manageOneTenants.getBulkUsagePreview") {
      return mocks.bulkPreview;
    }
    return undefined;
  },
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ isAdmin: true }),
}));

vi.mock("./_components/usage-entry-dialog.tsx", () => ({
  default: () => null,
}));

vi.mock("./_components/usage-import-dialog.tsx", () => ({
  default: () => null,
}));

vi.mock("@/components/confirm-delete-dialog.tsx", () => ({
  default: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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

function usage(
  id: string,
  companyId: Id<"companies">,
  month: string,
): Doc<"consumption"> {
  return {
    _id: id as Id<"consumption">,
    _creationTime: 1,
    companyId,
    month,
    serviceType: "EIP",
    amount: 10,
  };
}

describe("UsagePage company filter indicators", () => {
  it("shows entry counts beside companies with usage for the selected month", async () => {
    const user = userEvent.setup();
    const hormuud = company("company-1", "Hormuud");
    const waafi = company("company-2", "WAAFI");
    const empty = company("company-3", "No Data Co");
    mocks.companies = [hormuud, waafi, empty];
    mocks.consumption = [
      usage("usage-1", hormuud._id, "2026-07"),
      usage("usage-2", hormuud._id, "2026-07"),
      usage("usage-3", waafi._id, "2026-06"),
    ];

    render(<UsagePage />);

    const [companySelect, monthSelect] = screen.getAllByRole("combobox");
    await user.click(monthSelect);
    await user.click(screen.getByRole("option", { name: "2026-07" }));
    await user.click(companySelect);

    const hormuudOption = screen.getByRole("option", { name: /Hormuud/i });
    const waafiOption = screen.getByRole("option", { name: /^WAAFI$/i });
    const emptyOption = screen.getByRole("option", { name: /^No Data Co$/i });

    expect(within(hormuudOption).getByText("✓ 2 entries")).toBeInTheDocument();
    expect(within(waafiOption).queryByText(/entries/)).not.toBeInTheDocument();
    expect(within(emptyOption).queryByText(/entries/)).not.toBeInTheDocument();
  });

  it("keeps the bulk preview actions reachable with a 15-row ManageOne preview", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.consumption = [];
    mocks.bulkPreview = {
      rows: Array.from({ length: 15 }, (_, index) => ({
        serviceType: index < 8 ? "ECS" : "EVS",
        catalogItemId: `catalog-${index}` as Id<"serviceCatalog">,
        catalogItemName: `Catalog Item ${index + 1}`,
        quantity: index + 1,
        amount: (index + 1) * 10,
        alreadyLogged: false,
      })),
      needsManualEntry: [
        {
          serviceType: "ECS",
          label: "custom-flavor",
          reason:
            "ECS custom-flavor detected but has no catalog match - add manually.",
        },
      ],
    };

    render(<UsagePage />);

    const [companySelect] = screen.getAllByRole("combobox");
    await user.click(companySelect);
    await user.click(screen.getByRole("option", { name: "AICC" }));
    await user.click(
      screen.getByRole("button", { name: /Auto-fill from ManageOne/i }),
    );

    const dialog = screen
      .getByRole("dialog", { name: "Auto-fill from ManageOne" })
      .closest("[data-slot='dialog-content']");
    const rowList = screen.getByTestId("bulk-preview-line-items");

    expect(dialog).toHaveClass("max-h-[85vh]", "flex", "overflow-hidden");
    expect(rowList).toHaveClass("overflow-y-auto", "flex-1", "min-h-0");
    expect(screen.getAllByText(/Catalog Item \d+/)).toHaveLength(15);
    expect(screen.getByText(/custom-flavor detected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create 15 Entries" }),
    ).toBeInTheDocument();
  });
});
