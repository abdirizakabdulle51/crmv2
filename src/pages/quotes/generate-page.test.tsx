import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import QuoteGenerateFromUsagePage from "./generate-page.tsx";

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
    quotes: {
      buildQuotePreviewFromUsage: "quotes.buildQuotePreviewFromUsage",
      create: "quotes.create",
    },
  },
}));

type QuotePreview = {
  lineItems: Array<{
    catalogItemId: Id<"serviceCatalog">;
    itemName: string;
    serviceCategory: string;
    billingUnit: string;
    quantity: number;
    monthlyUnitPrice: number;
    monthlyTotal: number;
    yearlyTotal: number;
  }>;
  warnings: Array<{
    serviceType: string;
    amount: number;
    reason: string;
  }>;
  monthlyGrandTotal: number;
  yearlyGrandTotal: number;
  existingQuote: {
    id: Id<"quotes">;
    date: string;
    status: "draft" | "sent" | "accepted";
  } | null;
};

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  createQuote: vi.fn(),
  preview: undefined as QuotePreview | undefined,
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createQuote,
  useQuery: (query: string) => {
    if (query === "companies.list") {
      return mocks.companies;
    }
    if (query === "quotes.buildQuotePreviewFromUsage") {
      return mocks.preview;
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

function preview(existingQuote: QuotePreview["existingQuote"] = null) {
  return {
    lineItems: [
      {
        catalogItemId: "catalog-1" as Id<"serviceCatalog">,
        itemName: "EIP - Active",
        serviceCategory: "EIP",
        billingUnit: "per IP",
        quantity: 2,
        monthlyUnitPrice: 3,
        monthlyTotal: 6,
        yearlyTotal: 72,
      },
    ],
    warnings: [
      {
        serviceType: "WAF",
        amount: 12,
        reason: "Missing catalog item",
      },
    ],
    monthlyGrandTotal: 6,
    yearlyGrandTotal: 72,
    existingQuote,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderGeneratePage() {
  return render(
    <MemoryRouter
      initialEntries={["/quotes/generate?company=company-1&month=2026-07"]}
    >
      <Routes>
        <Route
          path="/quotes/generate"
          element={
            <>
              <QuoteGenerateFromUsagePage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/quotes"
          element={
            <>
              <div>Quotes List</div>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("QuoteGenerateFromUsagePage", () => {
  it("shows the full-page quote preview and requires duplicate confirmation", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "AICC")];
    mocks.preview = preview({
      id: "quote-1" as Id<"quotes">,
      date: "2026-07-28",
      status: "draft",
    });

    renderGeneratePage();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("quote-preview")).toBeInTheDocument();
    expect(screen.getByText("EIP - Active")).toBeInTheDocument();
    expect(screen.getByText(/Missing catalog item/)).toBeInTheDocument();
    expect(
      screen.getByText("A quote already exists for this company and month."),
    ).toBeInTheDocument();

    const createButton = screen.getAllByRole("button", {
      name: "Create Another Draft Quote",
    })[0];
    expect(createButton).toBeDisabled();

    await user.click(screen.getByLabelText("Create another quote anyway"));
    expect(createButton).toBeEnabled();
  });

  it("creates a draft quote from usage and returns to the Quotes page", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "AICC")];
    mocks.createQuote.mockResolvedValue("quote-2");
    mocks.preview = preview(null);

    renderGeneratePage();

    await user.click(
      screen.getAllByRole("button", { name: "Create Draft Quote" })[0],
    );

    await waitFor(() => {
      expect(mocks.createQuote).toHaveBeenCalledWith({
        companyId: "company-1",
        lineItems: [
          {
            catalogItemId: "catalog-1",
            itemName: "EIP - Active",
            serviceCategory: "EIP",
            billingUnit: "per IP",
            quantity: 2,
            monthlyUnitPrice: 3,
          },
        ],
        notes: "Generated from Usage Tracking for 2026-07",
        sourceMonth: "2026-07",
      });
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/quotes");
  });
});
