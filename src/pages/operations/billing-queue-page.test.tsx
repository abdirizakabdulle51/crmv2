import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import BillingQueuePage from "./billing-queue-page.tsx";

const mocks = vi.hoisted(() => ({
  contracts: [] as unknown[],
  payg: [
    {
      companyId: "company-1",
      companyName: "Automated Customer",
      model: "PAYG",
      period: "2026-08",
      amount: 125,
      status: "ready",
      reason: "Completed ManageOne usage is ready for review",
      latestUsageDate: "2026-08-31",
      expectedLastDate: "2026-08-31",
      tenantCount: 1,
    },
    {
      tenantId: "tenant-2",
      companyName: "Unlinked Tenant",
      model: "Unlinked",
      period: "2026-08",
      amount: 0,
      status: "unlinked_tenant",
      reason: "Link this ManageOne tenant to a CRM customer before billing",
      tenantCount: 1,
    },
  ],
}));

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    invoices: {
      previewContractInvoiceBatch: "contracts",
      createDraftFromContract: "createContract",
    },
    dailyUsage: {
      billingCandidates: "payg",
      createDraftInvoiceFromRollup: "createPayg",
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) =>
    query === "contracts" ? mocks.contracts : mocks.payg,
  useMutation: () => vi.fn(),
}));

describe("BillingQueuePage", () => {
  it("shows automated PAYG drafts and actionable tenant exceptions", () => {
    render(
      <MemoryRouter>
        <BillingQueuePage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Automated Customer")).toBeInTheDocument();
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(screen.getByText("2026-08-31 / 2026-08-31")).toBeInTheDocument();
    expect(screen.getAllByText("Unlinked Tenant")).toHaveLength(2);
    expect(
      screen.getByText(/never issued or emailed without review/i),
    ).toBeInTheDocument();
  });
});
