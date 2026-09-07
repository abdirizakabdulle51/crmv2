import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import HistoricalInvoicesPage from "./page.tsx";

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  accounts: [] as Doc<"receivingAccounts">[],
  invoices: [] as Array<Doc<"invoices"> & { paymentDate?: number }>,
  createPaid: vi.fn().mockResolvedValue("invoice-paid"),
  createUnpaid: vi.fn().mockResolvedValue("invoice-unpaid"),
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    companies: { list: "companies.list" },
    receivingAccounts: { list: "receivingAccounts.list" },
    historicalInvoices: { list: "historicalInvoices.list", create: "historicalInvoices.create", createUnpaid: "historicalInvoices.createUnpaid" },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "companies.list") return mocks.companies;
    if (query === "receivingAccounts.list") return mocks.accounts;
    if (query === "historicalInvoices.list") return mocks.invoices;
    return undefined;
  },
  useMutation: (mutation: string) => mutation === "historicalInvoices.createUnpaid" ? mocks.createUnpaid : mocks.createPaid,
}));

describe("HistoricalInvoicesPage", () => {
  beforeEach(() => {
    mocks.companies = [{
      _id: "company-1" as Id<"companies">,
      _creationTime: 1,
      name: "AICC",
      sectorId: "sector-1" as Id<"sectors">,
      countryId: "country-1" as Id<"countries">,
      contractStatus: "active",
    }];
    mocks.accounts = [];
    mocks.invoices = [];
  });

  it("renders the historical entry workflow and existing ledger", () => {
    render(<HistoricalInvoicesPage />);

    expect(screen.getByRole("heading", { name: "Historical Invoices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Historical Paid Invoice" })).toBeInTheDocument();
    expect(screen.getByText("Historical ledger")).toBeInTheDocument();
  });

  it("submits unpaid imports without payment fields", async () => {
    mocks.createUnpaid.mockClear();
    mocks.createPaid.mockClear();
    render(<HistoricalInvoicesPage />);
    await userSelectsCompany();
    fireEvent.click(screen.getByRole("button", { name: "Unpaid Invoice" }));
    fireEvent.change(screen.getByLabelText("Original Odoo / Historical Reference *"), { target: { value: "UNPAID-1" } });
    fireEvent.change(screen.getByLabelText("Invoice Date *"), { target: { value: "2026-02-02" } });
    fireEvent.change(screen.getByLabelText("Coverage Start Month *"), { target: { value: "2026-02" } });
    fireEvent.change(screen.getByLabelText("Monthly Amount (USD) *"), { target: { value: "100" } });
    expect(screen.queryByLabelText("Payment Date *")).not.toBeInTheDocument();
    expect(screen.getByText("Amount Paid:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record Historical Unpaid Invoice" }));
    await waitFor(() => expect(mocks.createUnpaid).toHaveBeenCalledWith({
      companyId: "company-1",
      originalReference: "UNPAID-1",
      invoiceDate: "2026-02-02",
      coverageStartMonth: "2026-02",
      monthsCovered: 1,
      monthlyAmount: 100,
      notes: undefined,
    }));
    expect(mocks.createPaid).not.toHaveBeenCalled();
  });

  it("keeps the paid mode connected to the existing mutation", async () => {
    mocks.createUnpaid.mockClear();
    mocks.createPaid.mockClear();
    render(<HistoricalInvoicesPage />);
    await userSelectsCompany();
    fireEvent.change(screen.getByLabelText("Original Odoo / Historical Reference *"), { target: { value: "PAID-1" } });
    fireEvent.change(screen.getByLabelText("Invoice Date *"), { target: { value: "2026-02-02" } });
    fireEvent.change(screen.getByLabelText("Coverage Start Month *"), { target: { value: "2026-02" } });
    fireEvent.change(screen.getByLabelText("Monthly Amount (USD) *"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-02-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Historical Paid Invoice" }));
    await waitFor(() => expect(mocks.createPaid).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      originalReference: "PAID-1",
      paymentDate: "2026-02-03",
    })));
    expect(mocks.createUnpaid).not.toHaveBeenCalled();
  });
});

async function userSelectsCompany() {
  fireEvent.click(screen.getByRole("combobox", { name: "Company" }));
  fireEvent.click(screen.getByRole("option", { name: "AICC" }));
}
