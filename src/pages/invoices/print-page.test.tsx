import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import InvoicePrintPage from "./print-page.tsx";

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    invoices: {
      getById: "invoices.getById",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  invoice: undefined as Doc<"invoices"> | null | undefined,
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "invoices.getById") return mocks.invoice;
    return undefined;
  },
}));

function invoice(overrides: Partial<Doc<"invoices">> = {}): Doc<"invoices"> {
  return {
    _id: "invoice-1" as Id<"invoices">,
    _creationTime: 1,
    companyId: "company-1" as Id<"companies">,
    sourceQuoteId: "quote-1" as Id<"quotes">,
    sourceMonth: "2026-08",
    createdBy: "user-1" as Id<"users">,
    invoiceNumber: "INV-2026-00002",
    status: "issued",
    issueDate: Date.UTC(2026, 7, 3, 22, 30),
    dueDate: Date.UTC(2026, 7, 31, 22, 30),
    lockedAt: Date.UTC(2026, 7, 3, 22, 31),
    companyName: "Easysolutions",
    contactName: "Amina Yusuf",
    contactEmail: "amina@example.com",
    billingEmail: "billing@example.com",
    billingAddress: "Mogadishu",
    taxId: "TIN-123",
    lineItems: [
      {
        catalogItemId: "catalog-1" as Id<"serviceCatalog">,
        itemName: "S6_48U_160G",
        serviceCategory: "Memory Optimized ECS Machine",
        billingUnit: "month",
        quantity: 2,
        monthlyUnitPrice: 1563.78,
        monthlyTotal: 3127.56,
        yearlyTotal: 37530.72,
      },
      {
        catalogItemId: "catalog-2" as Id<"serviceCatalog">,
        itemName: "SSD (Block Storage / NVMe)",
        serviceCategory: "SSD Storage.",
        billingUnit: "GB",
        quantity: 9216,
        monthlyUnitPrice: 0.125,
        monthlyTotal: 1152,
        yearlyTotal: 13824,
      },
    ],
    subtotal: 4279.56,
    monthlyTotal: 4279.56,
    yearlyTotal: 51354.72,
    grandTotal: 4279.56,
    amountPaid: 0,
    balanceDue: 4279.56,
    notes: "Snapshot note",
    createdAt: Date.UTC(2026, 7, 3, 20, 0),
    updatedAt: Date.UTC(2026, 7, 3, 22, 31),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPrintPage(initialEntry = "/invoices/invoice-1/print") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/invoices/:invoiceId/print"
          element={
            <>
              <InvoicePrintPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/invoices/:invoiceId"
          element={
            <>
              <div>Invoice Detail</div>
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

describe("InvoicePrintPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("print", vi.fn());
    mocks.invoice = invoice();
  });

  it("renders invoice snapshot data in a two-page print template", () => {
    renderPrintPage();

    expect(screen.getByLabelText("Invoice print template")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice page 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice page 2")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Invoice INV/2026/00002" }),
    ).toBeInTheDocument();
    const billTo = screen.getByLabelText("Bill To");
    expect(within(billTo).getByText("Easysolutions")).toBeInTheDocument();
    expect(within(billTo).getByText("Amina Yusuf")).toBeInTheDocument();
    expect(within(billTo).getByText("billing@example.com")).toBeInTheDocument();
    expect(within(billTo).getByText("Mogadishu")).toBeInTheDocument();
    expect(screen.getByText("S6_48U_160G")).toBeInTheDocument();
    expect(
      screen.getByText("Memory Optimized ECS Machine"),
    ).toBeInTheDocument();
    expect(screen.getByText("SSD (Block Storage / NVMe)")).toBeInTheDocument();
    expect(screen.getByText("$ 4,279.56")).toBeInTheDocument();
  });

  it("renders official print output for sent and paid-like statuses", () => {
    mocks.invoice = invoice({ status: "sent" });
    const { rerender } = renderPrintPage();

    expect(
      screen.getByRole("heading", { name: "Invoice INV/2026/00002" }),
    ).toBeInTheDocument();

    mocks.invoice = invoice({ status: "paid" });
    rerender(
      <MemoryRouter initialEntries={["/invoices/invoice-1/print"]}>
        <Routes>
          <Route
            path="/invoices/:invoiceId/print"
            element={<InvoicePrintPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Invoice INV/2026/00002" }),
    ).toBeInTheDocument();
  });

  it("clearly labels draft invoices as a draft preview", () => {
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    renderPrintPage();

    expect(
      screen.getByRole("heading", { name: "Draft Preview" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Draft Preview").length).toBeGreaterThan(1);
  });

  it("does not change the stored invoice number while displaying slash format", () => {
    mocks.invoice = invoice({ invoiceNumber: "INV-2026-00002" });

    renderPrintPage();

    expect(screen.getByText("Invoice INV/2026/00002")).toBeInTheDocument();
    expect(screen.queryByText("INV-2026-00002")).not.toBeInTheDocument();
  });

  it("formats dates in a stable business timezone", () => {
    renderPrintPage();

    const metadata = screen.getByText("Invoice Date").closest("dl");
    expect(metadata).not.toBeNull();
    expect(
      within(metadata as HTMLElement).getByText("08/04/2026"),
    ).toBeInTheDocument();
    expect(
      within(metadata as HTMLElement).getByText("09/01/2026"),
    ).toBeInTheDocument();
    expect(screen.getByText("Amount Due September, 2026")).toBeInTheDocument();
  });

  it("includes payment communication, instructions, and bank details", () => {
    renderPrintPage();

    expect(screen.getByLabelText("Payment communication")).toBeInTheDocument();
    expect(screen.getByText(/Payment Communication:/)).toHaveTextContent(
      "Payment Communication: INV/2026/00002",
    );
    expect(screen.getByText(/on this account:/)).toHaveTextContent(
      "on this account: 33111777",
    );
    expect(
      screen.getByText(
        "PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI BANK ACCOUNT.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("ACCOUNT # = 33111777")).toBeInTheDocument();
    expect(
      screen.getByText("ACC. NAME = HTG CLOUDS LIMITED"),
    ).toBeInTheDocument();
    expect(screen.getByText("MOGADISHU - SOMALIA")).toBeInTheDocument();
    expect(screen.getByText("All fees are listed in USD")).toBeInTheDocument();
  });

  it("isolates invoice pages from app navigation during printing", () => {
    renderPrintPage();

    const printStyles = document.querySelector("style")?.textContent ?? "";

    expect(printStyles).toContain("body *");
    expect(printStyles).toContain("visibility: hidden !important");
    expect(printStyles).toContain(".invoice-print-shell *");
    expect(printStyles).toContain("visibility: visible !important");
    expect(printStyles).toContain("[data-testid=\"app-top-notification-area\"]");
    expect(printStyles).toContain("aside");
    expect(printStyles).toContain("nav");
  });

  it("falls back to contact email when billing email is unavailable", () => {
    mocks.invoice = invoice({ billingEmail: undefined });

    renderPrintPage();

    const billTo = screen.getByLabelText("Bill To");
    expect(within(billTo).getByText("amina@example.com")).toBeInTheDocument();
  });

  it("returns to the invoice detail page", async () => {
    const user = userEvent.setup();
    renderPrintPage();

    await user.click(screen.getByRole("button", { name: "Back to Invoice" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/invoices/invoice-1",
    );
  });

  it("calls browser print from the print action", async () => {
    const user = userEvent.setup();
    renderPrintPage();

    await user.click(
      screen.getByRole("button", { name: "Print / Export PDF" }),
    );

    expect(window.print).toHaveBeenCalled();
  });

  it("shows unavailable state for void invoices", () => {
    mocks.invoice = invoice({ status: "void" });

    renderPrintPage();

    expect(screen.getByText("Invoice print unavailable")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Only draft previews and issued invoice snapshots can be printed.",
      ),
    ).toBeInTheDocument();
  });

  it("shows unavailable state for missing invoices", () => {
    mocks.invoice = null;

    renderPrintPage();

    expect(
      screen.getByText("Invoice not found or unavailable"),
    ).toBeInTheDocument();
  });
});
