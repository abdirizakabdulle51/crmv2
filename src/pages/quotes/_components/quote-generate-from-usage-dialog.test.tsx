import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import QuoteGenerateFromUsageDialog from "./quote-generate-from-usage-dialog.tsx";

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
    quotes: {
      buildQuotePreviewFromUsage: "quotes.buildQuotePreviewFromUsage",
      create: "quotes.create",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  preview: undefined as
    | {
        lineItems: Array<{
          catalogItemId: Id<"serviceCatalog">;
          itemName: string;
          serviceCategory: string;
          billingUnit: string;
          quantity: number;
          monthlyUnitPrice: number;
          monthlyTotal: number;
          yearlyTotal: number;
        }>;
        warnings: Array<{
          serviceType: string;
          amount: number;
          reason: string;
        }>;
        monthlyGrandTotal: number;
        yearlyGrandTotal: number;
        existingQuote: {
          id: Id<"quotes">;
          date: string;
          status: "draft" | "sent" | "accepted";
        } | null;
      }
    | undefined,
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createQuote,
  useQuery: (query: string, args: unknown) => {
    if (query === "quotes.buildQuotePreviewFromUsage" && args !== "skip") {
      return mocks.preview;
    }
    return undefined;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

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

describe("QuoteGenerateFromUsageDialog", () => {
  it("warns on existing source-month quote and requires explicit duplicate confirmation", async () => {
    const user = userEvent.setup();
    mocks.createQuote.mockResolvedValue("quote-2");
    mocks.preview = {
      lineItems: [
        {
          catalogItemId: "catalog-1" as Id<"serviceCatalog">,
          itemName: "EIP - Active",
          serviceCategory: "EIP",
          billingUnit: "per IP",
          quantity: 2,
          monthlyUnitPrice: 3,
          monthlyTotal: 6,
          yearlyTotal: 72,
        },
      ],
      warnings: [],
      monthlyGrandTotal: 6,
      yearlyGrandTotal: 72,
      existingQuote: {
        id: "quote-1" as Id<"quotes">,
        date: "2026-07-28",
        status: "draft",
      },
    };

    render(
      <QuoteGenerateFromUsageDialog
        open
        onOpenChange={vi.fn()}
        companies={[company("company-1", "AICC")]}
      />,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "AICC" }));

    expect(
      screen.getByText("A quote already exists for this company and month."),
    ).toBeInTheDocument();
    const createButton = screen.getByRole("button", {
      name: "Create Another Draft Quote",
    });
    expect(createButton).toBeDisabled();

    await user.click(screen.getByLabelText("Create another quote anyway"));
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    expect(mocks.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMonth: expect.stringMatching(/^\d{4}-\d{2}$/),
        lineItems: mocks.preview.lineItems,
      }),
    );
  });
});
