import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
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
    financeReports: { summary: "financeReports.summary" },
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
          expenses: number;
          net: number;
          paymentCount: number;
          paidExpenseCount: number;
        }>;
        totals: {
          income: number;
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
      }
    | undefined,
  reportArgs: [] as unknown[],
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("convex/react", () => ({
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
        expenses: 250,
        net: 750,
        paymentCount: 2,
        paidExpenseCount: 1,
      },
    ],
    totals: {
      income: 1000,
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
    ...overrides,
  };
}

describe("FinanceReportsPage", () => {
  beforeEach(() => {
    mocks.currentUser = crmUser("ceo");
    mocks.countries = [country("country-1", "Somalia")];
    mocks.report = report();
    mocks.reportArgs = [];
  });

  it("renders finance report summary cards and report sections", () => {
    render(<FinanceReportsPage />);

    expect(
      screen.getByRole("heading", { name: "Finance Reports" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Income").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Expenses").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Net").length).toBeGreaterThan(0);
    expect(screen.getByText("Paid invoice payments")).toBeInTheDocument();
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$750.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Monthly Income vs Expenses")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(screen.getByText("Expense Status Summary")).toBeInTheDocument();
  });

  it("updates report query filters", async () => {
    const user = userEvent.setup();
    render(<FinanceReportsPage />);

    fireEvent.change(screen.getByLabelText("Start month"), {
      target: { value: "2026-07" },
    });
    fireEvent.change(screen.getByLabelText("End month"), {
      target: { value: "2026-08" },
    });
    await user.click(screen.getByRole("combobox", { name: "Filter by country" }));
    await user.click(await screen.findByRole("option", { name: "Somalia" }));

    expect(mocks.reportArgs.at(-1)).toEqual({
      startMonth: "2026-07",
      endMonth: "2026-08",
      countryId: "country-1",
    });
  });

  it("renders an unauthorized state for Account Managers", () => {
    mocks.currentUser = crmUser("account_manager");

    render(<FinanceReportsPage />);

    expect(
      screen.getByText("Finance reports unavailable"),
    ).toBeInTheDocument();
    expect(mocks.reportArgs).toHaveLength(0);
  });

  it("renders an empty state when there is no report data", () => {
    mocks.report = report({
      monthly: [
        {
          month: "2026-08",
          income: 0,
          expenses: 0,
          net: 0,
          paymentCount: 0,
          paidExpenseCount: 0,
        },
      ],
      totals: { income: 0, expenses: 0, net: 0, paymentCount: 0 },
      topExpenseCategories: [],
      expenseStatusSummary: [
        { status: "draft" as const, count: 0, total: 0 },
        { status: "submitted" as const, count: 0, total: 0 },
        { status: "approved" as const, count: 0, total: 0 },
        { status: "rejected" as const, count: 0, total: 0 },
        { status: "paid" as const, count: 0, total: 0 },
        { status: "cancelled" as const, count: 0, total: 0 },
      ],
    });

    render(<FinanceReportsPage />);

    expect(screen.getByText("No finance report data yet.")).toBeInTheDocument();
    expect(screen.getByText("No paid expenses in this period."))
      .toBeInTheDocument();
  });

  it("does not show country filter to Country GM", () => {
    mocks.currentUser = crmUser("country_gm");

    render(<FinanceReportsPage />);

    expect(screen.queryByRole("combobox", { name: "Filter by country" }))
      .not.toBeInTheDocument();
    expect(mocks.reportArgs.at(-1)).toMatchObject({
      startMonth: expect.any(String),
      endMonth: expect.any(String),
      countryId: undefined,
    });
  });
});
