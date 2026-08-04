import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import InvoiceDetailPage from "./detail-page.tsx";

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    invoices: {
      getById: "invoices.getById",
      issueInvoice: "invoices.issueInvoice",
      recordPayment: "invoices.recordPayment",
      sendInvoiceEmail: "invoices.sendInvoiceEmail",
      listEvents: "invoices.listEvents",
      listPayments: "invoices.listPayments",
    },
    users: {
      listAll: "users.listAll",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  invoice: undefined as Doc<"invoices"> | null | undefined,
  events: undefined as Doc<"invoiceEvents">[] | undefined,
  payments: undefined as Doc<"invoicePayments">[] | undefined,
  users: undefined as Doc<"users">[] | undefined,
  issueInvoice: vi.fn(),
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
    if (mutation === "invoices.recordPayment") return mocks.recordPayment;
    return vi.fn();
  },
  useQuery: (query: string) => {
    if (query === "invoices.getById") return mocks.invoice;
    if (query === "invoices.listEvents") return mocks.events;
    if (query === "invoices.listPayments") return mocks.payments;
    if (query === "users.listAll") return mocks.users;
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
  overrides: Partial<Doc<"invoiceEvents">> = {},
): Doc<"invoiceEvents"> {
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
    recordedBy: "user-1" as Id<"users">,
    createdAt: Date.UTC(2026, 7, 4, 10, 30),
    ...overrides,
  };
}

function user(
  id: string,
  overrides: Partial<Doc<"users">> = {},
): Doc<"users"> {
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
    mocks.recordPayment.mockResolvedValue(undefined);
    mocks.sendInvoiceEmail.mockResolvedValue(undefined);
    mocks.payments = [];
    mocks.users = [user("user-1")];
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

    expect(screen.getByText("Source Quote").parentElement).toHaveTextContent(
      "Source Quote-",
    );
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

  it.each([
    "issued",
    "sent",
    "overdue",
    "partially_paid",
  ] as const)("shows Record Payment for %s invoices", (status) => {
    mocks.invoice = invoice({ status });

    renderDetailPage();

    expect(
      screen.getByRole("button", { name: "Record Payment" }),
    ).toBeInTheDocument();
  });

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
    expect(within(dialog).getByLabelText("Reference")).toBeInTheDocument();
  });

  it("records a valid payment and shows a success toast", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Record Payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record Payment" });
    await user.type(within(dialog).getByLabelText("Amount"), "250");
    await user.clear(within(dialog).getByLabelText("Payment date"));
    await user.type(within(dialog).getByLabelText("Payment date"), "2026-08-04");
    await user.type(within(dialog).getByLabelText("Reference"), "SSB-2002");
    await user.click(
      within(dialog).getByRole("button", { name: "Record Payment" }),
    );

    expect(mocks.recordPayment).toHaveBeenCalledWith({
      invoiceId: "invoice-1",
      amount: 250,
      paidAt: new Date("2026-08-04T00:00:00").getTime(),
      method: "Bank Transfer",
      reference: "SSB-2002",
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
      }),
    ];

    renderDetailPage();

    const history = screen
      .getByText("Payment History")
      .closest("[data-slot='card']");
    expect(history).not.toBeNull();
    expect(within(history as HTMLElement).getByText("$200.00")).toBeInTheDocument();
    expect(within(history as HTMLElement).getByText("Bank Transfer")).toBeInTheDocument();
    expect(within(history as HTMLElement).getByText("SSB-1001")).toBeInTheDocument();
    expect(within(history as HTMLElement).getAllByText("Amina Recorder").length).toBeGreaterThan(0);
    expect(within(history as HTMLElement).queryByText("user-1")).not.toBeInTheDocument();
    expect(within(history as HTMLElement).getByText("$50.00")).toBeInTheDocument();
    expect(within(history as HTMLElement).getByText("Cash")).toBeInTheDocument();
  });

  it("falls back to recorder email or generic label without exposing raw ids", () => {
    mocks.payments = [
      invoicePayment("payment-1"),
      invoicePayment("payment-2", {
        recordedBy: "user-2" as Id<"users">,
        amount: 50,
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
    expect(within(history as HTMLElement).queryByText("user-1")).not.toBeInTheDocument();
    expect(within(history as HTMLElement).queryByText("user-2")).not.toBeInTheDocument();
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
