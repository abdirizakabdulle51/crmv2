import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import FinanceReportsPage from "./page.tsx";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: () => <div />,
  CartesianGrid: () => <div />,
  Legend: () => <div />,
  Tooltip: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
}));

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
    countries: { list: "countries.list" },
    financeReports: {
      summary: "financeReports.summary",
      invoicePaymentsExport: "financeReports.invoicePaymentsExport",
      invoicePaymentsByRegionExport:
        "financeReports.invoicePaymentsByRegionExport",
      paidExpensesExport: "financeReports.paidExpensesExport",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  countries: [] as Doc<"countries">[],
  report: undefined as
    | {
        currency: string;
        startMonth: string;
        endMonth: string;
        monthly: Array<{
          month: string;
          income: number;
          recognizedRevenue: number;
          incurredExpenses: number;
          operatingNet: number;
          expenses: number;
          net: number;
          paymentCount: number;
          paidExpenseCount: number;
        }>;
        totals: {
          income: number;
          recognizedRevenue: number;
          incurredExpenses: number;
          operatingNet: number;
          expenses: number;
          net: number;
          paymentCount: number;
        };
        topExpenseCategories: Array<{
          categoryId: Id<"expenseCategories">;
          categoryName: string;
          total: number;
          count: number;
        }>;
        expenseStatusSummary: Array<{
          status: Doc<"expenseRequests">["status"];
          count: number;
          total: number;
        }>;
        incomeByRegion: Array<{
          region: string;
          income: number;
          paymentCount: number;
          invoiceCount: number;
        }>;
      }
    | undefined,
  reportArgs: [] as unknown[],
  convexQuery: vi.fn(),
  downloadCsv: vi.fn((_filename: string, _csv: string) => undefined),
  rowsToCsv: vi.fn((_columns: unknown[], _rows: unknown[]) => "csv-body"),
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.convexQuery }),
  useQuery: (query: string, args?: unknown) => {
    if (query === "countries.list") return mocks.countries;
    if (query === "financeReports.summary") {
      if (args !== "skip") {
        mocks.reportArgs.push(args);
      }
      return mocks.report;
    }
    return undefined;
  },
}));

vi.mock("@/lib/csv.ts", () => ({
  downloadCsv: (filename: string, csv: string) =>
    mocks.downloadCsv(filename, csv),
  rowsToCsv: (columns: unknown[], rows: unknown[]) =>
    mocks.rowsToCsv(columns, rows),
}));

function crmUser(role: Doc<"users">["role"]): Doc<"users"> {
  return {
    _id: "user-1" as Id<"users">,
    _creationTime: 1,
    tokenIdentifier: "user-1-token",
    name: "Amina",
    email: "amina@example.com",
    role,
  };
}

function country(id: string, name: string): Doc<"countries"> {
  return {
    _id: id as Id<"countries">,
    _creationTime: 1,
    name,
    region: "East Africa",
  };
}

function report(overrides = {}) {
  return {
    currency: "USD",
    startMonth: "2026-01",
    endMonth: "2026-08",
    monthly: [
      {
        month: "2026-08",
        income: 1000,
        recognizedRevenue: 1000,
        incurredExpenses: 250,
        operatingNet: 750,
        expenses: 250,
        net: 750,
        paymentCount: 2,
        paidExpenseCount: 1,
      },
    ],
    totals: {
      income: 1000,
      recognizedRevenue: 1000,
      incurredExpenses: 250,
      operatingNet: 750,
      expenses: 250,
      net: 750,
      paymentCount: 2,
    },
    topExpenseCategories: [
      {
        categoryId: "category-1" as Id<"expenseCategories">,
        categoryName: "Travel",
        total: 150,
        count: 2,
      },
    ],
    expenseStatusSummary: [
      { status: "draft" as const, count: 1, total: 20 },
      { status: "submitted" as const, count: 1, total: 40 },
      { status: "approved" as const, count: 0, total: 0 },
      { status: "rejected" as const, count: 0, total: 0 },
      { status: "paid" as const, count: 2, total: 150 },
      { status: "cancelled" as const, count: 0, total: 0 },
    ],
    incomeByRegion: [
      {
        region: "Hoa-Mogadishu-2",
        income: 700,
        paymentCount: 2,
        invoiceCount: 1,
      },
    ],
    countryPerformance: [
      {
        countryId: "country-1",
        countryName: "Somalia",
        revenue: 900,
        collections: 1000,
        expenses: 250,
        net: 750,
      },
    ],
    ...overrides,
  };
}

