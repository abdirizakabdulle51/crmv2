import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import ExpenseDetailPage from "./detail-page.tsx";

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
      getExpenseRequest: "expenses.getExpenseRequest",
      listExpenseEvents: "expenses.listExpenseEvents",
      listReceipts: "expenses.listReceipts",
      listExpenseCategories: "expenses.listExpenseCategories",
      updateDraftExpenseRequest: "expenses.updateDraftExpenseRequest",
      submitExpenseRequest: "expenses.submitExpenseRequest",
      approveExpenseRequest: "expenses.approveExpenseRequest",
      rejectExpenseRequest: "expenses.rejectExpenseRequest",
      cancelExpenseRequest: "expenses.cancelExpenseRequest",
      markExpensePaid: "expenses.markExpensePaid",
      generateReceiptUploadUrl: "expenses.generateReceiptUploadUrl",
      saveReceiptMetadata: "expenses.saveReceiptMetadata",
      getReceiptDownloadUrl: "expenses.getReceiptDownloadUrl",
      archiveReceipt: "expenses.archiveReceipt",
    },
    users: { listAll: "users.listAll" },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  expense: undefined as Doc<"expenseRequests"> | null | undefined,
  events: undefined as Doc<"expenseEvents">[] | undefined,
  receipts: undefined as Doc<"expenseReceipts">[] | undefined,
  categories: [] as Doc<"expenseCategories">[],
  users: [] as Doc<"users">[],
  companies: [] as Doc<"companies">[],
  countries: [] as Doc<"countries">[],
  updateDraftExpenseRequest: vi.fn(),
  submitExpenseRequest: vi.fn(),
  approveExpenseRequest: vi.fn(),
  rejectExpenseRequest: vi.fn(),
  cancelExpenseRequest: vi.fn(),
  markExpensePaid: vi.fn(),
  generateReceiptUploadUrl: vi.fn(),
  saveReceiptMetadata: vi.fn(),
  archiveReceipt: vi.fn(),
  convexQuery: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.convexQuery }),
  useQuery: (query: string) => {
    if (query === "expenses.getExpenseRequest") return mocks.expense;
    if (query === "expenses.listExpenseEvents") return mocks.events;
    if (query === "expenses.listReceipts") return mocks.receipts;
    if (query === "expenses.listExpenseCategories") return mocks.categories;
    if (query === "users.listAll") return mocks.users;
    if (query === "companies.list") return mocks.companies;
    if (query === "countries.list") return mocks.countries;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "expenses.updateDraftExpenseRequest")
      return mocks.updateDraftExpenseRequest;
    if (mutation === "expenses.submitExpenseRequest")
      return mocks.submitExpenseRequest;
    if (mutation === "expenses.approveExpenseRequest")
      return mocks.approveExpenseRequest;
    if (mutation === "expenses.rejectExpenseRequest")
      return mocks.rejectExpenseRequest;
    if (mutation === "expenses.cancelExpenseRequest")
      return mocks.cancelExpenseRequest;
    if (mutation === "expenses.markExpensePaid") return mocks.markExpensePaid;
    if (mutation === "expenses.generateReceiptUploadUrl")
      return mocks.generateReceiptUploadUrl;
    if (mutation === "expenses.saveReceiptMetadata")
      return mocks.saveReceiptMetadata;
    if (mutation === "expenses.archiveReceipt") return mocks.archiveReceipt;
    return vi.fn();
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

function crmUser(
  id: string,
  role: Doc<"users">["role"],
  name: string,
): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    tokenIdentifier: `${id}-token`,
    name,
    email: `${id}@example.com`,
    role,
  };
}

