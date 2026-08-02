import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { NotificationBell } from "./notification-bell.tsx";

Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
  value: vi.fn(() => false),
});
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  value: vi.fn(),
});

vi.mock("@/convex/_generated/api", () => ({
  api: {
    notifications: {
      listMine: "notifications.listMine",
      unreadCount: "notifications.unreadCount",
      markRead: "notifications.markRead",
      markAllRead: "notifications.markAllRead",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  notifications: [] as Doc<"notifications">[],
  unreadCount: 0,
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "notifications.listMine") return mocks.notifications;
    if (query === "notifications.unreadCount") return mocks.unreadCount;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "notifications.markRead") return mocks.markRead;
    if (mutation === "notifications.markAllRead") return mocks.markAllRead;
    return vi.fn();
  },
}));

function notification(
  id: string,
  overrides: Partial<Doc<"notifications">> = {},
): Doc<"notifications"> {
  return {
    _id: id as Id<"notifications">,
    _creationTime: 1,
    recipientId: "user-1" as Id<"users">,
    actorId: "user-2" as Id<"users">,
    type: "task_assigned",
    title: "Task assigned to you",
    body: "Follow up with customer",
    entityType: "task",
    entityId: "task-1" as Id<"tasks">,
    href: "/tasks/task-1",
    createdAt: Date.now() - 60000,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderBell(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <NotificationBell />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotificationBell", () => {
  beforeEach(() => {
    mocks.notifications = [];
    mocks.unreadCount = 0;
    mocks.markRead.mockReset();
    mocks.markRead.mockResolvedValue(undefined);
    mocks.markAllRead.mockReset();
    mocks.markAllRead.mockResolvedValue(0);
  });

  it("shows an unread badge when notifications are unread", () => {
    mocks.unreadCount = 3;

    renderBell();

    expect(screen.getByLabelText("3 unread notifications")).toBeInTheDocument();
  });

  it("does not show a badge when there are no unread notifications", () => {
    renderBell();

    expect(screen.queryByLabelText(/unread notifications/i)).not.toBeInTheDocument();
  });

  it("lists notifications in the dropdown", async () => {
    mocks.unreadCount = 1;
    mocks.notifications = [notification("notification-1")];

    renderBell();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("Task assigned to you")).toBeInTheDocument();
    expect(screen.getByText("Follow up with customer")).toBeInTheDocument();
  });

  it("shows an empty state when there are no notifications", async () => {
    renderBell();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });

  it("marks a notification read and navigates to its href", async () => {
    mocks.notifications = [notification("notification-1")];

    renderBell();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await userEvent.click(screen.getByRole("button", { name: /Task assigned to you/i }));

    expect(mocks.markRead).toHaveBeenCalledWith({
      notificationId: "notification-1",
    });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/tasks/task-1"),
    );
  });

  it("does not mark an already-read notification again before navigating", async () => {
    mocks.notifications = [
      notification("notification-1", { readAt: Date.now() - 1000 }),
    ];

    renderBell();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await userEvent.click(screen.getByRole("button", { name: /Task assigned to you/i }));

    expect(mocks.markRead).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/tasks/task-1"),
    );
  });

  it("marks all notifications read", async () => {
    mocks.unreadCount = 2;
    mocks.notifications = [
      notification("notification-1"),
      notification("notification-2", { _id: "notification-2" as Id<"notifications"> }),
    ];

    renderBell();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(mocks.markAllRead).toHaveBeenCalledWith({});
  });
});
