import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import TasksPage from "./page.tsx";

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
    companies: { list: "companies.list" },
    tasks: {
      list: "tasks.list",
      listReportToCandidates: "tasks.listReportToCandidates",
      create: "tasks.create",
      update: "tasks.update",
      updateStatus: "tasks.updateStatus",
      archive: "tasks.archive",
    },
    users: { listAll: "users.listAll" },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  tasks: [] as Array<
    Doc<"tasks"> & { commentCount?: number; attachmentCount?: number }
  >,
  reportToCandidates: [] as Doc<"users">[],
  users: [] as Doc<"users">[],
  companies: [] as Doc<"companies">[],
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateStatus: vi.fn(),
  archiveTask: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "tasks.list") return mocks.tasks;
    if (query === "tasks.listReportToCandidates")
      return mocks.reportToCandidates;
    if (query === "users.listAll") return mocks.users;
    if (query === "companies.list") return mocks.companies;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "tasks.create") return mocks.createTask;
    if (mutation === "tasks.update") return mocks.updateTask;
    if (mutation === "tasks.updateStatus") return mocks.updateStatus;
    if (mutation === "tasks.archive") return mocks.archiveTask;
    return vi.fn();
  },
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

function user(id: string, name: string, countryId = "country-1"): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    name,
    tokenIdentifier: `${id}-token`,
    role: "account_manager",
    countryId: countryId as Id<"countries">,
  };
}

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

function task(
  id: string,
  overrides: Partial<
    Doc<"tasks"> & { commentCount?: number; attachmentCount?: number }
  > = {},
): Doc<"tasks"> & { commentCount?: number; attachmentCount?: number } {
  return {
    _id: id as Id<"tasks">,
    _creationTime: 1,
    title: "Follow up with customer",
    status: "todo",
    priority: "medium",
    createdBy: "user-1" as Id<"users">,
    assigneeId: "user-1" as Id<"users">,
    createdAt: 1785600000000,
    updatedAt: 1785600000000,
    ...overrides,
  };
}