function category(id: string, name: string): Doc<"expenseCategories"> {
  return {
    _id: id as Id<"expenseCategories">,
    _creationTime: 1,
    name,
    isActive: true,
    createdBy: "ceo" as Id<"users">,
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
    accountManagerId: "am" as Id<"users">,
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
  overrides: Partial<Doc<"expenseRequests">> = {},
): Doc<"expenseRequests"> {
  return {
    _id: "expense-1" as Id<"expenseRequests">,
    _creationTime: 1,
    title: "Customer visit taxi",
    description: "Taxi to customer meeting",
    categoryId: "category-1" as Id<"expenseCategories">,
    amount: 25,
    currency: "USD",
    expenseDate: Date.UTC(2026, 7, 5),
    vendor: "Taxi Co",
    requestedBy: "am" as Id<"users">,
    companyId: "company-1" as Id<"companies">,
    countryId: "country-1" as Id<"countries">,
    status: "draft",
    createdAt: Date.UTC(2026, 7, 5, 8),
    updatedAt: Date.UTC(2026, 7, 5, 8),
    ...overrides,
  };
}

function event(
  id: string,
  overrides: Partial<Doc<"expenseEvents">> = {},
): Doc<"expenseEvents"> {
  return {
    _id: id as Id<"expenseEvents">,
    _creationTime: 1,
    expenseId: "expense-1" as Id<"expenseRequests">,
    type: "created",
    message: "Expense request created.",
    actorId: "am" as Id<"users">,
    createdAt: Date.UTC(2026, 7, 5, 8),
    ...overrides,
  };
}

function receipt(
  id: string,
  overrides: Partial<Doc<"expenseReceipts">> = {},
): Doc<"expenseReceipts"> {
  return {
    _id: id as Id<"expenseReceipts">,
    _creationTime: 1,
    expenseId: "expense-1" as Id<"expenseRequests">,
    storageId: `storage-${id}` as Id<"_storage">,
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    size: 2048,
    uploadedBy: "am" as Id<"users">,
    uploadedAt: Date.UTC(2026, 7, 5, 9),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderDetailPage() {
  return render(
    <MemoryRouter initialEntries={["/finance/expenses/expense-1"]}>
      <Routes>
        <Route
          path="/finance/expenses/:expenseId"
          element={
            <>
              <ExpenseDetailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function expectDetailValue(label: string, value: string) {
  const detail = screen.getByText(label).parentElement;
  expect(detail).toBeTruthy();
  expect(within(detail as HTMLElement).getByText(value)).toBeInTheDocument();
}

describe("ExpenseDetailPage", () => {
  beforeEach(() => {
    mocks.currentUser = crmUser("am", "account_manager", "Amina");
    mocks.expense = expense();
    mocks.events = [event("event-1")];
    mocks.receipts = [];
    mocks.categories = [category("category-1", "Travel")];
    mocks.users = [
      crmUser("am", "account_manager", "Amina"),
      crmUser("gm", "country_gm", "GM"),
      crmUser("ceo", "ceo", "CEO"),
    ];
    mocks.companies = [company("company-1", "Hormuud")];
    mocks.countries = [country("country-1", "Somalia")];
    mocks.updateDraftExpenseRequest.mockReset().mockResolvedValue(undefined);
    mocks.submitExpenseRequest.mockReset().mockResolvedValue(undefined);
    mocks.approveExpenseRequest.mockReset().mockResolvedValue(undefined);
    mocks.rejectExpenseRequest.mockReset().mockResolvedValue(undefined);
    mocks.cancelExpenseRequest.mockReset().mockResolvedValue(undefined);
    mocks.markExpensePaid.mockReset().mockResolvedValue(undefined);
    mocks.generateReceiptUploadUrl.mockReset().mockResolvedValue("https://upload.example");
    mocks.saveReceiptMetadata.mockReset().mockResolvedValue("receipt-new");
    mocks.archiveReceipt.mockReset().mockResolvedValue(undefined);
    mocks.convexQuery.mockReset().mockResolvedValue("https://download.example/receipt.pdf");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage-new" }),
      }),
    );
    vi.stubGlobal("open", vi.fn());
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  it("renders expense details and audit events", () => {
    renderDetailPage();

    expect(screen.getByRole("heading", { name: "Customer visit taxi" }))
      .toBeInTheDocument();
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("Amina")).toBeInTheDocument();
    expect(screen.getByText("Hormuud")).toBeInTheDocument();
    expect(screen.getByText("Taxi to customer meeting")).toBeInTheDocument();
    expect(screen.getByText("Receipts")).toBeInTheDocument();
    expect(screen.getByText("No receipts uploaded yet.")).toBeInTheDocument();
    expect(screen.getByText("Expense request created.")).toBeInTheDocument();
    expect(screen.getByText(/By Amina/)).toBeInTheDocument();
  });

  it.each([
    ["draft", {}],
    ["submitted", { submittedAt: Date.UTC(2026, 7, 5, 9) }],
  ] as const)(
    "shows empty workflow actors for %s expenses before actions happen",
    (_statusLabel, overrides) => {
      mocks.expense = expense({
        status: _statusLabel,
        ...overrides,
      });

      renderDetailPage();

      expectDetailValue("Approved By", "-");
      expectDetailValue("Rejected By", "-");
      expectDetailValue("Paid By", "-");
      expect(screen.queryByText("Unknown user")).not.toBeInTheDocument();
    },
  );

  it("shows approved actor only after approval has happened", () => {
    mocks.expense = expense({
      status: "approved",
      approvedBy: "gm" as Id<"users">,
      approvedAt: Date.UTC(2026, 7, 5, 10),
    });

    renderDetailPage();

    expectDetailValue("Approved By", "GM");
    expectDetailValue("Rejected By", "-");
    expectDetailValue("Paid By", "-");
  });

  it("shows unknown user only when a rejected actor cannot be resolved", () => {
    mocks.expense = expense({
      status: "rejected",
      rejectedBy: "missing-user" as Id<"users">,
      rejectedAt: Date.UTC(2026, 7, 5, 10),
      rejectionReason: "No receipt",
    });

    renderDetailPage();

    expectDetailValue("Approved By", "-");
    expectDetailValue("Rejected By", "Unknown user");
    expectDetailValue("Paid By", "-");
  });

  it("shows paid actor after payment has happened", () => {
    mocks.expense = expense({
      status: "paid",
      approvedBy: "gm" as Id<"users">,
      approvedAt: Date.UTC(2026, 7, 5, 10),
      paidBy: "ceo" as Id<"users">,
      paidAt: Date.UTC(2026, 7, 5, 11),
    });

    renderDetailPage();

    expectDetailValue("Approved By", "GM");
    expectDetailValue("Rejected By", "-");
    expectDetailValue("Paid By", "CEO");
  });

  it("submits a draft expense for the requester", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(mocks.submitExpenseRequest).toHaveBeenCalledWith({
      expenseId: "expense-1",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Expense submitted");
  });

  it("allows the requester to edit a draft expense", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Edit Draft" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated taxi");
    await user.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(mocks.updateDraftExpenseRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        expenseId: "expense-1",
        title: "Updated taxi",
        categoryId: "category-1",
        amount: 25,
      }),
    );
  });

  it("shows approve and reject for Country GM on submitted expenses", async () => {
    const user = userEvent.setup();
    mocks.currentUser = crmUser("gm", "country_gm", "GM");
    mocks.expense = expense({ status: "submitted" });

    renderDetailPage();

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Paid" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(mocks.approveExpenseRequest).toHaveBeenCalledWith({
      expenseId: "expense-1",
    });
  });

  it("rejects with a required reason dialog", async () => {
    const user = userEvent.setup();
    mocks.currentUser = crmUser("ceo", "ceo", "CEO");
    mocks.expense = expense({ status: "submitted" });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "No receipt");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(mocks.rejectExpenseRequest).toHaveBeenCalledWith({
      expenseId: "expense-1",
      reason: "No receipt",
    });
  });

  it("shows mark paid only for CEO/HOB on approved expenses", async () => {
    mocks.currentUser = crmUser("am", "account_manager", "Amina");
    mocks.expense = expense({ status: "approved" });
    const { rerender } = renderDetailPage();

    expect(screen.queryByRole("button", { name: "Mark Paid" }))
      .not.toBeInTheDocument();

    mocks.currentUser = crmUser("ceo", "ceo", "CEO");
    rerender(
      <MemoryRouter initialEntries={["/finance/expenses/expense-1"]}>
        <Routes>
          <Route
            path="/finance/expenses/:expenseId"
            element={<ExpenseDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Mark Paid" })).toBeInTheDocument();
  });

  it("marks an approved expense paid", async () => {
    const user = userEvent.setup();
    mocks.currentUser = crmUser("ceo", "ceo", "CEO");
    mocks.expense = expense({ status: "approved" });

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Mark Paid" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Payment method"), "Bank Transfer");
    await user.type(within(dialog).getByLabelText("Payment reference"), "PAY-1");
    await user.click(within(dialog).getByRole("button", { name: "Mark Paid" }));

    expect(mocks.markExpensePaid).toHaveBeenCalledWith({
      expenseId: "expense-1",
      paymentMethod: "Bank Transfer",
      paymentReference: "PAY-1",
    });
  });

  it("validates receipt file type before upload", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.upload(
      screen.getByLabelText("Upload expense receipt"),
      new File(["bad"], "receipt.pdf", { type: "text/html" }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith(
      "This file type is not allowed for expense receipts",
    );
    expect(mocks.generateReceiptUploadUrl).not.toHaveBeenCalled();
  });

  it("validates receipt file size before upload", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.upload(
      screen.getByLabelText("Upload expense receipt"),
      new File(["x".repeat(11 * 1024 * 1024)], "large.pdf", {
        type: "application/pdf",
      }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith("Receipts must be 10 MB or less");
    expect(mocks.generateReceiptUploadUrl).not.toHaveBeenCalled();
  });

  it("uploads a valid receipt and saves metadata", async () => {
    const user = userEvent.setup();
    renderDetailPage();

    await user.upload(
      screen.getByLabelText("Upload expense receipt"),
      new File(["ok"], "receipt.pdf", { type: "application/pdf" }),
    );

    expect(mocks.generateReceiptUploadUrl).toHaveBeenCalledWith({});
    expect(fetch).toHaveBeenCalledWith("https://upload.example", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: expect.any(File),
    });
    expect(mocks.saveReceiptMetadata).toHaveBeenCalledWith({
      expenseId: "expense-1",
      storageId: "storage-new",
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      size: 2,
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Receipt uploaded");
  });

  it("renders receipt metadata and downloads receipts", async () => {
    const user = userEvent.setup();
    mocks.receipts = [
      receipt("receipt-1", {
        fileName: "taxi-receipt.pdf",
        size: 4096,
      }),
    ];

    renderDetailPage();

    expect(screen.getByText("taxi-receipt.pdf")).toBeInTheDocument();
    expect(screen.getByText(/4.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by Amina/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(mocks.convexQuery).toHaveBeenCalledWith(
      "expenses.getReceiptDownloadUrl",
      { receiptId: "receipt-1" },
    );
    expect(window.open).toHaveBeenCalledWith(
      "https://download.example/receipt.pdf",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("confirms before removing receipts", async () => {
    const user = userEvent.setup();
    mocks.receipts = [receipt("receipt-1")];

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Remove this receipt?" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.archiveReceipt).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );

    expect(mocks.archiveReceipt).toHaveBeenCalledWith({
      receiptId: "receipt-1",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Receipt removed");
  });

  it("shows backend errors as friendly toasts", async () => {
    const user = userEvent.setup();
    mocks.submitExpenseRequest.mockRejectedValueOnce(new Error("Denied"));

    renderDetailPage();

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(mocks.toastError).toHaveBeenCalledWith("Denied");
  });
});
