import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import InvoiceProfilesPage from "./page.tsx";

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
    countries: { list: "countries.list" },
    invoiceProfiles: {
      listInvoiceProfiles: "invoiceProfiles.listInvoiceProfiles",
      createInvoiceProfile: "invoiceProfiles.createInvoiceProfile",
      updateInvoiceProfile: "invoiceProfiles.updateInvoiceProfile",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  countries: [] as Doc<"countries">[],
  profiles: undefined as Doc<"invoiceProfiles">[] | undefined,
  lastProfileQueryArgs: undefined as unknown,
  createInvoiceProfile: vi.fn(),
  updateInvoiceProfile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string, args: unknown) => {
    if (query === "countries.list") return mocks.countries;
    if (query === "invoiceProfiles.listInvoiceProfiles") {
      mocks.lastProfileQueryArgs = args;
      return mocks.profiles;
    }
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "invoiceProfiles.createInvoiceProfile") {
      return mocks.createInvoiceProfile;
    }
    if (mutation === "invoiceProfiles.updateInvoiceProfile") {
      return mocks.updateInvoiceProfile;
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

function country(id: string, name: string): Doc<"countries"> {
  return {
    _id: id as Id<"countries">,
    _creationTime: 1,
    name,
    region: "East Africa",
  };
}

function profile(
  id: string,
  overrides: Partial<Doc<"invoiceProfiles">> = {},
): Doc<"invoiceProfiles"> {
  return {
    _id: id as Id<"invoiceProfiles">,
    _creationTime: 1,
    name: "Somalia Profile",
    countryId: "country-so" as Id<"countries">,
    region: "East Africa",
    isDefault: true,
    isActive: true,
    legalName: "HTG CLOUDS LIMITED",
    logoPath: "/logo.svg",
    slogan: "Built for us, Ready for the World.",
    addressLines: ["HTG Clouds", "Mogadishu"],
    phone: "+252 61 5558484",
    email: "finance@htgclouds.com",
    website: "https://htgclouds.com/",
    taxId: "TIN-1",
    bankName: "Salaam Somali Bank",
    bankAccountNumber: "33111777",
    bankAccountName: "HTG CLOUDS LIMITED",
    bankLocation: "MOGADISHU - SOMALIA",
    currency: "USD",
    currencyNote: "All fees are listed in USD",
    paymentInstructions: "Please pay bills on due date.",
    footerText: "Thank you",
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
    <MemoryRouter initialEntries={["/finance/invoice-profiles"]}>
      <Routes>
        <Route
          path="/finance/invoice-profiles"
          element={
            <>
              <InvoiceProfilesPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillRequiredProfileFields(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Name"), "Kenya Profile");
  await user.type(within(dialog).getByLabelText("Legal name"), "HTG KENYA LTD");
  await user.type(within(dialog).getByLabelText("Phone"), "+254 700 000000");
  await user.type(
    within(dialog).getByLabelText("Email"),
    "billing@htgclouds.com",
  );
  await user.type(
    within(dialog).getByLabelText("Website"),
    "https://htgclouds.com/",
  );
  await user.type(
    within(dialog).getByLabelText("Address lines"),
    "HTG Kenya{enter}Nairobi",
  );
  await user.type(
    within(dialog).getByLabelText("Bank name"),
    "Salaam Somali Bank",
  );
  await user.type(
    within(dialog).getByLabelText("Bank account number"),
    "33111777",
  );
  await user.type(
    within(dialog).getByLabelText("Bank account name"),
    "HTG CLOUDS LIMITED",
  );
  await user.type(
    within(dialog).getByLabelText("Bank location"),
    "MOGADISHU - SOMALIA",
  );
  await user.clear(within(dialog).getByLabelText("Currency note"));
  await user.type(
    within(dialog).getByLabelText("Currency note"),
    "All fees are listed in USD",
  );
  await user.type(
    within(dialog).getByLabelText("Payment instructions"),
    "Please pay on due date.",
  );
}

describe("InvoiceProfilesPage", () => {
  beforeEach(() => {
    mocks.currentUser = crmUser("CEO", "ceo");
    mocks.countries = [
      country("country-so", "Somalia"),
      country("country-ke", "Kenya"),
    ];
    mocks.profiles = [
      profile("profile-1"),
      profile("profile-2", {
        name: "Old Profile",
        isActive: false,
        isDefault: false,
        countryId: undefined,
        region: undefined,
      }),
    ];
    mocks.createInvoiceProfile.mockReset().mockResolvedValue("profile-new");
    mocks.updateInvoiceProfile.mockReset().mockResolvedValue(undefined);
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  it("renders the route, profiles list, and admin actions", () => {
    renderPage();

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/finance/invoice-profiles",
    );
    expect(
      screen.getByRole("heading", { name: "Invoice Profiles" }),
    ).toBeInTheDocument();
    expect(mocks.lastProfileQueryArgs).toEqual({ includeInactive: true });
    expect(screen.getByText("Somalia Profile")).toBeInTheDocument();
    expect(screen.getByText("Somalia")).toBeInTheDocument();
    expect(screen.getByText("Old Profile")).toBeInTheDocument();
    expect(screen.getAllByText("33111777").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "New Profile" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });

  it("keeps non-admin users read-only", () => {
    mocks.currentUser = crmUser("AM", "account_manager");
    mocks.profiles = [profile("profile-1")];

    renderPage();

    expect(mocks.lastProfileQueryArgs).toEqual({ includeInactive: undefined });
    expect(
      screen.getByText(/Invoice profile management is limited to CEO and Head of Business/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Profile" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" }))
      .not.toBeInTheDocument();
  });

  it("creates an invoice profile and serializes address lines", async () => {
    const user = userEvent.setup();
    mocks.profiles = [];
    renderPage();

    await user.click(screen.getByRole("button", { name: "New Profile" }));
    await fillRequiredProfileFields(user);
    await user.click(screen.getByLabelText("Default profile"));
    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(mocks.createInvoiceProfile).toHaveBeenCalledWith({
      name: "Kenya Profile",
      countryId: undefined,
      region: undefined,
      isDefault: true,
      isActive: true,
      legalName: "HTG KENYA LTD",
      logoPath: undefined,
      slogan: undefined,
      addressLines: ["HTG Kenya", "Nairobi"],
      phone: "+254 700 000000",
      email: "billing@htgclouds.com",
      website: "https://htgclouds.com/",
      taxId: undefined,
      bankName: "Salaam Somali Bank",
      bankAccountNumber: "33111777",
      bankAccountName: "HTG CLOUDS LIMITED",
      bankLocation: "MOGADISHU - SOMALIA",
      currency: "USD",
      currencyNote: "All fees are listed in USD",
      paymentInstructions: "Please pay on due date.",
      footerText: undefined,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Invoice profile created");
  });

  it("edits profile fields", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Somalia Updated");
    await user.clear(within(dialog).getByLabelText("Region"));
    await user.type(within(dialog).getByLabelText("Region"), "Horn of Africa");
    await user.clear(within(dialog).getByLabelText("Address lines"));
    await user.type(
      within(dialog).getByLabelText("Address lines"),
      "HTG Clouds{enter}Airport Road",
    );
    await user.click(within(dialog).getByLabelText("Active"));
    await user.click(within(dialog).getByRole("button", { name: "Save Profile" }));

    expect(mocks.updateInvoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile-1",
        name: "Somalia Updated",
        countryId: "country-so",
        region: "Horn of Africa",
        isDefault: true,
        isActive: false,
        addressLines: ["HTG Clouds", "Airport Road"],
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Invoice profile updated");
  });

  it("shows backend validation errors as friendly toasts", async () => {
    const user = userEvent.setup();
    mocks.createInvoiceProfile.mockRejectedValueOnce(
      new Error("Only one active default profile is allowed"),
    );
    mocks.profiles = [];
    renderPage();

    await user.click(screen.getByRole("button", { name: "New Profile" }));
    await fillRequiredProfileFields(user);
    await user.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Only one active default profile is allowed",
    );
  });
});
