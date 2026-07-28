import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import UsageEntryDialog from "./usage-entry-dialog.tsx";

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

const mocks = vi.hoisted(() => ({
  catalog: [] as Doc<"serviceCatalog">[],
  hints: [] as Array<{
    serviceCategory: string;
    quantity: number;
    pricing: "auto" | "manual";
    suggestedCatalogItemId?: Id<"serviceCatalog">;
  }>,
  createConsumption: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createConsumption,
  useQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }
    if (typeof args === "object" && args !== null && "companyId" in args) {
      return { hints: mocks.hints };
    }
    return mocks.catalog;
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
  serviceCategory: string,
  itemName: string,
): Doc<"serviceCatalog"> {
  return {
    _id: id as Id<"serviceCatalog">,
    _creationTime: 1,
    serviceCategory,
    itemName,
    billingUnit: "unit",
    monthlyPrice: 10,
  };
}

describe("UsageEntryDialog smart service filtering", () => {
  beforeEach(() => {
    mocks.catalog = [
      catalogItem("bms-1", "BMS", "bms.physical.o2"),
      catalogItem("sfs-1", "SFS", "SFS_SATA"),
      catalogItem("evs-1", "EVS", "SSD"),
      catalogItem("nat-1", "NAT", "Small NAT"),
      catalogItem("lts-1", "LTS", "LTS Lite"),
      catalogItem("cce-1", "ECS-CCE", "S2_xlarge.2"),
    ];
    mocks.hints = [
      {
        serviceCategory: "BMS",
        quantity: 1,
        pricing: "auto",
        suggestedCatalogItemId: "bms-1" as Id<"serviceCatalog">,
      },
      {
        serviceCategory: "SFS",
        quantity: 100,
        pricing: "auto",
        suggestedCatalogItemId: "sfs-1" as Id<"serviceCatalog">,
      },
    ];
  });

  it("shows detected categories plus ECS-CCE/NAT/LTS and hides undetected categories", async () => {
    const user = userEvent.setup();

    render(
      <UsageEntryDialog
        open
        onOpenChange={vi.fn()}
        companies={[company("company-1", "Hormuud")]}
      />,
    );

    const [companySelect, serviceTypeSelect] = screen.getAllByRole("combobox");
    await user.click(companySelect);
    await user.click(screen.getByRole("option", { name: "Hormuud" }));

    await user.click(serviceTypeSelect);

    expect(screen.getByRole("option", { name: "BMS" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "SFS" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ECS-CCE" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "NAT" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "LTS" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "EVS" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "WAF" }),
    ).not.toBeInTheDocument();
  });
});
