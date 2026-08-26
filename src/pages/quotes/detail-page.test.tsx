import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import QuoteDetailPage from "./detail-page.tsx";

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    companies: { list: "companies.list" },
    quotes: {
      getById: "quotes.getById",
      updateStatus: "quotes.updateStatus",
      updateDiscount: "quotes.updateDiscount",
      approveDiscount: "quotes.approveDiscount",
      rejectDiscount: "quotes.rejectDiscount",
      remove: "quotes.remove",
    },
    invoices: {
      createDraftFromQuote: "invoices.createDraftFromQuote",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  quote: undefined as Doc<"quotes"> | undefined,
  updateStatus: vi.fn(),
  updateDiscount: vi.fn(),
  approveDiscount: vi.fn(),
  rejectDiscount: vi.fn(),
  removeQuote: vi.fn(),
  createDraftInvoice: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => {
    if (mutation === "quotes.updateStatus") {
      return mocks.updateStatus;
    }
    if (mutation === "quotes.updateDiscount") {
      return mocks.updateDiscount;
    }
    if (mutation === "quotes.approveDiscount") {
      return mocks.approveDiscount;
    }
    if (mutation === "quotes.rejectDiscount") {
      return mocks.rejectDiscount;
    }
    if (mutation === "quotes.remove") {
      return mocks.removeQuote;
    }
    if (mutation === "invoices.createDraftFromQuote") {
      return mocks.createDraftInvoice;
    }
    return vi.fn();
  },
  useQuery: (query: string) => {
    if (query === "companies.list") {
      return mocks.companies;
    }
    if (query === "quotes.getById") {
      return mocks.quote;
    }
    return undefined;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
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

function quote(
  companyId: Id<"companies">,
  status: "draft" | "sent" | "accepted" = "draft",
): Doc<"quotes"> {
  return {
    _id: "quote-1" as Id<"quotes">,
    _creationTime: 1,
    companyId,
    createdBy: "user-1" as Id<"users">,
    date: "2026-07-28",
    status,
    lineItems: [
      {
        catalogItemId: "catalog-1" as Id<"serviceCatalog">,
        itemName: "EIP - Active",
        serviceCategory: "EIP",
        billingUnit: "per IP/month",
        quantity: 2,
        monthlyUnitPrice: 3,
        monthlyTotal: 6,
        yearlyTotal: 72,
      },
    ],
    monthlyGrandTotal: 6,
    yearlyGrandTotal: 72,
    notes: "Generated from Usage Tracking for 2026-07",
    sourceMonth: "2026-07",
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderDetailPage() {
  return render(
    <MemoryRouter initialEntries={["/quotes/quote-1"]}>
      <Routes>
        <Route
          path="/quotes/:id"
          element={
            <>
              <QuoteDetailPage />
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
        <Route
          path="/invoices"
          element={
            <>
              <div>Invoices List</div>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("QuoteDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the quote details as a full page with preserved status colors and notes", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id);

    renderDetailPage();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quote - AICC" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("EIP - Active")).toBeInTheDocument();
    expect(
      screen.getByText("Generated from Usage Tracking for 2026-07"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("$6.00")).toHaveLength(3);
    expect(screen.getAllByText("$72.00")).toHaveLength(3);
  });

  it("prints/exports through the existing popup document flow", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    const print = vi.fn();
    const close = vi.fn();
    const write = vi.fn();
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id);
    vi.spyOn(window, "open").mockReturnValue({
      document: { write, close },
      print,
    } as unknown as Window);

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Print / Export" }));

    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("Service Quote"),
    );
    expect(write).toHaveBeenCalledWith(expect.stringContaining("EIP - Active"));
    expect(close).toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
  });

  it("marks a draft quote as sent without navigating away", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id);
    mocks.updateStatus.mockResolvedValue(undefined);

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Mark as Sent" }));

    expect(mocks.updateStatus).toHaveBeenCalledWith({
      id: "quote-1",
      status: "sent",
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/quotes/quote-1");
  });

  it("applies a discount to a draft quote from the discount button", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id);
    mocks.updateDiscount.mockResolvedValue({
      discountPercent: 15,
      discountApprovalStatus: "pending",
      discountApprovalLevel: "country_gm",
    });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Discount" }));
    await user.type(screen.getByLabelText("Discount percent"), "15");
    await user.click(screen.getByRole("button", { name: "Apply Discount" }));

    await waitFor(() => {
      expect(mocks.updateDiscount).toHaveBeenCalledWith({
        id: "quote-1",
        discountPercent: 15,
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Discount saved and sent for Country Manager approval",
    );
  });

  it("deletes a draft quote and returns to the Quotes list", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id);
    mocks.removeQuote.mockResolvedValue(undefined);

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mocks.removeQuote).toHaveBeenCalledWith({ id: "quote-1" });
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/quotes");
  });

  it("shows Create Invoice only for accepted quotes", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id, "accepted");

    renderDetailPage();

    expect(
      screen.getByRole("button", { name: "Create Invoice" }),
    ).toBeInTheDocument();
  });

  it("does not show Create Invoice for draft quotes", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id, "draft");

    renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Create Invoice" }),
    ).not.toBeInTheDocument();
  });

  it("does not show Create Invoice for sent quotes", () => {
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id, "sent");

    renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Create Invoice" }),
    ).not.toBeInTheDocument();
  });

  it("creates a draft invoice from an accepted quote and navigates to invoices", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id, "accepted");
    mocks.createDraftInvoice.mockResolvedValue("invoice-1");

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Create Invoice" }));

    await waitFor(() => {
      expect(mocks.createDraftInvoice).toHaveBeenCalledWith({
        quoteId: "quote-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Draft invoice created");
    expect(screen.getByTestId("location")).toHaveTextContent("/invoices");
  });

  it("shows an error and stays on quote detail when invoice creation fails", async () => {
    const user = userEvent.setup();
    const aicc = company("company-1", "AICC");
    mocks.companies = [aicc];
    mocks.quote = quote(aicc._id, "accepted");
    mocks.createDraftInvoice.mockRejectedValue(new Error("Only accepted quotes can be invoiced"));

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Create Invoice" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Only accepted quotes can be invoiced",
      );
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/quotes/quote-1");
  });
});
