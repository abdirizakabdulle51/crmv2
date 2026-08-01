import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderUsagePage() {
  return render(
    <MemoryRouter initialEntries={["/usage"]}>
      <Routes>
        <Route
          path="/usage"
          element={
            <>
              <UsagePage />
              <LocationProbe />
            </>
          }
        />
        <Route path="/usage/auto-fill" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

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
  serviceType = "EIP",
  amount = 10,
): Doc<"consumption"> {
  return {
    _id: id as Id<"consumption">,
    _creationTime: 1,
    companyId,
    month,
    serviceType,
    amount,
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

    renderUsagePage();

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

  it("navigates to the page-based Auto-fill from ManageOne flow", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.consumption = [];

    renderUsagePage();

    const [companySelect] = screen.getAllByRole("combobox");
    await user.click(companySelect);
    await user.click(screen.getByRole("option", { name: "AICC" }));
    await user.click(
      screen.getByRole("button", { name: /Auto-fill from ManageOne/i }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/usage/auto-fill?company=company-1&month=",
    );
  });
});

describe("UsagePage pagination", () => {
  it("syncs the month input to the month filter used by summary totals", () => {
    const aicc = company("company-1", "AICC");
    const waafi = company("company-2", "WAAFI");
    mocks.companies = [aicc, waafi];
    mocks.consumption = [
      usage("july-1", aicc._id, "2026-07", "ECS", 100),
      usage("july-2", waafi._id, "2026-07", "EVS", 200),
      usage("august-1", aicc._id, "2026-08", "EIP", 300),
    ];

    const { container } = renderUsagePage();

    expect(screen.getByText("$600.00")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    const monthInput = container.querySelector('input[type="month"]');
    expect(monthInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(monthInput as HTMLInputElement, {
      target: { value: "2026-07" },
    });

    expect(screen.getByText("$300.00")).toBeInTheDocument();
    expect(screen.getAllByText("Showing 1-2 of 2 entries")).toHaveLength(2);
    expect(screen.queryByText("$600.00")).not.toBeInTheDocument();
  });

  it("changes page size and navigates usage entry pages", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.consumption = Array.from({ length: 60 }, (_, index) =>
      usage(
        `usage-${index + 1}`,
        aicc._id,
        "2026-07",
        `Service ${String(index + 1).padStart(2, "0")}`,
        index === 0 ? 718.8476 : 10,
      ),
    );

    renderUsagePage();

    expect(screen.getAllByText("Showing 1-50 of 60 entries")).toHaveLength(2);
    expect(screen.getByText("Service 01")).toBeInTheDocument();
    expect(screen.getByText("$718.85")).toBeInTheDocument();
    expect(screen.queryByText("$718.848")).not.toBeInTheDocument();
    expect(screen.queryByText("Service 51")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Usage entries per page" }),
    );
    await user.click(screen.getByRole("option", { name: "25 per page" }));

    expect(screen.getAllByText("Showing 1-25 of 60 entries")).toHaveLength(2);
    expect(screen.queryByText("Service 26")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getAllByText("Showing 26-50 of 60 entries")).toHaveLength(2);
    expect(screen.queryByText("Service 01")).not.toBeInTheDocument();
    expect(screen.getByText("Service 26")).toBeInTheDocument();
  });

  it("resets to page 1 when company or month filters change", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    const waafi = company("company-2", "WAAFI");
    mocks.companies = [aicc, waafi];
    mocks.consumption = [
      ...Array.from({ length: 55 }, (_, index) =>
        usage(
          `aicc-${index + 1}`,
          aicc._id,
          "2026-07",
          `AICC Service ${String(index + 1).padStart(2, "0")}`,
        ),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        usage(
          `waafi-${index + 1}`,
          waafi._id,
          "2026-07",
          `WAAFI Service ${index + 1}`,
        ),
      ),
      usage("aicc-old", aicc._id, "2026-06", "AICC Old Service"),
    ];

    renderUsagePage();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByText("Showing 51-59 of 59 entries")).toHaveLength(2);

    const [companySelect, monthSelect] = screen.getAllByRole("combobox");
    await user.click(companySelect);
    await user.click(screen.getByRole("option", { name: /WAAFI/i }));

    expect(screen.getAllByText("Showing 1-3 of 3 entries")).toHaveLength(2);
    expect(screen.getByText("WAAFI Service 1")).toBeInTheDocument();

    await user.click(companySelect);
    await user.click(screen.getByRole("option", { name: "All Companies" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByText("Showing 51-59 of 59 entries")).toHaveLength(2);

    await user.click(monthSelect);
    await user.click(screen.getByRole("option", { name: "2026-06" }));

    expect(screen.getAllByText("Showing 1-1 of 1 entries")).toHaveLength(2);
    expect(screen.getByText("AICC Old Service")).toBeInTheDocument();
  });
});
