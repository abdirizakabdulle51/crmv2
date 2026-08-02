import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import AppLayout from "./app-layout.tsx";

const mocks = vi.hoisted(() => ({
  currentUser: {
    _id: "user-1" as Id<"users">,
    _creationTime: 1,
    name: "Amina Yusuf",
    tokenIdentifier: "amina-token",
    role: "account_manager",
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
    <button type="button" aria-label="Notifications">
      Notifications
    </button>
  ),
}));

describe("AppLayout", () => {
  it("renders the notification bell in the authenticated sidebar footer", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route path="dashboard" element={<div>Dashboard page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Amina Yusuf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });
});
