import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import QuoteFromAdvisorPage from "./from-advisor-page.tsx";

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    quotes: {
      buildQuotePreviewFromAdvisor: "quotes.buildQuotePreviewFromAdvisor",
      create: "quotes.create",
    },
  },
}));

type AdvisorQuotePreview = {
  companyId: Id<"companies">;
  companyName: string;
  recommendationKey: string;
  recommendedService: string;
  sourceRule: string;
  triggerReason: string;
  estimateBasis?: string;
  estimatedMonthlyValue?: number;
  matchedCatalogItem?: {
    catalogItemId: Id<"serviceCatalog">;
    itemName: string;
    serviceCategory: string;
    billingUnit: string;
    monthlyUnitPrice: number;
  };
  lineItemPreview?: {
    catalogItemId: Id<"serviceCatalog">;
    itemName: string;
    serviceCategory: string;
    billingUnit: string;
    quantity: number;
    monthlyUnitPrice: number;
    monthlyTotal: number;
    yearlyTotal: number;
  };
  warnings: string[];
};

const mocks = vi.hoisted(() => ({
  preview: undefined as AdvisorQuotePreview | undefined,
  createQuote: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createQuote,
  useQuery: (query: string) => {
    if (query === "quotes.buildQuotePreviewFromAdvisor") {
      return mocks.preview;
    }
    return undefined;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function preview(
  overrides: Partial<AdvisorQuotePreview> = {},
): AdvisorQuotePreview {
  return {
    companyId: "company-1" as Id<"companies">,
    companyName: "Dahab Bank",
    recommendationKey: "company-1:compliance:cbh",
    recommendedService: "CBH (Cloud Bastion Host)",
    sourceRule: "compliance",
    triggerReason:
      "Banking/fintech sector (Banking) but no CBH for compliance audit",
    estimateBasis: "Flat catalog rate: $120.00/mo per flat fee",
    estimatedMonthlyValue: 120,
    matchedCatalogItem: {
      catalogItemId: "catalog-1" as Id<"serviceCatalog">,
      itemName: "Cloud Bastion Host",
      serviceCategory: "CBH",
      billingUnit: "flat fee",
      monthlyUnitPrice: 120,
    },
    lineItemPreview: {
      catalogItemId: "catalog-1" as Id<"serviceCatalog">,
      itemName: "Cloud Bastion Host",
      serviceCategory: "CBH",
      billingUnit: "flat fee",
      quantity: 1,
      monthlyUnitPrice: 120,
      monthlyTotal: 120,
      yearlyTotal: 1200,
    },
    warnings: [],
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

function renderAdvisorQuotePage() {
  return render(
    <MemoryRouter
      initialEntries={[
        "/quotes/from-advisor?recommendationKey=company-1%3Acompliance%3Acbh",
      ]}
    >
      <Routes>
        <Route
          path="/quotes/from-advisor"
          element={
            <>
              <QuoteFromAdvisorPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/quotes/:id"
          element={
            <>
              <div>Quote Detail</div>
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

describe("QuoteFromAdvisorPage", () => {
  it("renders a matched advisor quote preview", () => {
    mocks.preview = preview();

    renderAdvisorQuotePage();

    expect(
      screen.getByRole("heading", { name: "Create Quote from Cloud Advisor" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dahab Bank")).toBeInTheDocument();
    expect(screen.getByText("CBH (Cloud Bastion Host)")).toBeInTheDocument();
    expect(screen.getAllByText("Cloud Bastion Host").length).toBeGreaterThan(1);
    expect(screen.getByTestId("advisor-quote-preview")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Draft Quote" }),
    ).toBeEnabled();
  });

  it("shows a warning and disables create when no line item preview exists", () => {
    mocks.preview = preview({
      matchedCatalogItem: undefined,
      lineItemPreview: undefined,
      warnings: [
        "No service catalog item matched the recommendation recommended service.",
      ],
    });

    renderAdvisorQuotePage();

    expect(screen.getByText("Review needed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This recommendation needs manual catalog/quantity review before creating a quote.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Draft Quote" }),
    ).toBeDisabled();
  });

  it("creates a draft quote with advisor context notes and navigates to quote detail", async () => {
    const user = userEvent.setup();
    mocks.preview = preview();
    mocks.createQuote.mockResolvedValue("quote-1");

    renderAdvisorQuotePage();

    await user.click(screen.getByRole("button", { name: "Create Draft Quote" }));

    await waitFor(() => {
      expect(mocks.createQuote).toHaveBeenCalledWith({
        companyId: "company-1",
        lineItems: [mocks.preview?.lineItemPreview],
        monthlyGrandTotal: 120,
        yearlyGrandTotal: 1200,
        notes: expect.stringContaining("Cloud Advisor recommendation"),
      });
    });
    expect(mocks.createQuote.mock.calls[0][0].notes).toContain(
      "Recommendation key: company-1:compliance:cbh",
    );
    expect(mocks.createQuote.mock.calls[0][0].notes).toContain(
      "Source rule: compliance",
    );
    expect(screen.getByText("Quote Detail")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/quotes/quote-1",
    );
  });
});
