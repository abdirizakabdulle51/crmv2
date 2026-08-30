import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import InvoiceDetailPage from "./detail-page.tsx";

type InvoiceEvent = Doc<"invoiceEvents"> & {
  actorEmail?: string;
  actorName?: string;
};

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    invoices: {
      getById: "invoices.getById",
      issueInvoice: "invoices.issueInvoice",
      cancelDraftInvoice: "invoices.cancelDraftInvoice",
      voidInvoice: "invoices.voidInvoice",
      setInvoiceTestMode: "invoices.setInvoiceTestMode",
      recordPayment: "invoices.recordPayment",
      sendInvoiceEmail: "invoices.sendInvoiceEmail",
      listEvents: "invoices.listEvents",
      listPayments: "invoices.listPayments",
    },
    users: {
      listAll: "users.listAll",
      getCurrentUser: "users.getCurrentUser",
    },
    customerContracts: {
      getByContractNumber: "customerContracts.getByContractNumber",
    },
    receivingAccounts: { list: "receivingAccounts.list" },
    companies: { getById: "companies.getById" },
  },
}));

const mocks = vi.hoisted(() => ({
  invoice: undefined as Doc<"invoices"> | null | undefined,
  events: undefined as InvoiceEvent[] | undefined,
  payments: undefined as Doc<"invoicePayments">[] | undefined,
  users: undefined as Doc<"users">[] | undefined,
  sourceContract: null as Doc<"customerContracts"> | null,
  currentUser: undefined as Doc<"users"> | null | undefined,
  receivingAccounts: [] as Doc<"receivingAccounts">[],
  invoiceCompany: undefined as Doc<"companies"> | undefined,
  issueInvoice: vi.fn(),
  cancelDraftInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  setInvoiceTestMode: vi.fn(),
  recordPayment: vi.fn(),
  sendInvoiceEmail: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: (action: string) => {
    if (action === "invoices.sendInvoiceEmail") return mocks.sendInvoiceEmail;
    return vi.fn();
  },
  useMutation: (mutation: string) => {
    if (mutation === "invoices.issueInvoice") return mocks.issueInvoice;
    if (mutation === "invoices.cancelDraftInvoice")
      return mocks.cancelDraftInvoice;
    if (mutation === "invoices.voidInvoice") return mocks.voidInvoice;
    if (mutation === "invoices.setInvoiceTestMode")
      return mocks.setInvoiceTestMode;
    if (mutation === "invoices.recordPayment") return mocks.recordPayment;
    return vi.fn();
  },
  useQuery: (query: string) => {
    if (query === "invoices.getById") return mocks.invoice;
    if (query === "invoices.listEvents") return mocks.events;
    if (query === "invoices.listPayments") return mocks.payments;
    if (query === "users.listAll") return mocks.users;
    if (query === "users.getCurrentUser") return mocks.currentUser;
    if (query === "customerContracts.getByContractNumber")
      return mocks.sourceContract;
    if (query === "receivingAccounts.list") return mocks.receivingAccounts;
    if (query === "companies.getById") return mocks.invoiceCompany;
    return undefined;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
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

function invoice(overrides: Partial<Doc<"invoices">> = {}): Doc<"invoices"> {
  return {
    _id: "invoice-1" as Id<"invoices">,
    _creationTime: 1,
    companyId: "company-1" as Id<"companies">,
    sourceQuoteId: "quote-1" as Id<"quotes">,
    sourceMonth: "2026-07",
    sourceReference: "Q-2026-00001",
    createdBy: "user-1" as Id<"users">,
    invoiceNumber: "INV-2026-00001",
    status: "issued",
    issueDate: Date.UTC(2026, 7, 1, 9, 0),
    dueDate: Date.UTC(2026, 7, 31),
    lockedAt: Date.UTC(2026, 7, 1, 9, 5),
    companyName: "Hormuud",
    contactName: "Amina Yusuf",
    contactEmail: "amina@example.com",
    billingEmail: "billing@example.com",
    billingAddress: "Mogadishu",
    taxId: "TIN-123",
    lineItems: [
      {
        catalogItemId: "catalog-1" as Id<"serviceCatalog">,
        itemName: "Cloud Server",
        serviceCategory: "Compute",
        billingUnit: "month",
        quantity: 2,
        monthlyUnitPrice: 600,
        monthlyTotal: 1200,
        yearlyTotal: 14400,
      },
    ],
    subtotal: 1200,
    monthlyTotal: 1200,
    yearlyTotal: 14400,
    grandTotal: 1200,
    amountPaid: 200,
    balanceDue: 1000,
    notes: "Invoice copied from accepted quote.",
    createdAt: Date.UTC(2026, 7, 1, 8, 45),
    updatedAt: Date.UTC(2026, 7, 1, 9, 5),
    ...overrides,
  };
}

function invoiceEvent(
  id: string,
  overrides: Partial<InvoiceEvent> = {},
): InvoiceEvent {
  return {
    _id: id as Id<"invoiceEvents">,
    _creationTime: 1,
    invoiceId: "invoice-1" as Id<"invoices">,
    type: "draft_created",
    actorId: "user-1" as Id<"users">,
    message: "Draft invoice created from quote Q-2026-00001.",
    createdAt: Date.UTC(2026, 7, 1, 8, 45),
    ...overrides,
  };
}

function invoicePayment(
  id: string,
  overrides: Partial<Doc<"invoicePayments">> = {},
): Doc<"invoicePayments"> {
  return {
    _id: id as Id<"invoicePayments">,
    _creationTime: 1,
    invoiceId: "invoice-1" as Id<"invoices">,
    amount: 200,
    paidAt: Date.UTC(2026, 7, 4),
    method: "Bank Transfer",
    reference: "SSB-1001",
    receivingBankName: "Salaam Somali Bank",
    receivingAccountNumber: "33111777",
    receivingAccountName: "HTG CLOUDS LIMITED",
    receivingBankLocation: "MOGADISHU - SOMALIA",
    receivingCurrencyNote: "All fees are listed in USD",
    recordedBy: "user-1" as Id<"users">,
    createdAt: Date.UTC(2026, 7, 4, 10, 30),
    ...overrides,
  };
}

function user(id: string, overrides: Partial<Doc<"users">> = {}): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    tokenIdentifier: `${id}-token`,
    name: "Amina Recorder",
    email: "amina.recorder@example.com",
    role: "account_manager",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderDetailPage(initialEntry = "/invoices/invoice-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/invoices/:invoiceId"
          element={
            <>
              <InvoiceDetailPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/invoices/:invoiceId/print"
          element={
            <>
              <div>Invoice Print</div>
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

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoice = invoice();
    mocks.issueInvoice.mockResolvedValue(undefined);
    mocks.cancelDraftInvoice.mockResolvedValue(undefined);
    mocks.voidInvoice.mockResolvedValue(undefined);
    mocks.setInvoiceTestMode.mockResolvedValue(undefined);
    mocks.recordPayment.mockResolvedValue(undefined);
    mocks.receivingAccounts = [
      {
        _id: "account-1" as Id<"receivingAccounts">,
        _creationTime: 1,
        countryId: "country-1" as Id<"countries">,
        name: "Salaam Bank USD",
        providerName: "Salaam Somali Bank",
        accountNumber: "33111777",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        currency: "USD",
        isActive: true,
        createdBy: "user-ceo" as Id<"users">,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "account-2" as Id<"receivingAccounts">,
        _creationTime: 1,
        countryId: "country-1" as Id<"countries">,
        name: "ZAAD USD",
        providerName: "ZAAD",
        accountNumber: "252610000000",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "mobile_money",
        currency: "USD",
        isActive: true,
        createdBy: "user-ceo" as Id<"users">,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    mocks.invoiceCompany = {
      _id: "company-1" as Id<"companies">,
      _creationTime: 1,
      name: "Company A",
      countryId: "country-1" as Id<"countries">,
      sectorId: "sector-1" as Id<"sectors">,
      accountManagerId: "user-1" as Id<"users">,
      contractStatus: "active",
    };
    mocks.sendInvoiceEmail.mockResolvedValue(undefined);
    mocks.payments = [];
    mocks.currentUser = user("ceo-user", { role: "ceo" });
    mocks.users = [user("user-1"), mocks.currentUser];
    mocks.events = [
      invoiceEvent("event-1"),
      invoiceEvent("event-2", {
        type: "issued",
        message: "Invoice issued.",
        createdAt: Date.UTC(2026, 7, 1, 9, 5),
      }),
    ];
  });

  it("renders invoice details at /invoices/:invoiceId", () => {
    renderDetailPage();

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/invoices/invoice-1",
    );
    expect(
      screen.getByRole("heading", { name: "INV-2026-00001" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Issued").length).toBeGreaterThan(0);
    expect(screen.getByText("Customer Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Hormuud")).toBeInTheDocument();
    expect(screen.getByText("Amina Yusuf")).toBeInTheDocument();
    expect(screen.getByText("billing@example.com")).toBeInTheDocument();
    expect(screen.getByText("Q-2026-00001")).toBeInTheDocument();
    expect(screen.queryByText("quote-1")).not.toBeInTheDocument();
  });

  it("shows a safe fallback for legacy invoices without a source reference", () => {
    mocks.invoice = invoice({ sourceReference: undefined });
    mocks.events = [];

    renderDetailPage();

    expect(
      screen.getByText("Source Reference").parentElement,
    ).toHaveTextContent("Source Reference-");
    expect(screen.queryByText("quote-1")).not.toBeInTheDocument();
  });

  it("renders line items, totals, notes, and event history", () => {
    renderDetailPage();

    expect(screen.getByText("Line Item Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Cloud Server")).toBeInTheDocument();
    expect(screen.getByText("Compute")).toBeInTheDocument();
    expect(screen.getByText("month")).toBeInTheDocument();
    expect(screen.getAllByText("$1,200.00").length).toBeGreaterThan(0);
    expect(screen.getByText("$200.00")).toBeInTheDocument();
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Payment History")).toBeInTheDocument();
    expect(screen.getByText("No payments recorded yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Invoice copied from accepted quote."),
    ).toBeInTheDocument();

    const events = screen
      .getByText("Invoice Events")
      .closest("[data-slot='card']");
    expect(events).not.toBeNull();
    expect(
      within(events as HTMLElement).getByText("Draft created"),
    ).toBeInTheDocument();
    expect(
      within(events as HTMLElement).getByText("Invoice issued."),
    ).toBeInTheDocument();
  });

  it("keeps the legacy line item table layout when no region metadata exists", () => {
    renderDetailPage();

    const lineItemsCard = screen
      .getByText("Line Item Snapshot")
      .closest("[data-slot='card']");
    expect(lineItemsCard).not.toBeNull();
    expect(
      within(lineItemsCard as HTMLElement).queryByText("Region"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Region Totals")).not.toBeInTheDocument();
  });

  it("shows region column and region totals when invoice line items include region metadata", () => {
    mocks.invoice = invoice({
      lineItems: [
        {
          catalogItemId: "catalog-1" as Id<"serviceCatalog">,
          itemName: "Cloud Server",
          serviceCategory: "Compute",
          billingUnit: "month",
          quantity: 2,
          monthlyUnitPrice: 600,
          monthlyTotal: 1200,
          yearlyTotal: 14400,
          regionId: "hoa-mog-2",
          regionName: "Hoa-Mogadishu-2",
          dataCenterName: "Mogadishu DC 2",
        },
        {
          catalogItemId: "catalog-2" as Id<"serviceCatalog">,
          itemName: "Block Storage",
          serviceCategory: "Storage",
          billingUnit: "GB",
          quantity: 100,
          monthlyUnitPrice: 2,
          monthlyTotal: 200,
          yearlyTotal: 2400,
          regionId: "mog-hq3",
          regionName: "Mogadishu-region-hq3",
        },
        {
          catalogItemId: "catalog-3" as Id<"serviceCatalog">,
          itemName: "Backup",
          serviceCategory: "Backup",
          billingUnit: "GB",
          quantity: 50,
          monthlyUnitPrice: 1,
          monthlyTotal: 50,
          yearlyTotal: 600,
        },
        {
          catalogItemId: "catalog-4" as Id<"serviceCatalog">,
          itemName: "More Compute",
          serviceCategory: "Compute",
          billingUnit: "month",
          quantity: 1,
          monthlyUnitPrice: 300,
          monthlyTotal: 300,
          yearlyTotal: 3600,
          regionName: "Hoa-Mogadishu-2",
        },
      ],
      subtotal: 1750,
      monthlyTotal: 1750,
      grandTotal: 1750,
      balanceDue: 1550,
    });

    renderDetailPage();

    const lineItemsCard = screen
      .getByText("Line Item Snapshot")
      .closest("[data-slot='card']");
    expect(lineItemsCard).not.toBeNull();
    expect(
      within(lineItemsCard as HTMLElement).getByText("Region"),
    ).toBeInTheDocument();
    expect(
      within(lineItemsCard as HTMLElement).getAllByText("Hoa-Mogadishu-2"),
    ).toHaveLength(2);
    expect(
      within(lineItemsCard as HTMLElement).getByText("Mogadishu-region-hq3"),
    ).toBeInTheDocument();
    expect(
      within(lineItemsCard as HTMLElement).getByText("Unassigned"),
    ).toBeInTheDocument();

    const regionTotals = screen
      .getByText("Region Totals")
      .closest("[data-slot='card']");
    expect(regionTotals).not.toBeNull();
    expect(
      within(regionTotals as HTMLElement).getByText("Hoa-Mogadishu-2"),
    ).toBeInTheDocument();
    expect(
      within(regionTotals as HTMLElement).getByText("$1,500.00"),
    ).toBeInTheDocument();
    expect(
      within(regionTotals as HTMLElement).getByText("Mogadishu-region-hq3"),
    ).toBeInTheDocument();
    expect(
      within(regionTotals as HTMLElement).getByText("$200.00"),
    ).toBeInTheDocument();
    expect(
      within(regionTotals as HTMLElement).getByText("Unassigned"),
    ).toBeInTheDocument();
    expect(
      within(regionTotals as HTMLElement).getByText("$50.00"),
    ).toBeInTheDocument();
  });

  it("shows Draft when an invoice has no invoice number", () => {
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    renderDetailPage();

    expect(screen.getByRole("heading", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });

  it("shows Issue Invoice for draft invoices", () => {
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    renderDetailPage();

    expect(
      screen.getByRole("button", { name: "Issue Invoice" }),
    ).toBeInTheDocument();
  });

  it("does not show Issue Invoice for issued invoices", () => {
    renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Issue Invoice" }),
    ).not.toBeInTheDocument();
  });

  it("navigates to the invoice print page from Print / Export PDF", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(
      screen.getByRole("button", { name: "Print / Export PDF" }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/invoices/invoice-1/print",
    );
  });

  it("shows Send Invoice for issued invoices", () => {
    renderDetailPage();

    expect(
      screen.getByRole("button", { name: "Send Invoice" }),
    ).toBeInTheDocument();
  });

  it("does not show Send Invoice for draft or sent invoices", () => {
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    const { rerender } = renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Send Invoice" }),
    ).not.toBeInTheDocument();

    mocks.invoice = invoice({ status: "sent", sentAt: Date.UTC(2026, 7, 2) });
    rerender(
      <MemoryRouter initialEntries={["/invoices/invoice-1"]}>
        <Routes>
          <Route
            path="/invoices/:invoiceId"
            element={
              <>
                <InvoiceDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: "Send Invoice" }),
    ).not.toBeInTheDocument();
  });

  it.each(["issued", "sent", "overdue", "partially_paid"] as const)(
    "shows Record Payment for %s invoices",
    (status) => {
      mocks.invoice = invoice({ status });

      renderDetailPage();

      expect(
        screen.getByRole("button", { name: "Record Payment" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["draft", "paid", "void", "cancelled"] as const)(
    "hides Record Payment for %s invoices",
    (status) => {
      mocks.invoice = invoice({ status });

      renderDetailPage();

      expect(
        screen.queryByRole("button", { name: "Record Payment" }),
      ).not.toBeInTheDocument();
    },
  );

  it("opens the payment dialog with balance due context", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Record Payment" }));

    const dialog = screen.getByRole("dialog", { name: "Record Payment" });
    expect(within(dialog).getByText("Current balance due")).toBeInTheDocument();
    expect(within(dialog).getByText("$1,000.00")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Amount")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Payment date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Payment method")).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Internal note (optional)"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Paid into account"),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Transaction ID")).toBeInTheDocument();
  });

  it("shows only supported payment methods and hides bank details for Mobile Money", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Record Payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record Payment" });
    await user.click(within(dialog).getByLabelText("Payment method"));

    expect(
      screen.getByRole("option", { name: "Bank Transfer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Mobile Money" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Cash" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Card" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Other" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Mobile Money" }));
    expect(
      within(dialog).getByLabelText("Paid into account"),
    ).toBeInTheDocument();
  });

  it("records a valid payment and shows a success toast", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Record Payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record Payment" });
    await user.type(within(dialog).getByLabelText("Amount"), "250");
    await user.clear(within(dialog).getByLabelText("Payment date"));
    await user.type(
      within(dialog).getByLabelText("Payment date"),
      "2026-08-04",
    );
    await user.type(
      within(dialog).getByLabelText("Internal note (optional)"),
      "Customer confirmed",
    );
    await user.click(within(dialog).getByLabelText("Paid into account"));
    await user.click(screen.getByRole("option", { name: /Salaam Bank USD/ }));
    await user.type(
      within(dialog).getByLabelText("Transaction ID"),
      "SSB-2002",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record Payment" }),
    );

    expect(mocks.recordPayment).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      amount: 250,
      paidAt: new Date("2026-08-04T00:00:00").getTime(),
      method: "Bank Transfer",
      reference: "Customer confirmed",
      receivingAccountId: "account-1",
      transactionId: "SSB-2002",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Payment recorded");
  });

  it("blocks over-balance payment submission in the dialog", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Record Payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record Payment" });
    await user.type(within(dialog).getByLabelText("Amount"), "1001");

    expect(
      within(dialog).getByText("Payment cannot exceed the balance due."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Record Payment" }),
    ).toBeDisabled();
    expect(mocks.recordPayment).not.toHaveBeenCalled();
  });

  it("shows an error toast if recording payment fails", async () => {
    const user = userEvent.setup();
    mocks.recordPayment.mockRejectedValue(new Error("FORBIDDEN"));
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Record Payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record Payment" });
    await user.type(within(dialog).getByLabelText("Amount"), "100");
    await user.click(within(dialog).getByLabelText("Paid into account"));
    await user.click(screen.getByRole("option", { name: /Salaam Bank USD/ }));
    await user.type(within(dialog).getByLabelText("Transaction ID"), "FAIL-1");
    await user.click(
      within(dialog).getByRole("button", { name: "Record Payment" }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
  });

  it("renders payment history", () => {
    mocks.payments = [
      invoicePayment("payment-1"),
      invoicePayment("payment-2", {
        amount: 50,
        paidAt: Date.UTC(2026, 7, 5),
        method: "Cash",
        reference: undefined,
        receivingBankName: undefined,
        receivingAccountNumber: undefined,
        receivingAccountName: undefined,
        receivingBankLocation: undefined,
        receivingCurrencyNote: undefined,
      }),
    ];

    renderDetailPage();

    const history = screen
      .getByText("Payment History")
      .closest("[data-slot='card']");
    expect(history).not.toBeNull();
    expect(
      within(history as HTMLElement).getByText("$200.00"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getByText("Bank Transfer"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getByText("SSB-1001"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getByText(
        /Salaam Somali Bank \/ ACCOUNT # = 33111777 \/ ACC\. NAME = HTG CLOUDS LIMITED/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getAllByText("Amina Recorder").length,
    ).toBeGreaterThan(0);
    expect(
      within(history as HTMLElement).queryByText("user-1"),
    ).not.toBeInTheDocument();
    expect(
      within(history as HTMLElement).getByText("$50.00"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getByText("Cash"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getAllByText("-").length,
    ).toBeGreaterThan(0);
  });

  it("falls back to recorder email or generic label without exposing raw ids", () => {
    mocks.payments = [
      invoicePayment("payment-1"),
      invoicePayment("payment-2", {
        recordedBy: "user-2" as Id<"users">,
        amount: 50,
        receivingBankName: undefined,
        receivingAccountNumber: undefined,
        receivingAccountName: undefined,
        receivingBankLocation: undefined,
        receivingCurrencyNote: undefined,
      }),
    ];
    mocks.users = [
      user("user-1", {
        name: undefined,
        email: "payments@example.com",
      }),
    ];

    renderDetailPage();

    const history = screen
      .getByText("Payment History")
      .closest("[data-slot='card']");
    expect(history).not.toBeNull();
    expect(
      within(history as HTMLElement).getByText("payments@example.com"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).getByText("Recorded user"),
    ).toBeInTheDocument();
    expect(
      within(history as HTMLElement).queryByText("user-1"),
    ).not.toBeInTheDocument();
    expect(
      within(history as HTMLElement).queryByText("user-2"),
    ).not.toBeInTheDocument();
  });

  it("opens confirmation before issuing a draft invoice", async () => {
    const user = userEvent.setup();
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Issue Invoice" }));

    expect(
      screen.getByRole("alertdialog", {
        name: "Issue and lock this invoice?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Issuing will lock the invoice/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Locked invoices cannot be edited."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The invoice will receive an invoice number."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This does not send email yet."),
    ).toBeInTheDocument();
  });

  it("does not call issueInvoice when confirmation is canceled", async () => {
    const user = userEvent.setup();
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Issue Invoice" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("confirms issuing and shows a success toast", async () => {
    const user = userEvent.setup();
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Issue Invoice" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Issue Invoice",
      }),
    );

    expect(mocks.issueInvoice).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Invoice issued and locked",
    );
  });

  it("shows an error toast if issuing fails", async () => {
    const user = userEvent.setup();
    mocks.invoice = invoice({
      invoiceNumber: undefined,
      status: "draft",
      issueDate: undefined,
      lockedAt: undefined,
    });
    mocks.issueInvoice.mockRejectedValue(new Error("Invoice must be draft"));

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Issue Invoice" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Issue Invoice",
      }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith("Invoice must be draft");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/invoices/invoice-1",
    );
  });

  it("opens confirmation with invoice number and recipient before sending", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Send Invoice" }));

    expect(
      screen.getByRole("alertdialog", { name: "Send this invoice?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This will email invoice INV-2026-00001 to billing@example.com.",
      ),
    ).toBeInTheDocument();
  });

  it("confirms sending and shows a success toast", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Send Invoice" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Send Invoice",
      }),
    );

    expect(mocks.sendInvoiceEmail).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Invoice sent");
  });

  it("shows an error toast if sending fails", async () => {
    const user = userEvent.setup();
    mocks.sendInvoiceEmail.mockRejectedValue(
      new Error("Invoice email delivery failed"),
    );

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Send Invoice" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Send Invoice",
      }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Invoice email delivery failed",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/invoices/invoice-1",
    );
  });

  it("shows admin cleanup actions only for CEO or HOB users and valid statuses", () => {
    mocks.invoice = invoice({ status: "draft", invoiceNumber: undefined });
    renderDetailPage();

    expect(
      screen.getByRole("button", { name: "Cancel Draft" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Void Invoice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark as Test" }),
    ).toBeInTheDocument();

    cleanup();
    mocks.invoice = invoice({ status: "issued" });
    renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Cancel Draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Void Invoice" }),
    ).toBeInTheDocument();
  });

  it("hides admin cleanup actions for AM and Country GM users", () => {
    mocks.currentUser = user("gm-user", { role: "country_gm" });
    renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Void Invoice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark as Test" }),
    ).not.toBeInTheDocument();

    cleanup();
    mocks.currentUser = user("am-user", { role: "account_manager" });
    mocks.invoice = invoice({ status: "draft", invoiceNumber: undefined });
    renderDetailPage();

    expect(
      screen.queryByRole("button", { name: "Cancel Draft" }),
    ).not.toBeInTheDocument();
  });

  it("requires a reason and cancels a draft invoice through the admin cleanup dialog", async () => {
    const user = userEvent.setup();
    mocks.invoice = invoice({ status: "draft", invoiceNumber: undefined });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Cancel Draft" }));
    const dialog = screen.getByRole("dialog", {
      name: "Cancel draft invoice?",
    });
    expect(
      within(dialog).getByText(
        /This does not delete the invoice. It keeps the invoice snapshot/i,
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Cancel Draft" }),
    );
    expect(mocks.cancelDraftInvoice).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Cleanup reason is required");

    await user.type(
      within(dialog).getByLabelText("Reason"),
      "Duplicate test invoice",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel Draft" }),
    );

    expect(mocks.cancelDraftInvoice).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      reason: "Duplicate test invoice",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Draft invoice cancelled");
  });

  it("voids an eligible invoice through the admin cleanup dialog", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Void Invoice" }));
    const dialog = screen.getByRole("dialog", { name: "Void invoice?" });
    await user.type(
      within(dialog).getByLabelText("Reason"),
      "Customer requested correction",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Void Invoice" }),
    );

    expect(mocks.voidInvoice).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      reason: "Customer requested correction",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Invoice voided");
  });

  it("marks and unmarks an invoice as test/hidden from the detail page", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Mark as Test" }));
    let dialog = screen.getByRole("dialog", {
      name: "Mark invoice as test/hidden?",
    });
    await user.type(within(dialog).getByLabelText("Reason"), "Training data");
    await user.click(
      within(dialog).getByRole("button", { name: "Mark as Test" }),
    );

    expect(mocks.setInvoiceTestMode).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      isTest: true,
      reason: "Training data",
    });

    cleanup();
    mocks.invoice = invoice({ isTest: true, hiddenAt: Date.UTC(2026, 7, 5) });
    renderDetailPage();

    expect(screen.getAllByText("Test/Hidden").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Unmark Test" }));
    dialog = screen.getByRole("dialog", {
      name: "Unmark invoice as test/hidden?",
    });
    await user.type(within(dialog).getByLabelText("Reason"), "Real invoice");
    await user.click(
      within(dialog).getByRole("button", { name: "Unmark Test" }),
    );

    expect(mocks.setInvoiceTestMode).toHaveBeenLastCalledWith({
      invoiceId: "invoice-1",
      isTest: false,
      reason: "Real invoice",
    });
  });

  it("renders cleanup event labels and reasons", () => {
    mocks.events = [
      invoiceEvent("event-1", {
        type: "cancelled",
        actorName: "Abdirizak Abdulle",
        message: "Draft invoice cancelled. Reason: Duplicate",
      }),
      invoiceEvent("event-2", {
        type: "marked_test",
        actorName: "Abdirizak Abdulle",
        message: "Invoice marked as test/hidden. Reason: Training",
      }),
      invoiceEvent("event-3", {
        type: "unmarked_test",
        actorEmail: "admin@example.com",
        message: "Invoice unmarked as test/hidden. Reason: Real",
      }),
    ];

    renderDetailPage();

    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Marked test")).toBeInTheDocument();
    expect(screen.getByText("Unmarked test")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Invoice marked as test/hidden by Abdirizak Abdulle. Reason: Training",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Invoice unmarked as test/hidden by admin@example.com. Reason: Real",
      ),
    ).toBeInTheDocument();
  });

  it("shows an unavailable state for a missing invoice", () => {
    mocks.invoice = null;
    mocks.events = [];

    renderDetailPage();

    expect(
      screen.getByText("Invoice not found or unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This invoice may not exist, or you may not have access to view it.",
      ),
    ).toBeInTheDocument();
  });

  it("returns to the invoice list from the detail page", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Back to Invoices" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/invoices");
  });
});
