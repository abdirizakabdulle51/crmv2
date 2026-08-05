import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import AppLayout from "./app-layout.tsx";

const mocks = vi.hoisted(() => ({
  currentUser: {
    _id: "user-1" as Id<"users">,
    _creationTime: 1,
    name: "Amina Yusuf",
    tokenIdentifier: "amina-token",
    role: "ceo",
  } as Doc<"users">,
  signout: vi.fn(),
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
  getRoleLabel: () => "Account Manager",
}));

vi.mock("@/hooks/use-auth.ts", () => ({
  useAuth: () => ({ signout: mocks.signout }),
}));

vi.mock("@/components/theme-toggle.tsx", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/brand-logo.tsx", () => ({
  BrandLogo: () => <div>HTGCLOUDS</div>,
}));

vi.mock("@/components/notification-bell.tsx", () => ({
  NotificationBell: () => (
    <button type="button" aria-label="Notifications" data-testid="mock-bell">
      Notifications
    </button>
  ),
}));

describe("AppLayout", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.currentUser = {
      ...mocks.currentUser,
      role: "ceo",
    };
  });

  function renderLayout(initialEntry = "/dashboard") {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route path="*" element={<div>Current page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders the notification bell in the top-right app content area", () => {
    const { container } = renderLayout();

    expect(screen.getByText("Amina Yusuf")).toBeInTheDocument();
    const topNotificationArea = screen.getByTestId(
      "app-top-notification-area",
    );
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(topNotificationArea).toContainElement(bell);
    expect(container.querySelector("aside")).not.toContainElement(bell);
    expect(screen.getByRole("button", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByTitle("Sign out")).toBeInTheDocument();
  });

  it("renders Sales and Revenue headers as collapsible controls", () => {
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(
      within(sidebar).getByRole("button", { name: "Collapse Sales" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking Sales hides and shows only Sales links", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Sales" }),
    );

    expect(within(sidebar).queryByRole("link", { name: "Companies" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "Pipeline" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Usage" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Cloud Advisor" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Cloud Health" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Tasks" }))
      .toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Expand Sales" }),
    );

    expect(within(sidebar).getByRole("link", { name: "Companies" }))
      .toBeInTheDocument();
  });

  it("clicking Revenue hides and shows only Revenue links", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    );

    expect(within(sidebar).queryByRole("link", { name: "Usage" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "At Risk" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "Quotes" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "Invoices" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "Cloud Advisor" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Companies" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Cloud Health" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Documentation" }))
      .toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Expand Revenue" }),
    );

    expect(within(sidebar).getByRole("link", { name: "Usage" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Invoices" }))
      .toBeInTheDocument();
  });

  it("keeps Infrastructure and System visible and non-collapsible", () => {
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(within(sidebar).queryByRole("button", { name: /Infrastructure/i }))
      .not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("button", { name: /System/i }))
      .not.toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "ManageOne" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Cloud Health" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Documentation" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Tasks" }))
      .toBeInTheDocument();
  });

  it("renders Finance with Expenses while keeping Invoices under Revenue", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(within(sidebar).getByText("Finance")).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Expenses" }))
      .toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Invoices" }))
      .toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    );

    expect(within(sidebar).queryByRole("link", { name: "Invoices" }))
      .not.toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Expenses" }))
      .toBeInTheDocument();
  });

  it("keeps a Sales section open when its active route is inside Sales", () => {
    window.localStorage.setItem("crm.sidebar.collapsedGroups", '["Sales"]');
    const { container } = renderLayout("/companies");
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(
      within(sidebar).getByRole("button", { name: "Collapse Sales" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(sidebar).getByRole("link", { name: "Companies" }))
      .toBeInTheDocument();
  });

  it("persists Sales and Revenue collapsed state in localStorage", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Sales" }),
    );
    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    );

    expect(
      JSON.parse(window.localStorage.getItem("crm.sidebar.collapsedGroups") ?? "[]"),
    ).toEqual(expect.arrayContaining(["Sales", "Revenue"]));
  });
});