function renderReport(view?: "overview" | "revenue" | "expenses" | "country") {
  return render(
    <MemoryRouter>
      <FinanceReportsPage view={view} />
    </MemoryRouter>,
  );
}

describe("FinanceReportsPage", () => {
  beforeEach(() => {
    mocks.currentUser = crmUser("ceo");
    mocks.countries = [country("country-1", "Somalia")];
    mocks.report = report();
    mocks.reportArgs = [];
    mocks.convexQuery.mockReset().mockResolvedValue([]);
    mocks.downloadCsv.mockReset();
    mocks.rowsToCsv.mockReset().mockReturnValue("csv-body");
  });

  it("renders finance report summary cards and report sections", () => {
    renderReport();

    expect(
      screen.getByRole("heading", { name: "Finance Overview" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Collections").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expenses incurred").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Operating net").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$750.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Monthly Recognized Revenue vs Expenses Incurred")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(
      screen.queryByText("Income by Region / Data Center"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Expense Status Summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export Invoice Payments CSV" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Country performance" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Expenses" })).toBeInTheDocument();
  });

  it("keeps revenue and country views focused", () => {
    const { unmount } = renderReport("revenue");
    expect(
      screen.getByText("Monthly Revenue and Collections"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Paid Expenses")).not.toBeInTheDocument();
    unmount();

    renderReport("country");
    expect(
      screen.getByText("Country financial performance"),
    ).toBeInTheDocument();
    expect(screen.getByText("Somalia")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Revenue" }),
    ).toBeInTheDocument();
  });

  it("updates report query filters", async () => {
    const user = userEvent.setup();
    renderReport();

    fireEvent.change(screen.getByLabelText("Start month"), {
      target: { value: "2026-07" },
    });
    fireEvent.change(screen.getByLabelText("End month"), {
      target: { value: "2026-08" },
    });
    await user.click(
      screen.getByRole("combobox", { name: "Filter by country" }),
    );
    await user.click(await screen.findByRole("option", { name: "Somalia" }));

    expect(mocks.reportArgs.at(-1)).toEqual({
      startMonth: "2026-07",
      endMonth: "2026-08",
      countryId: "country-1",
    });
  });

  it("renders an unauthorized state for Account Managers", () => {
    mocks.currentUser = crmUser("account_manager");

    renderReport();

    expect(screen.getByText("Finance reports unavailable")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Export Invoice Payments CSV" }),
    ).not.toBeInTheDocument();
    expect(mocks.reportArgs).toHaveLength(0);
  });

  it("renders an empty state when there is no report data", () => {
    mocks.report = report({
      monthly: [
        {
          month: "2026-08",
          income: 0,
          recognizedRevenue: 0,
          incurredExpenses: 0,
          operatingNet: 0,
          expenses: 0,
          net: 0,
          paymentCount: 0,
          paidExpenseCount: 0,
        },
      ],
      totals: {
        income: 0,
        recognizedRevenue: 0,
        incurredExpenses: 0,
        operatingNet: 0,
        expenses: 0,
        net: 0,
        paymentCount: 0,
      },
      topExpenseCategories: [],
      incomeByRegion: [],
      expenseStatusSummary: [
        { status: "draft" as const, count: 0, total: 0 },
        { status: "submitted" as const, count: 0, total: 0 },
        { status: "approved" as const, count: 0, total: 0 },
        { status: "rejected" as const, count: 0, total: 0 },
        { status: "paid" as const, count: 0, total: 0 },
        { status: "cancelled" as const, count: 0, total: 0 },
      ],
    });

    renderReport();

    expect(screen.getByText("No finance report data yet.")).toBeInTheDocument();
  });

  it("does not show country filter to Country GM", () => {
    mocks.currentUser = crmUser("country_gm");

    renderReport("country");

    expect(
      screen.queryByRole("combobox", { name: "Filter by country" }),
    ).not.toBeInTheDocument();
    expect(mocks.reportArgs.at(-1)).toMatchObject({
      startMonth: expect.any(String),
      endMonth: expect.any(String),
      countryId: undefined,
    });
  });

  it("exports invoice payments with current filters and filename", async () => {
    const user = userEvent.setup();
    renderReport();

    fireEvent.change(screen.getByLabelText("Start month"), {
      target: { value: "2026-07" },
    });
    fireEvent.change(screen.getByLabelText("End month"), {
      target: { value: "2026-08" },
    });
    await user.click(
      screen.getByRole("combobox", { name: "Filter by country" }),
    );
    await user.click(await screen.findByRole("option", { name: "Somalia" }));
    await user.click(
      screen.getByRole("button", { name: "Export Invoice Payments CSV" }),
    );

    expect(mocks.convexQuery).toHaveBeenCalledWith(
      "financeReports.invoicePaymentsExport",
      {
        startMonth: "2026-07",
        endMonth: "2026-08",
        countryId: "country-1",
      },
    );
    const csvCalls = mocks.rowsToCsv.mock.calls as unknown[][];
    const columns = csvCalls[0]?.[0] as Array<{ header: string }> | undefined;
    expect(columns?.map((column) => column.header)).toEqual([
      "Payment Date",
      "Invoice Number",
      "Customer / Company",
      "Country",
      "Amount",
      "Currency",
      "Payment Method",
      "Customer Reference",
      "Receiving Bank Name",
      "Receiving Account Number",
      "Receiving Account Name",
      "Receiving Bank Location",
      "Receiving Currency Note",
      "Recorded By Name",
      "Recorded By Email",
      "Recorded At",
      "Invoice Status",
      "Source Reference",
    ]);
    expect(mocks.downloadCsv).toHaveBeenCalledWith(
      "finance-invoice-payments-2026-07-to-2026-08.csv",
      "csv-body",
    );
  });

  it("exports region income with current filters and headers", async () => {
    const user = userEvent.setup();
    renderReport("country");

    fireEvent.change(screen.getByLabelText("Start month"), {
      target: { value: "2026-07" },
    });
    fireEvent.change(screen.getByLabelText("End month"), {
      target: { value: "2026-08" },
    });
    await user.click(
      screen.getByRole("combobox", { name: "Filter by country" }),
    );
    await user.click(await screen.findByRole("option", { name: "Somalia" }));
    await user.click(
      screen.getByRole("button", { name: "Export Region Income CSV" }),
    );

    expect(mocks.convexQuery).toHaveBeenCalledWith(
      "financeReports.invoicePaymentsByRegionExport",
      {
        startMonth: "2026-07",
        endMonth: "2026-08",
        countryId: "country-1",
      },
    );
    const csvCalls = mocks.rowsToCsv.mock.calls as unknown[][];
    const columns = csvCalls[0]?.[0] as Array<{ header: string }> | undefined;
    expect(columns?.map((column) => column.header)).toEqual([
      "Payment Date",
      "Invoice Number",
      "Customer / Company",
      "Country",
      "Region / Data Center",
      "Allocated Amount",
      "Original Payment Amount",
      "Payment Method",
      "Customer Reference",
      "Recorded By Name",
      "Recorded By Email",
      "Recorded At",
      "Invoice Status",
      "Source Reference",
    ]);
    expect(mocks.downloadCsv).toHaveBeenCalledWith(
      "finance-region-income-2026-07-to-2026-08.csv",
      "csv-body",
    );
  });

  it("exports paid expenses with current filters and filename", async () => {
    const user = userEvent.setup();
    renderReport("expenses");

    fireEvent.change(screen.getByLabelText("Start month"), {
      target: { value: "2026-07" },
    });
    fireEvent.change(screen.getByLabelText("End month"), {
      target: { value: "2026-08" },
    });
    await user.click(
      screen.getByRole("button", { name: "Export Paid Expenses CSV" }),
    );

    expect(mocks.convexQuery).toHaveBeenCalledWith(
      "financeReports.paidExpensesExport",
      {
        startMonth: "2026-07",
        endMonth: "2026-08",
        countryId: undefined,
      },
    );
    const csvCalls = mocks.rowsToCsv.mock.calls as unknown[][];
    const columns = csvCalls[0]?.[0] as Array<{ header: string }> | undefined;
    expect(columns?.map((column) => column.header)).toEqual([
      "Expense Date",
      "Paid Date",
      "Title",
      "Category",
      "Requester Name",
      "Requester Email",
      "Company",
      "Country",
      "Vendor",
      "Amount",
      "Currency",
      "Payment Method",
      "Payment Reference",
      "Transaction ID",
      "Funding Account",
      "Funding Provider",
      "Funding Account Number",
      "Approved By Name",
      "Approved By Email",
      "Paid By Name",
      "Paid By Email",
      "Status",
    ]);
    expect(mocks.downloadCsv).toHaveBeenCalledWith(
      "finance-paid-expenses-2026-07-to-2026-08.csv",
      "csv-body",
    );
  });
});
