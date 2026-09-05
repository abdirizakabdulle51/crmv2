import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import HistoricalInvoicesPage from "./page.tsx";

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  accounts: [] as Doc<"receivingAccounts">[],
  invoices: [] as Array<Doc<"invoices"> & { paymentDate?: number }>,
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    companies: { list: "companies.list" },
    receivingAccounts: { list: "receivingAccounts.list" },
    historicalInvoices: { list: "historicalInvoices.list", create: "historicalInvoices.create" },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "companies.list") return mocks.companies;
    if (query === "receivingAccounts.list") return mocks.accounts;
    if (query === "historicalInvoices.list") return mocks.invoices;
    return undefined;
  },
  useMutation: () => vi.fn(),
}));

describe("HistoricalInvoicesPage", () => {
  it("renders the historical entry workflow and existing ledger", () => {
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

    render(<HistoricalInvoicesPage />);

    expect(screen.getByRole("heading", { name: "Historical Paid Invoices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Historical Paid Invoice" })).toBeInTheDocument();
    expect(screen.getByText("Historical ledger")).toBeInTheDocument();
  });
});
