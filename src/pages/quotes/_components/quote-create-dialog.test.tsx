import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import QuoteCreateDialog from "./quote-create-dialog.tsx";

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
    serviceCatalog: { list: "serviceCatalog.list" },
    quotes: { create: "quotes.create" },
  },
}));

const mocks = vi.hoisted(() => ({
  catalog: [] as Doc<"serviceCatalog">[],
  createQuote: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createQuote,
  useQuery: (query: string) => {
    if (query === "serviceCatalog.list") {
      return mocks.catalog;
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

function catalogItem(
  id: string,
  itemName: string,
  serviceCategory = "CSBS",
): Doc<"serviceCatalog"> {
  return {
    _id: id as Id<"serviceCatalog">,
    _creationTime: 1,
    serviceCategory,
    itemName,
    billingUnit: "per GB/month",
    monthlyPrice: 0.0024,
  };
}

describe("QuoteCreateDialog", () => {
  it("keeps the add-line-item row responsive for long catalog labels", async () => {
    const user = userEvent.setup();
    mocks.catalog = [
      catalogItem(
        "catalog-1",
        "General CSBS Duplication (backup) with a very long production catalog label",
      ),
    ];

    render(
      <QuoteCreateDialog
        open
        onOpenChange={vi.fn()}
        companies={[company("company-1", "AICC")]}
      />,
    );

    const grid = screen.getByTestId("quote-line-item-grid");
    expect(grid).toHaveClass(
      "md:grid-cols-[minmax(0,1fr)_180px]",
      "grid-cols-1",
    );

    const [, catalogSelect] = screen.getAllByRole("combobox");
    expect(catalogSelect).toHaveClass("min-w-0");
    await user.click(catalogSelect);

    const optionLabel = screen.getByTestId("quote-catalog-option-label");
    expect(optionLabel).toHaveClass("truncate");
    expect(optionLabel).toHaveTextContent("General CSBS Duplication (backup)");
  });
});
