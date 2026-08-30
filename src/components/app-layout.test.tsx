import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
  getRoleLabel: (role: string) =>
    role === "monitoring" ? "Monitoring" : "Account Manager",
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
            <Route
              path="*"
              element={
                <>
                  <div>Current page</div>
                  <LocationProbe />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders the notification bell in the top-right app content area", async () => {
    const { container } = renderLayout();

    expect(screen.getByText("Amina Yusuf")).toBeInTheDocument();
    const topNotificationArea = screen.getByTestId("app-top-notification-area");
    const bell = await screen.findByRole("button", { name: "Notifications" });
    expect(topNotificationArea).toContainElement(bell);
    expect(container.querySelector("aside")).not.toContainElement(bell);
    expect(screen.getByRole("button", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByTitle("Sign out")).toBeInTheDocument();
  });

  it("limits monitoring users to Cloud Health and Documentation navigation", () => {
    mocks.currentUser = {
      ...mocks.currentUser,
      role: "monitoring",
    };
    const { container } = renderLayout("/cloud-health");
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(
      within(sidebar).getByRole("link", { name: "Cloud Health" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Documentation" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Dashboard" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Customers" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Invoices" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Tasks" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Team" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Notifications" }),
    ).not.toBeInTheDocument();
  });

  it("redirects monitoring users away from restricted direct URLs", async () => {
    mocks.currentUser = {
      ...mocks.currentUser,
      role: "monitoring",
    };
    renderLayout("/companies");

    expect(await screen.findByTestId("current-path")).toHaveTextContent(
      "/cloud-health",
    );
  });

  it("renders Customers and Revenue headers as collapsible controls", () => {
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(
      within(sidebar).getByRole("button", { name: "Collapse Customers" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking Customers hides and shows only customer links", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Customers" }),
    );

    expect(
      within(sidebar).queryByRole("link", { name: "Customers" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Sales Pipeline" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Usage" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Cloud Advisor" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Cloud Health" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Tasks" }),
    ).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Expand Customers" }),
    );

    expect(
      within(sidebar).getByRole("link", { name: "Customers" }),
    ).toBeInTheDocument();
  });

  it("clicking Revenue hides and shows only Revenue links", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    );

    expect(
      within(sidebar).queryByRole("link", { name: "Usage" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Quotes" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("link", { name: "Invoices" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Customers" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Cloud Health" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Documentation" }),
    ).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Expand Revenue" }),
    );

    expect(
      within(sidebar).getByRole("link", { name: "Usage" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Invoices" }),
    ).toBeInTheDocument();
  });

  it("groups cloud operations and workspace tools", () => {
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(
      within(sidebar).getByRole("button", {
        name: "Collapse Cloud Operations",
      }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("button", { name: "Collapse Workspace" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "ManageOne" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Cloud Health" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Documentation" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Tasks" }),
    ).toBeInTheDocument();
  });

  it("renders transactional Finance links while keeping setup in Administration", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(within(sidebar).getByText("Finance")).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Expenses" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Collections" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Finance Settings" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Invoices" }),
    ).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    );

    expect(
      within(sidebar).queryByRole("link", { name: "Invoices" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Expenses" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Reports" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Collections" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Finance Settings" }),
    ).toBeInTheDocument();
  });

  it("keeps a Customers section open when its active route is inside Customers", () => {
    window.localStorage.setItem("crm.sidebar.collapsedGroups", '["Customers"]');
    const { container } = renderLayout("/companies");
    const sidebar = container.querySelector("aside") as HTMLElement;

    expect(
      within(sidebar).getByRole("button", { name: "Collapse Customers" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(sidebar).getByRole("link", { name: "Customers" }),
    ).toBeInTheDocument();
  });

  it("persists Customers and Revenue collapsed state in localStorage", async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();
    const sidebar = container.querySelector("aside") as HTMLElement;

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Customers" }),
    );
    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse Revenue" }),
    );

    expect(
      JSON.parse(
        window.localStorage.getItem("crm.sidebar.collapsedGroups") ?? "[]",
      ),
    ).toEqual(expect.arrayContaining(["Customers", "Revenue"]));
  });
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}
