import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import ExpenseCategoriesPage from "./page.tsx";

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
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    expenses: {
      listExpenseCategories: "expenses.listExpenseCategories",
      createExpenseCategory: "expenses.createExpenseCategory",
      updateExpenseCategory: "expenses.updateExpenseCategory",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  categories: undefined as Doc<"expenseCategories">[] | undefined,
  lastCategoryQueryArgs: undefined as unknown,
  createExpenseCategory: vi.fn(),
  updateExpenseCategory: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string, args: unknown) => {
    if (query === "expenses.listExpenseCategories") {
      mocks.lastCategoryQueryArgs = args;
      return mocks.categories;
    }
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "expenses.createExpenseCategory") {
      return mocks.createExpenseCategory;
    }
    if (mutation === "expenses.updateExpenseCategory") {
      return mocks.updateExpenseCategory;
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

function crmUser(id: string, role: Doc<"users">["role"]): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    tokenIdentifier: `${id}-token`,
    name: id,
    email: `${id}@example.com`,
    role,
  };
}

function category(
  id: string,
  overrides: Partial<Doc<"expenseCategories">> = {},
): Doc<"expenseCategories"> {
  return {
    _id: id as Id<"expenseCategories">,
    _creationTime: 1,
    name: "Travel",
    code: "TRAVEL",
    description: "Travel costs",
    isActive: true,
    requiresReceipt: false,
    createdBy: "ceo" as Id<"users">,
    createdAt: Date.UTC(2026, 7, 1, 9),
    updatedAt: Date.UTC(2026, 7, 2, 10),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/finance/expense-categories"]}>
      <Routes>
        <Route
          path="/finance/expense-categories"
          element={
            <>
              <ExpenseCategoriesPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ExpenseCategoriesPage", () => {
  beforeEach(() => {
    mocks.currentUser = crmUser("CEO", "ceo");
    mocks.categories = [
      category("category-1"),
      category("category-2", {
        name: "Old Category",
        code: "OLD",
        isActive: false,
        requiresReceipt: true,
      }),
    ];
    mocks.createExpenseCategory.mockReset().mockResolvedValue("category-new");
    mocks.updateExpenseCategory.mockReset().mockResolvedValue(undefined);
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  it("renders the route, list, summary cards, and inactive categories for admins", () => {
    renderPage();

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/finance/expense-categories",
    );
    expect(
      screen.getByRole("heading", { name: "Expense Categories" }),
    ).toBeInTheDocument();
    expect(mocks.lastCategoryQueryArgs).toEqual({ includeInactive: true });
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(screen.getByText("TRAVEL")).toBeInTheDocument();
    expect(screen.getByText("Old Category")).toBeInTheDocument();
    expect(screen.getAllByText("Requires Receipt").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "New Category" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });

  it("creates a category", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "New Category" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Hardware");
    await user.type(within(dialog).getByLabelText("Code"), "HARDWARE");
    await user.type(
      within(dialog).getByLabelText("Description"),
      "Hardware purchases",
    );
    await user.click(within(dialog).getByLabelText("Requires receipt"));
    await user.click(within(dialog).getByRole("button", { name: "Save Category" }));

    expect(mocks.createExpenseCategory).toHaveBeenCalledWith({
      name: "Hardware",
      code: "HARDWARE",
      description: "Hardware purchases",
      isActive: true,
      requiresReceipt: true,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Expense category created",
    );
  });

  it("edits category name, code, active status, and receipt requirement", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Travel Updated");
    await user.clear(within(dialog).getByLabelText("Code"));
    await user.type(within(dialog).getByLabelText("Code"), "TRAVEL_UPDATED");
    await user.click(within(dialog).getByLabelText("Active"));
    await user.click(within(dialog).getByLabelText("Requires receipt"));
    await user.click(within(dialog).getByRole("button", { name: "Save Category" }));

    expect(mocks.updateExpenseCategory).toHaveBeenCalledWith({
      categoryId: "category-1",
      name: "Travel Updated",
      code: "TRAVEL_UPDATED",
      description: "Travel costs",
      isActive: false,
      requiresReceipt: true,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Expense category updated",
    );
  });

  it("keeps non-admin users read-only and active-only", () => {
    mocks.currentUser = crmUser("AM", "account_manager");
    mocks.categories = [category("category-1")];

    renderPage();

    expect(mocks.lastCategoryQueryArgs).toEqual({ includeInactive: undefined });
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(
      screen.getByText(/Category management is limited to CEO and Head of Business/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Category" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" }))
      .not.toBeInTheDocument();
  });

  it("renders an empty state", () => {
    mocks.categories = [];

    renderPage();

    expect(screen.getByText("No expense categories yet.")).toBeInTheDocument();
  });

  it("shows backend errors as friendly toasts", async () => {
    const user = userEvent.setup();
    mocks.createExpenseCategory.mockRejectedValueOnce(new Error("Denied"));
    renderPage();

    await user.click(screen.getByRole("button", { name: "New Category" }));
    await user.type(screen.getByLabelText("Name"), "Hardware");
    await user.click(screen.getByRole("button", { name: "Save Category" }));

    expect(mocks.toastError).toHaveBeenCalledWith("Denied");
  });
});
