import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import QuotesPage from "./page.tsx";

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    companies: { list: "companies.list" },
    quotes: {
      list: "quotes.list",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  quotes: [] as Doc<"quotes">[],
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (query: string) => {
    if (query === "companies.list") {
      return mocks.companies;
    }
    if (query === "quotes.list") {
      return mocks.quotes;
    }
    return undefined;
  },
}));

vi.mock("./_components/quote-create-dialog.tsx", () => ({
  default: () => null,
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

function quote(companyId: Id<"companies">): Doc<"quotes"> {
  return {
    _id: "quote-1" as Id<"quotes">,
    _creationTime: 1,
    companyId,
    createdBy: "user-1" as Id<"users">,
    date: "2026-07-28",
    status: "draft",
    lineItems: [],
    monthlyGrandTotal: 24189.8476,
    yearlyGrandTotal: 54473.093,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderQuotesPage() {
  return render(
    <MemoryRouter initialEntries={["/quotes"]}>
      <Routes>
        <Route
          path="/quotes"
          element={
            <>
              <QuotesPage />
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
      </Routes>
    </MemoryRouter>,
  );
}

describe("QuotesPage", () => {
  it("formats quote list currency values to exactly two decimals", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quotes = [quote(aicc._id)];

    renderQuotesPage();

    expect(screen.getByText("$24,189.85")).toBeInTheDocument();
    expect(screen.getByText("$54,473.09")).toBeInTheDocument();
    expect(screen.queryByText("$24,189.848")).not.toBeInTheDocument();
    expect(screen.queryByText("$54,473.093")).not.toBeInTheDocument();
  });

  it("navigates to the quote detail page from the eye action", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quotes = [quote(aicc._id)];

    renderQuotesPage();

    await user.click(screen.getByRole("button", { name: "View quote" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/quotes/quote-1");
  });
});
