import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import ExpensesPage from "./page.tsx";

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
    countries: { list: "countries.list" },
    expenses: {
      listExpenseRequests: "expenses.listExpenseRequests",
      listExpenseCategories: "expenses.listExpenseCategories",
      createExpenseRequest: "expenses.createExpenseRequest",
    },
    users: { listAll: "users.listAll", getCurrentUser: "users.getCurrentUser" },
  },
}));

const mocks = vi.hoisted(() => ({
  expenses: [] as Doc<"expenseRequests">[],
  categories: [] as Doc<"expenseCategories">[],
  users: [] as Doc<"users">[],
  companies: [] as Doc<"companies">[],
  countries: [] as Doc<"countries">[],
  createExpenseRequest: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "expenses.listExpenseRequests") return mocks.expenses;
    if (query === "expenses.listExpenseCategories") return mocks.categories;
    if (query === "users.listAll") return mocks.users;
    if (query === "users.getCurrentUser") return mocks.users[0];
    if (query === "companies.list") return mocks.companies;
    if (query === "countries.list") return mocks.countries;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "expenses.createExpenseRequest") {
      return mocks.createExpenseRequest;
    }
    return vi.fn();
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.users[0] }),
}));

function user(id: string, name: string): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    tokenIdentifier: `${id}-token`,
    name,
    email: `${id}@example.com`,
    role: "account_manager",
    organizationScope: "country",
    countryId: "country-1" as Id<"countries">,
  };
}

function category(
  id: string,
  name: string,
  isActive = true,
  requiresReceipt = false,
): Doc<"expenseCategories"> {
  return {
    _id: id as Id<"expenseCategories">,
    _creationTime: 1,
    name,
    isActive,
    requiresReceipt,
    createdBy: "user-1" as Id<"users">,
    createdAt: 1,
    updatedAt: 1,
  };
}

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

function country(id: string, name: string): Doc<"countries"> {
  return {
    _id: id as Id<"countries">,
    _creationTime: 1,
    name,
    region: "East Africa",
  };
}

function expense(
  id: string,
  overrides: Partial<Doc<"expenseRequests">> = {},
): Doc<"expenseRequests"> {
  return {
    _id: id as Id<"expenseRequests">,
    _creationTime: 1,
    title: "Customer visit taxi",
    categoryId: "category-1" as Id<"expenseCategories">,
    amount: 25,
    currency: "USD",
    expenseDate: Date.UTC(2026, 7, 5),
    requestedBy: "user-1" as Id<"users">,
    companyId: "company-1" as Id<"companies">,
    countryId: "country-1" as Id<"countries">,
    status: "draft",
    createdAt: Date.UTC(2026, 7, 5),
    updatedAt: Date.UTC(2026, 7, 5),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderExpensesPage() {
  return render(
    <MemoryRouter initialEntries={["/finance/expenses"]}>
      <Routes>
        <Route
          path="/finance/expenses"
          element={
            <>
              <ExpensesPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/finance/expenses/:expenseId"
          element={
            <>
              <div>Expense Detail</div>
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

describe("ExpensesPage", () => {
  beforeEach(() => {
    mocks.createExpenseRequest.mockReset();
    mocks.createExpenseRequest.mockResolvedValue("expense-new");
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.users = [user("user-1", "Amina"), user("user-2", "Omar")];
    mocks.categories = [
      category("category-1", "Travel"),
      category("category-2", "Marketing"),
    ];
    mocks.companies = [company("company-1", "Hormuud")];
    mocks.countries = [country("country-1", "Somalia")];
    mocks.expenses = [
      expense("expense-1"),
      expense("expense-2", {
        title: "Campaign design",
        categoryId: "category-2" as Id<"expenseCategories">,
        requestedBy: "user-2" as Id<"users">,
        status: "submitted",
        amount: 75,
      }),
      expense("expense-3", { title: "Approved hotel", status: "approved" }),
      expense("expense-4", { title: "Paid taxi", status: "paid" }),
    ];
  });

  it("renders the expenses route, header, summary cards, and rows", () => {
    renderExpensesPage();

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/finance/expenses",
    );
    expect(
      screen.getByRole("heading", { name: "Expenses" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Request, approve, and track operational expenses."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
    expect(screen.getByText("Customer visit taxi")).toBeInTheDocument();
    expect(screen.getByText("Campaign design")).toBeInTheDocument();
  });

  it("filters by status, category, and requester", async () => {
    renderExpensesPage();

    await chooseSelectOption(/Filter by status/i, "Submitted");
    expect(screen.getByText("Campaign design")).toBeInTheDocument();
    expect(screen.queryByText("Customer visit taxi")).not.toBeInTheDocument();

    await chooseSelectOption(/Filter by category/i, "Marketing");
    expect(screen.getByText("Campaign design")).toBeInTheDocument();

    await chooseSelectOption(/Filter by requester/i, "Amina");
    expect(screen.getByText("No matching expenses")).toBeInTheDocument();
  });

  it("opens an expense from the row action", async () => {
    const user = userEvent.setup();
    renderExpensesPage();

    await user.click(screen.getAllByRole("button", { name: "Open" })[0]);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/finance/expenses/expense-1",
    );
  });

  it("creates a draft expense from the dialog", async () => {
    const user = userEvent.setup();
    renderExpensesPage();

    await user.click(screen.getByRole("button", { name: "New Expense" }));
    await user.type(screen.getByLabelText("Title"), "Airport taxi");
    await chooseSelectOption(/Expense category/i, "Travel");
    await user.clear(screen.getByLabelText("Amount"));
    await user.type(screen.getByLabelText("Amount"), "50");
    await chooseSelectOption(/Expense company/i, "Hormuud");
    await user.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(mocks.createExpenseRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Airport taxi",
        categoryId: "category-1",
        amount: 50,
        currency: "USD",
        companyId: "company-1",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Expense draft created");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/finance/expenses/expense-new",
      ),
    );
  });

  it("shows a receipt-required hint in the new expense dialog", async () => {
    const user = userEvent.setup();
    mocks.categories = [
      category("category-1", "Travel"),
      category("category-2", "Customer Visit", true, true),
    ];
    renderExpensesPage();

    await user.click(screen.getByRole("button", { name: "New Expense" }));
    await chooseSelectOption(/Expense category/i, "Customer Visit");

    expect(
      screen.getByText(
        "This category requires a receipt before the expense can be submitted or approved.",
      ),
    ).toBeInTheDocument();
  });

  it("shows empty category guidance and disables new expense", () => {
    mocks.categories = [];

    renderExpensesPage();

    expect(
      screen.getByText(
        "No active expense categories are available. Ask CEO/HOB to create or seed categories.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Expense" })).toBeDisabled();
  });
});
