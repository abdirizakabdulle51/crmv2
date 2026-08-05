import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import FinanceSettingsPage from "./page.tsx";

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
    expenses: {
      getFinanceSettings: "expenses.getFinanceSettings",
      updateFinanceSettings: "expenses.updateFinanceSettings",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  financeSettings: undefined as
    | {
        countryApprovalLimit: number;
        businessApprovalLimit: number;
        currency: string;
        updatedAt?: number;
      }
    | undefined,
  updateFinanceSettings: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "expenses.getFinanceSettings") return mocks.financeSettings;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "expenses.updateFinanceSettings") {
      return mocks.updateFinanceSettings;
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

describe("FinanceSettingsPage", () => {
  beforeEach(() => {
    mocks.currentUser = crmUser("ceo", "ceo");
    mocks.financeSettings = {
      countryApprovalLimit: 100,
      businessApprovalLimit: 500,
      currency: "USD",
    };
    mocks.updateFinanceSettings.mockReset().mockResolvedValue("settings-id");
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  it("renders current approval settings", () => {
    render(<FinanceSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Finance Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Up to $100")).toBeInTheDocument();
    expect(screen.getByText("Above $100 up to $500")).toBeInTheDocument();
    expect(screen.getByText("Above $500")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100")).toBeInTheDocument();
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
  });

  it("allows CEO/HOB users to edit and save settings", async () => {
    const user = userEvent.setup();
    render(<FinanceSettingsPage />);

    await user.clear(screen.getByLabelText("Country approval limit"));
    await user.type(screen.getByLabelText("Country approval limit"), "150");
    await user.clear(screen.getByLabelText("Business approval limit"));
    await user.type(screen.getByLabelText("Business approval limit"), "750");
    await user.click(screen.getByRole("button", { name: "Save Settings" }));

    expect(mocks.updateFinanceSettings).toHaveBeenCalledWith({
      countryApprovalLimit: 150,
      businessApprovalLimit: 750,
      currency: "USD",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Finance settings saved");
  });

  it("keeps non CEO/HOB users read-only", () => {
    mocks.currentUser = crmUser("am", "account_manager");

    render(<FinanceSettingsPage />);

    expect(
      screen.getByText(/Finance settings are managed by CEO and Head of Business/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Settings" }))
      .not.toBeInTheDocument();
    expect(screen.getByLabelText("Country approval limit")).toBeDisabled();
    expect(screen.getByLabelText("Business approval limit")).toBeDisabled();
  });

  it("validates limits before saving", async () => {
    const user = userEvent.setup();
    render(<FinanceSettingsPage />);

    await user.clear(screen.getByLabelText("Country approval limit"));
    await user.type(screen.getByLabelText("Country approval limit"), "600");
    await user.clear(screen.getByLabelText("Business approval limit"));
    await user.type(screen.getByLabelText("Business approval limit"), "500");
    await user.click(screen.getByRole("button", { name: "Save Settings" }));

    expect(mocks.updateFinanceSettings).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Business approval limit must be greater than country approval limit",
    );
  });
});
