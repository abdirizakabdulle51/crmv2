import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import InvoicesPage from "./page.tsx";

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
    invoices: { list: "invoices.list" },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  invoices: [] as Doc<"invoices">[],
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "companies.list") return mocks.companies;
    if (query === "invoices.list") return mocks.invoices;
    return undefined;
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

function invoice(
  id: string,
  overrides: Partial<Doc<"invoices">> = {},
): Doc<"invoices"> {
  return {
    _id: id as Id<"invoices">,
    _creationTime: 1,
    companyId: "company-1" as Id<"companies">,
    createdBy: "user-1" as Id<"users">,
    invoiceNumber: "INV-2026-00001",
    status: "issued",
    issueDate: Date.UTC(2026, 7, 1),
    dueDate: Date.UTC(2026, 7, 31),
    companyName: "Hormuud",
    lineItems: [
      {
        catalogItemId: "catalog-1" as Id<"serviceCatalog">,
        itemName: "Cloud Server",
        serviceCategory: "Compute",
        billingUnit: "month",
        quantity: 1,
        monthlyUnitPrice: 1200,
        monthlyTotal: 1200,
        yearlyTotal: 14400,
      },
    ],
    subtotal: 1200,
    monthlyTotal: 1200,
    yearlyTotal: 14400,
    grandTotal: 1200,
    amountPaid: 0,
    balanceDue: 1200,
    createdAt: Date.UTC(2026, 7, 1),
    updatedAt: Date.UTC(2026, 7, 1),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderInvoicesPage() {
  return render(
    <MemoryRouter initialEntries={["/invoices"]}>
      <Routes>
        <Route
          path="/invoices"
          element={
            <>
              <InvoicesPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function chooseSelectOption(label: RegExp | string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("InvoicesPage", () => {
  beforeEach(() => {
    mocks.companies = [
      company("company-1", "Hormuud"),
      company("company-2", "Telesom"),
    ];
    mocks.invoices = [
      invoice("invoice-1"),
      invoice("invoice-2", {
        companyId: "company-2" as Id<"companies">,
        companyName: "Telesom",
        invoiceNumber: "INV-2026-00002",
        status: "paid",
        grandTotal: 750,
        amountPaid: 750,
        balanceDue: 0,
      }),
      invoice("invoice-3", {
        companyName: "Golis",
        invoiceNumber: "INV-2026-00003",
        status: "overdue",
        grandTotal: 500,
        balanceDue: 500,
      }),
    ];
  });

  it("renders the invoices route, header, and summary cards", () => {
    renderInvoicesPage();

    expect(screen.getByTestId("location")).toHaveTextContent("/invoices");
    expect(
      screen.getByRole("heading", { name: "Invoices" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Track issued invoices, balances, and customer payment status.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Total Invoiced")).toBeInTheDocument();
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(screen.getByText("$2,450.00")).toBeInTheDocument();
    expect(screen.getAllByText("$1,700.00")).toHaveLength(1);
    expect(screen.getAllByText("$750.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$500.00").length).toBeGreaterThan(0);
  });

  it("renders invoices from api.invoices.list in the table", () => {
    renderInvoicesPage();

    expect(screen.getByRole("columnheader", { name: "Invoice Number" }))
      .toBeInTheDocument();
    expect(screen.getByText("INV-2026-00001")).toBeInTheDocument();
    expect(screen.getByText("Hormuud")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-00002")).toBeInTheDocument();
    expect(screen.getByText("Telesom")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Detail coming next" }))
      .toHaveLength(3);
  });

  it("filters rows by status", async () => {
    renderInvoicesPage();

    await chooseSelectOption(/Filter by status/i, "Overdue");

    expect(screen.getByText("INV-2026-00003")).toBeInTheDocument();
    expect(screen.queryByText("INV-2026-00001")).not.toBeInTheDocument();
    expect(screen.queryByText("INV-2026-00002")).not.toBeInTheDocument();
  });

  it("filters rows by company and search text", async () => {
    const user = userEvent.setup();
    renderInvoicesPage();

    await chooseSelectOption(/Filter by company/i, "Telesom");
    expect(screen.getByText("INV-2026-00002")).toBeInTheDocument();
    expect(screen.queryByText("INV-2026-00001")).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Search invoices or customers..."),
      "missing",
    );

    expect(screen.getByText("No matching invoices")).toBeInTheDocument();
  });

  it("renders the empty state when no invoices exist", () => {
    mocks.invoices = [];

    renderInvoicesPage();

    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Accepted quotes can become draft invoices in the next phase.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the table headers stable for the list-first workflow", () => {
    renderInvoicesPage();

    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Date / Issue Date" }),
    ).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Customer" }))
      .toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Balance Due" }))
      .toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Due Date" }))
      .toBeInTheDocument();
  });
});
