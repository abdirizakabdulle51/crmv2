import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { CompanyForm } from "./company-dialog.tsx";

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
    companies: {
      create: "companies.create",
      update: "companies.update",
      remove: "companies.remove",
    },
    manageOneTenants: {
      getByCompanyId: "manageOneTenants.getByCompanyId",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  removeCompany: vi.fn(),
  currentUser: undefined as Doc<"users"> | undefined,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => {
    if (mutation === "companies.create") return mocks.createCompany;
    if (mutation === "companies.update") return mocks.updateCompany;
    if (mutation === "companies.remove") return mocks.removeCompany;
    return vi.fn();
  },
  useQuery: () => [],
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({
    currentUser: mocks.currentUser,
    isAdmin: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

function country(): Doc<"countries"> {
  return {
    _id: "country-1" as Id<"countries">,
    _creationTime: 1,
    name: "Somalia",
    region: "East Africa",
  };
}

function sector(): Doc<"sectors"> {
  return {
    _id: "sector-1" as Id<"sectors">,
    _creationTime: 1,
    name: "Cloud",
  };
}

function user(): Doc<"users"> {
  return {
    _id: "user-1" as Id<"users">,
    _creationTime: 1,
    tokenIdentifier: "user-token",
    name: "Amina Hassan",
    email: "amina@example.com",
    role: "account_manager",
  };
}

function company(
  overrides: Partial<Doc<"companies">> = {},
): Doc<"companies"> {
  return {
    _id: "company-1" as Id<"companies">,
    _creationTime: 1,
    name: "AICC",
    sectorId: "sector-1" as Id<"sectors">,
    countryId: "country-1" as Id<"countries">,
    accountManagerId: "user-1" as Id<"users">,
    contractStatus: "active",
    paymentStatus: "current",
    ...overrides,
  };
}

function renderCompanyForm(companyValue: Doc<"companies"> | null = null) {
  return render(
    <CompanyForm
      company={companyValue}
      countries={[country()]}
      sectors={[sector()]}
      users={[user()]}
      onFinished={vi.fn()}
    />,
  );
}

async function chooseSelectOption(label: RegExp | string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

async function chooseComboboxByIndex(index: number, option: string) {
  const user = userEvent.setup();
  const comboboxes = screen.getAllByRole("combobox");
  await user.click(comboboxes[index]);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("CompanyForm payment terms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCompany.mockResolvedValue("company-1");
    mocks.updateCompany.mockResolvedValue(undefined);
    mocks.removeCompany.mockResolvedValue(undefined);
    mocks.currentUser = user();
  });

  it("shows Default (Net 7) for companies without explicit payment terms", () => {
    renderCompanyForm();

    expect(screen.getByRole("combobox", { name: "Payment Terms" }))
      .toHaveTextContent("Default (Net 7)");
  });

  it("submits Net 15 when creating a company", async () => {
    const user = userEvent.setup();
    renderCompanyForm();

    await user.type(screen.getByPlaceholderText("e.g. Acme Corporation"), "AICC");
    await chooseComboboxByIndex(0, "Cloud");
    await chooseComboboxByIndex(1, "Somalia");
    await chooseSelectOption("Payment Terms", "Net 15");
    await user.click(screen.getByRole("button", { name: "Create Company" }));

    expect(mocks.createCompany).toHaveBeenCalledWith(
      expect.objectContaining({ paymentTermDays: 15 }),
    );
  });

  it("submits Net 30 when updating a company", async () => {
    const user = userEvent.setup();
    renderCompanyForm(company());

    await chooseSelectOption("Payment Terms", "Net 30");
    await user.click(screen.getByRole("button", { name: "Update Company" }));

    expect(mocks.updateCompany).toHaveBeenCalledWith(
      expect.objectContaining({ paymentTermDays: 30 }),
    );
  });

  it("clears explicit payment terms when Default is selected", async () => {
    const user = userEvent.setup();
    renderCompanyForm(company({ paymentTermDays: 30 }));

    await chooseSelectOption("Payment Terms", "Default (Net 7)");
    await user.click(screen.getByRole("button", { name: "Update Company" }));

    expect(mocks.updateCompany).toHaveBeenCalledWith(
      expect.objectContaining({ paymentTermDays: undefined }),
    );
  });
});