function startOfTodayForTest() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function seed() {
  const currentUser = user("user-1", "Amina Ali");
  const otherUser = user("user-2", "Omar Hassan");
  const today = startOfTodayForTest();
  mocks.currentUser = currentUser;
  mocks.users = [currentUser, otherUser];
  mocks.reportToCandidates = [currentUser, otherUser];
  mocks.companies = [company("company-1", "AICC")];
  mocks.tasks = [
    task("task-1", {
      title: "Follow up with customer",
      description: "Confirm the implementation plan.",
      reportToId: "user-1" as Id<"users">,
      companyId: "company-1" as Id<"companies">,
      dueDate: today + 24 * 60 * 60 * 1000,
      commentCount: 1,
      attachmentCount: 2,
    }),
    task("task-2", {
      title: "Created by me but assigned elsewhere",
      assigneeId: "user-2" as Id<"users">,
      priority: "high",
      dueDate: today - 24 * 60 * 60 * 1000,
    }),
    task("task-3", {
      title: "Blocked migration",
      status: "blocked",
      priority: "urgent",
      reportToId: "user-2" as Id<"users">,
    }),
    task("task-4", {
      title: "Finished handoff",
      status: "done",
      priority: "low",
      completedAt: 1785600000000,
    }),
    task("task-5", {
      title: "Canceled cleanup",
      status: "canceled",
      priority: "low",
      assigneeId: "user-1" as Id<"users">,
    }),
  ];
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTasksPage() {
  return render(
    <MemoryRouter initialEntries={["/tasks"]}>
      <Routes>
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:taskId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function chooseSelectOption(label: RegExp | string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    mocks.createTask.mockResolvedValue("task-new");
    mocks.updateTask.mockResolvedValue(undefined);
    mocks.updateStatus.mockResolvedValue(undefined);
    mocks.archiveTask.mockResolvedValue(undefined);
  });

  it("renders the /tasks page and visible task list", () => {
    renderTasksPage();

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(
      screen.getByText("Assign and track internal CRM work."),
    ).toBeInTheDocument();
    expect(screen.getByText("Follow up with customer")).toBeInTheDocument();
    expect(screen.getByText(/Report To: Amina Ali/)).toBeInTheDocument();
    expect(screen.getByText(/Report To: Omar Hassan/)).toBeInTheDocument();
  expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(screen.queryByText("Finished handoff")).not.toBeInTheDocument();
  });

  it("creates a task with the compact form", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: "New Task" }));
    expect(screen.getByRole("combobox", { name: "Report To" })).toHaveTextContent(
      "Amina Ali",
    );
    await user.type(screen.getByLabelText("Title"), "Prepare rollout checklist");
    await user.type(screen.getByLabelText("Description"), "Coordinate with NOC.");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => {
      expect(mocks.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Prepare rollout checklist",
          description: "Coordinate with NOC.",
          assigneeId: "user-1",
          reportToId: "user-1",
          priority: "medium",
        }),
      );
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Task created");
  });

  it("updates status from a task row", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await chooseSelectOption(/Change status for Follow up with customer/i, "Done");

    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "done",
      });
    });
  });

  it("opens task detail page from a list title", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await user.click(
      screen.getByRole("button", { name: "Follow up with customer" }),
    );

    expect(screen.getByTestId("location")).toHaveTextContent("/tasks/task-1");
  });

  it("opens task detail page from a list Open action", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await user.click(screen.getAllByRole("button", { name: "Open" })[0]);

    expect(screen.getByTestId("location")).toHaveTextContent("/tasks/task-1");
  });

  it("opens task detail page from the list row body", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await user.click(screen.getByText("Confirm the implementation plan."));

    expect(screen.getByTestId("location")).toHaveTextContent("/tasks/task-1");
  });

  it("does not navigate when changing list row status assignee or report-to", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await chooseSelectOption(/Change status for Follow up with customer/i, "Done");
    await chooseSelectOption(
      /Change assignee for Follow up with customer/i,
      "Omar Hassan",
    );
    await chooseSelectOption(
      /Change report to for Follow up with customer/i,
      "Omar Hassan",
    );

    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "done",
      });
    });
    expect(mocks.updateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      assigneeId: "user-2",
    });
    expect(mocks.updateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      reportToId: "user-2",
    });
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("opens task detail page from a board card", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByTestId("task-card-task-1"));

    expect(screen.getByTestId("location")).toHaveTextContent("/tasks/task-1");
  });

  it("does not navigate when changing status from a board card", async () => {
    renderTasksPage();

    await chooseSelectOption(/Move task Follow up with customer/i, "Done");

    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "done",
      });
    });
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("defaults to board view grouped by task status", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    expect(screen.getByRole("button", { name: /List/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /Board/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("heading", { name: "To Do" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Blocked" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Canceled" })).toBeInTheDocument();
    expect(screen.getByText("Follow up with customer")).toBeInTheDocument();
    expect(screen.getByText("Blocked migration")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /List/i }));
    expect(screen.getByRole("button", { name: /List/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows non-zero comment and attachment counts on board cards", () => {
    renderTasksPage();

    expect(screen.getByLabelText("1 comment")).toBeInTheDocument();
    expect(screen.getByLabelText("2 attachments")).toBeInTheDocument();
    expect(screen.queryByLabelText("0 comments")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("0 attachments")).not.toBeInTheDocument();
  });

  it("shows non-zero comment and attachment counts on list rows", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));

    expect(screen.getByLabelText("1 comment")).toBeInTheDocument();
    expect(screen.getByLabelText("2 attachments")).toBeInTheDocument();
    expect(screen.queryByLabelText("0 comments")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("0 attachments")).not.toBeInTheDocument();
  });

  it("applies existing filters in board view", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("combobox", { name: "View filter" }));
    await user.click(await screen.findByRole("option", { name: "All Visible" }));
    expect(screen.getByText("Created by me but assigned elsewhere")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Status filter" }));
    await user.click(await screen.findByRole("option", { name: "Blocked" }));
    expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(screen.queryByText("Follow up with customer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Priority filter" }));
    await user.click(await screen.findByRole("option", { name: "Urgent" }));
    expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(
      screen.queryByText("Created by me but assigned elsewhere"),
    ).not.toBeInTheDocument();
  });

  it("applies My Open Tasks summary shortcut", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("combobox", { name: "View filter" }));
    await user.click(await screen.findByRole("option", { name: "All Visible" }));
    expect(screen.getByText("Created by me but assigned elsewhere")).toBeInTheDocument();

    await user.click(screen.getByText("My Open Tasks"));

    expect(screen.getByText("Follow up with customer")).toBeInTheDocument();
    expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(
      screen.queryByText("Created by me but assigned elsewhere"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "View filter" })).toHaveTextContent(
      "My Tasks",
    );
    expect(
      screen.getByRole("combobox", { name: "Status filter" }),
    ).toHaveTextContent("All Active");
  });

  it("applies Overdue summary shortcut", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByText("Overdue"));

    expect(screen.getByText("Created by me but assigned elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("Follow up with customer")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocked migration")).not.toBeInTheDocument();
  });

  it("applies Due This Week summary shortcut", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByText("Due This Week"));

    expect(screen.getByText("Follow up with customer")).toBeInTheDocument();
    expect(
      screen.queryByText("Created by me but assigned elsewhere"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Blocked migration")).not.toBeInTheDocument();
  });

  it("applies Blocked summary shortcut", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /Blocked\s+1/i }));

    expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(screen.queryByText("Follow up with customer")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status filter" })).toHaveTextContent(
      "Blocked",
    );
  });

  it("shows task metadata on board cards", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    expect(screen.getByText("Follow up with customer")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getAllByText("Assignee: Amina Ali").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Report To: Amina Ali").length).toBeGreaterThan(0);
    expect(screen.getByText(/Due: Aug/)).toBeInTheDocument();
    expect(screen.getByText("Company: AICC")).toBeInTheDocument();
  });

  it("updates status from a board card", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await chooseSelectOption(/Move task Follow up with customer/i, "Done");

    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "done",
      });
    });
  });

  it("shows backend denial errors from board status updates", async () => {
    const user = userEvent.setup();
    mocks.updateStatus.mockRejectedValue(new Error("FORBIDDEN"));
    renderTasksPage();

    await chooseSelectOption(/Move task Follow up with customer/i, "Done");

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });

  it("updates Report To from a task row", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await chooseSelectOption(/Change report to for Follow up with customer/i, "Omar Hassan");

    await waitFor(() => {
      expect(mocks.updateTask).toHaveBeenCalledWith({
        taskId: "task-1",
        reportToId: "user-2",
      });
    });
  });

  it("archives a task", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await waitFor(() => {
      expect(mocks.archiveTask).toHaveBeenCalledWith({ taskId: "task-1" });
    });
  });

  it("uses Remove wording for list archive action", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));

    expect(screen.getAllByRole("button", { name: "Remove" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("filters by status priority and view", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("combobox", { name: "View filter" }));
    await user.click(await screen.findByRole("option", { name: "All Visible" }));
    expect(screen.getByText("Created by me but assigned elsewhere")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Status filter" }));
    await user.click(await screen.findByRole("option", { name: "Blocked" }));
    expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(screen.queryByText("Follow up with customer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Priority filter" }));
    await user.click(await screen.findByRole("option", { name: "Urgent" }));
    expect(screen.getByText("Blocked migration")).toBeInTheDocument();
    expect(
      screen.queryByText("Created by me but assigned elsewhere"),
    ).not.toBeInTheDocument();
  });

  it("shows backend denial errors from mutations", async () => {
    const user = userEvent.setup();
    mocks.archiveTask.mockRejectedValue(new Error("FORBIDDEN"));
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });

  it("shows backend denial errors from Report To updates", async () => {
    const user = userEvent.setup();
    mocks.updateTask.mockRejectedValue(new Error("FORBIDDEN"));
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /List/i }));
    await chooseSelectOption(/Change report to for Follow up with customer/i, "Omar Hassan");

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });
});
