import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
      listComments: "tasks.listComments",
      createComment: "tasks.createComment",
      updateComment: "tasks.updateComment",
      archiveComment: "tasks.archiveComment",
    },
    users: { listAll: "users.listAll" },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  tasks: [] as Doc<"tasks">[],
  reportToCandidates: [] as Doc<"users">[],
  users: [] as Doc<"users">[],
  companies: [] as Doc<"companies">[],
  commentsByTask: {} as Record<string, Doc<"taskComments">[]>,
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateStatus: vi.fn(),
  archiveTask: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  archiveComment: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string, args?: { taskId?: string } | "skip") => {
    if (query === "tasks.list") return mocks.tasks;
    if (query === "tasks.listReportToCandidates")
      return mocks.reportToCandidates;
    if (query === "tasks.listComments") {
      if (args === "skip" || !args?.taskId) return undefined;
      return mocks.commentsByTask[args.taskId] ?? [];
    }
    if (query === "users.listAll") return mocks.users;
    if (query === "companies.list") return mocks.companies;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "tasks.create") return mocks.createTask;
    if (mutation === "tasks.update") return mocks.updateTask;
    if (mutation === "tasks.updateStatus") return mocks.updateStatus;
    if (mutation === "tasks.archive") return mocks.archiveTask;
    if (mutation === "tasks.createComment") return mocks.createComment;
    if (mutation === "tasks.updateComment") return mocks.updateComment;
    if (mutation === "tasks.archiveComment") return mocks.archiveComment;
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
  overrides: Partial<Doc<"tasks">> = {},
): Doc<"tasks"> {
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

function comment(
  id: string,
  overrides: Partial<Doc<"taskComments">> = {},
): Doc<"taskComments"> {
  return {
    _id: id as Id<"taskComments">,
    _creationTime: 1,
    taskId: "task-1" as Id<"tasks">,
    body: "Checked with NOC and waiting for confirmation.",
    createdBy: "user-1" as Id<"users">,
    createdAt: 1785600000000,
    ...overrides,
  };
}

function seed() {
  const currentUser = user("user-1", "Amina Ali");
  const otherUser = user("user-2", "Omar Hassan");
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
      dueDate: 1785686400000,
    }),
    task("task-2", {
      title: "Created by me but assigned elsewhere",
      assigneeId: "user-2" as Id<"users">,
      priority: "high",
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
  mocks.commentsByTask = {
    "task-1": [
      comment("comment-1"),
      comment("comment-2", {
        body: "Second update from Omar.",
        createdBy: "user-2" as Id<"users">,
        createdAt: 1785603600000,
      }),
    ],
  };
}

function renderTasksPage() {
  return render(
    <MemoryRouter initialEntries={["/tasks"]}>
      <Routes>
        <Route path="/tasks" element={<TasksPage />} />
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
    mocks.createComment.mockResolvedValue("comment-new");
    mocks.updateComment.mockResolvedValue(undefined);
    mocks.archiveComment.mockResolvedValue(undefined);
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
    renderTasksPage();

    await chooseSelectOption(/Change status for Follow up with customer/i, "Done");

    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "done",
      });
    });
  });

  it("opens task details and renders existing comments", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getAllByRole("button", { name: "Comments" })[0]);
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("Follow up with customer")).toBeInTheDocument();
    expect(within(dialog).getByText("To Do")).toBeInTheDocument();
    expect(within(dialog).getByText("Medium")).toBeInTheDocument();
    expect(within(dialog).getByText("Confirm the implementation plan.")).toBeInTheDocument();
    expect(within(dialog).getByText("Assignee")).toBeInTheDocument();
    expect(within(dialog).getByText("Report To")).toBeInTheDocument();
    expect(within(dialog).getByText("AICC")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Checked with NOC and waiting for confirmation."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Second update from Omar.")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Amina Ali").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Omar Hassan")).toBeInTheDocument();
  });

  it("adds a valid task comment", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getAllByRole("button", { name: "Comments" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Add comment"),
      "Customer confirmed the rollout.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Add Comment" }));

    await waitFor(() => {
      expect(mocks.createComment).toHaveBeenCalledWith({
        taskId: "task-1",
        body: "Customer confirmed the rollout.",
      });
    });
  });

  it("does not submit a blank task comment", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getAllByRole("button", { name: "Comments" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Add comment"), "   ");

    expect(
      within(dialog).getByRole("button", { name: "Add Comment" }),
    ).toBeDisabled();
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("edits a task comment", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getAllByRole("button", { name: "Comments" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getAllByRole("button", { name: "Edit" })[0]);
    const editBox = within(dialog).getByLabelText(/Edit comment comment-1/i);
    await user.clear(editBox);
    await user.type(editBox, "Edited progress update.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateComment).toHaveBeenCalledWith({
        commentId: "comment-1",
        body: "Edited progress update.",
      });
    });
  });

  it("archives a task comment", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getAllByRole("button", { name: "Comments" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getAllByRole("button", { name: "Archive" })[0]);

    await waitFor(() => {
      expect(mocks.archiveComment).toHaveBeenCalledWith({
        commentId: "comment-1",
      });
    });
  });

  it("shows backend denial errors from comment actions", async () => {
    const user = userEvent.setup();
    mocks.createComment.mockRejectedValue(new Error("FORBIDDEN"));
    renderTasksPage();

    await user.click(screen.getAllByRole("button", { name: "Comments" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Add comment"), "No access");
    await user.click(within(dialog).getByRole("button", { name: "Add Comment" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });

  it("renders a board view grouped by task status", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    expect(screen.getByRole("button", { name: /List/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: /Board/i }));

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
  });

  it("applies existing filters in board view", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /Board/i }));
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

  it("shows task metadata on board cards", async () => {
    const user = userEvent.setup();
    renderTasksPage();

    await user.click(screen.getByRole("button", { name: /Board/i }));

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

    await user.click(screen.getByRole("button", { name: /Board/i }));
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

    await user.click(screen.getByRole("button", { name: /Board/i }));
    await chooseSelectOption(/Move task Follow up with customer/i, "Done");

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });

  it("updates Report To from a task row", async () => {
    renderTasksPage();

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

    await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);

    await waitFor(() => {
      expect(mocks.archiveTask).toHaveBeenCalledWith({ taskId: "task-1" });
    });
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

    await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });

  it("shows backend denial errors from Report To updates", async () => {
    mocks.updateTask.mockRejectedValue(new Error("FORBIDDEN"));
    renderTasksPage();

    await chooseSelectOption(/Change report to for Follow up with customer/i, "Omar Hassan");

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });
});
