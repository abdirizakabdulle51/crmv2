import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import ServiceCatalogSection from "./service-catalog-section.tsx";

const mocks = vi.hoisted(() => ({
  catalog: [] as Doc<"serviceCatalog">[],
  mutation: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.catalog,
  useMutation: () => mocks.mutation,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function catalogItem(
  id: string,
  serviceCategory: string,
  itemName: string,
): Doc<"serviceCatalog"> {
  return {
    _id: id as Id<"serviceCatalog">,
    _creationTime: 1,
    productGroup:
      serviceCategory === "ECS"
        ? "compute"
        : serviceCategory === "EIP"
          ? "network"
          : "security_compliance",
    serviceCode: serviceCategory,
    serviceCategory,
    itemName,
    billingUnit: "per month",
    monthlyPrice: 100,
  };
}

describe("ServiceCatalogSection accordion", () => {
  beforeEach(() => {
    mocks.catalog = [
      catalogItem("item-1", "ECS", "ECS Small"),
      catalogItem("item-2", "ECS", "ECS Large"),
      catalogItem("item-3", "EIP", "Elastic IP"),
      catalogItem("item-4", "WAF", "WAF Instance"),
    ];
  });

  it("starts collapsed and only renders rows for the clicked category", async () => {
    const user = userEvent.setup();

    render(<ServiceCatalogSection />);

    expect(screen.getByRole("button", { name: /Compute/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /Network/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("ECS Small")).not.toBeInTheDocument();
    expect(screen.queryByText("ECS Large")).not.toBeInTheDocument();
    expect(screen.queryByText("Elastic IP")).not.toBeInTheDocument();
    expect(screen.queryByText("WAF Instance")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Compute/i }));

    expect(screen.getByRole("button", { name: /Compute/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("ECS Small")).toBeInTheDocument();
    expect(screen.getByText("ECS Large")).toBeInTheDocument();
    expect(screen.queryByText("Elastic IP")).not.toBeInTheDocument();
    expect(screen.queryByText("WAF Instance")).not.toBeInTheDocument();
  });
});
