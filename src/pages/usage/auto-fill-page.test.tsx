import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import UsageAutoFillPage from "./auto-fill-page.tsx";

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
      bulkCreateFromManageOne: "consumption.bulkCreateFromManageOne",
    },
    manageOneTenants: {
      getBulkUsagePreview: "manageOneTenants.getBulkUsagePreview",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  bulkCreate: vi.fn(),
  bulkPreview: undefined as
    | {
        rows: Array<{
          serviceType: string;
          catalogItemId: Id<"serviceCatalog">;
          catalogItemName: string;
          quantity: number;
          amount: number;
          alreadyLogged: boolean;
          regionId?: string;
          regionName?: string;
          dataCenterName?: string;
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
  useMutation: () => mocks.bulkCreate,
  useQuery: (query: string) => {
    if (query === "companies.list") {
      return mocks.companies;
    }
    if (query === "manageOneTenants.getBulkUsagePreview") {
      return mocks.bulkPreview;
    }
    return undefined;
  },
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

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderAutoFillPage() {
  return render(
    <MemoryRouter
      initialEntries={["/usage/auto-fill?company=company-1&month=2026-07"]}
    >
      <Routes>
        <Route
          path="/usage/auto-fill"
          element={
            <>
              <UsageAutoFillPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/usage"
          element={
            <>
              <div>Usage Tracking</div>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UsageAutoFillPage", () => {
  it("shows a full-page 15-row ManageOne preview without a dialog container", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
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

    renderAutoFillPage();

    const rowList = screen.getByTestId("bulk-preview-line-items");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rowList).not.toHaveClass("overflow-y-auto", "flex-1", "min-h-0");
    expect(screen.getAllByText(/Catalog Item \d+/)).toHaveLength(15);
    expect(screen.getByText(/custom-flavor detected/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Cancel" })[0],
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Create 15 Entries" })[0],
    ).toBeInTheDocument();
  });

  it("bulk-creates checked rows and returns to Usage with company and month filters", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.bulkCreate.mockResolvedValue({ inserted: 2 });
    mocks.bulkPreview = {
      rows: [
        {
          serviceType: "EIP",
          catalogItemId: "catalog-1" as Id<"serviceCatalog">,
          catalogItemName: "EIP - Active",
          quantity: 2,
          amount: 718.8476,
          alreadyLogged: false,
          regionId: "hoa-mog-2",
          regionName: "Hoa-Mogadishu-2",
          dataCenterName: "Mogadishu DC 2",
        },
        {
          serviceType: "VPN",
          catalogItemId: "catalog-2" as Id<"serviceCatalog">,
          catalogItemName: "VPN",
          quantity: 1,
          amount: 20,
          alreadyLogged: false,
        },
        {
          serviceType: "ELB",
          catalogItemId: "catalog-3" as Id<"serviceCatalog">,
          catalogItemName: "ELB",
          quantity: 1,
          amount: 15,
          alreadyLogged: true,
        },
      ],
      needsManualEntry: [],
    };

    renderAutoFillPage();

    await user.click(
      screen.getAllByRole("button", { name: "Create 2 Entries" })[0],
    );

    await waitFor(() => {
      expect(mocks.bulkCreate).toHaveBeenCalledWith({
        companyId: "company-1",
        month: "2026-07",
        rows: [
          {
            serviceType: "EIP",
            catalogItemId: "catalog-1",
            quantity: 2,
            regionId: "hoa-mog-2",
            regionName: "Hoa-Mogadishu-2",
            dataCenterName: "Mogadishu DC 2",
          },
          {
            serviceType: "VPN",
            catalogItemId: "catalog-2",
            quantity: 1,
            regionId: undefined,
            regionName: undefined,
            dataCenterName: undefined,
          },
        ],
      });
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/usage?company=company-1&month=2026-07",
    );
  });

  it("formats preview row amounts to exactly two decimals", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.bulkPreview = {
      rows: [
        {
          serviceType: "EIP",
          catalogItemId: "catalog-1" as Id<"serviceCatalog">,
          catalogItemName: "EIP - Active",
          quantity: 2,
          amount: 718.8476,
          alreadyLogged: false,
        },
      ],
      needsManualEntry: [],
    };

    renderAutoFillPage();

    expect(screen.getByText("$718.85")).toBeInTheDocument();
    expect(screen.queryByText("$718.848")).not.toBeInTheDocument();
  });
});
