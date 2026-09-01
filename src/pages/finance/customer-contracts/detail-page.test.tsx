import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomerContractDetailErrorBoundary } from "./detail-page";

function FailingQuery({ message }: { message: string }): never {
  throw new Error(message);
}

describe("CustomerContractDetailErrorBoundary", () => {
  it.each([
    "USAGE_CATALOG_REQUIRED: Every used catalogue service must have metadata",
    "CONTRACT_PRICING_INCOMPLETE: Current-catalog overage pricing is incomplete",
  ])("renders a visible billing warning for %s", (message) => {
    render(
      <CustomerContractDetailErrorBoundary>
        <FailingQuery message={message} />
      </CustomerContractDetailErrorBoundary>,
    );

    expect(screen.getByText("Billing validation required")).toBeInTheDocument();
    expect(
      screen.getByText(/Invoicing remains blocked/),
    ).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
