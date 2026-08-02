import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import TaskDetailPage from "./detail-page.tsx";

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
      get: "tasks.get",
      listComments: "tasks.listComments",
      listReportToCandidates: "tasks.listReportToCandidates",
      createComment: "tasks.createComment",
      updateComment: "tasks.updateComment",
      archiveComment: "tasks.archiveComment",
    },
    users: { listAll: "users.listAll" },
  },
}));

const mocks = vi.hoisted(() => ({
  currentUser: null as Doc<"users"> | null,
  task: null as Doc<"tasks"> | null,
  comments: [] as Doc<"taskComments">[],
  reportToCandidates: [] as Doc<"users">[],
  users: [] as Doc<"users">[],
  companies: [] as Doc<"companies">[],
  createComment: vi.fn(),
  updateComment: vi.fn(),
  archiveComment: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "tasks.get") return mocks.task;
    if (query === "tasks.listComments") return mocks.comments;
    if (query === "tasks.listReportToCandidates")
      return mocks.reportToCandidates;
    if (query === "users.listAll") return mocks.users;
    if (query === "companies.list") return mocks.companies;
    return undefined;
  },
  useMutation: (mutation: string) => {
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

function user(id: string, name: string): Doc<"users"> {
  return {
    _id: id as Id<"users">,
    _creationTime: 1,
    name,
    tokenIdentifier: `${id}-token`,
    role: "account_manager",
    countryId: "country-1" as Id<"countries">,
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

function task(overrides: Partial<Doc<"tasks">> = {}): Doc<"tasks"> {
  return {
    _id: "task-1" as Id<"tasks">,
    _creationTime: 1,
    title: "Follow up with customer",
    description: "Confirm the implementation plan.",
    status: "todo",
    priority: "medium",
    createdBy: "user-1" as Id<"users">,
    assigneeId: "user-1" as Id<"users">,
    reportToId: "user-1" as Id<"users">,
    companyId: "company-1" as Id<"companies">,
    dueDate: 1785686400000,
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
  mocks.task = task();
  mocks.comments = [
    comment("comment-1"),
    comment("comment-2", {
      body: "Second update from Omar.",
      createdBy: "user-2" as Id<"users">,
      createdAt: 1785603600000,
    }),
  ];
}

function renderTaskDetailPage(initialEntry = "/tasks/task-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="/tasks" element={<div>Tasks list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TaskDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    mocks.createComment.mockResolvedValue("comment-new");
    mocks.updateComment.mockResolvedValue(undefined);
    mocks.archiveComment.mockResolvedValue(undefined);
  });

  it("renders task details and existing comments", () => {
    renderTaskDetailPage();

    expect(
      screen.getByRole("heading", { name: "Follow up with customer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Confirm the implementation plan.")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Report To")).toBeInTheDocument();
    expect(screen.getByText("AICC")).toBeInTheDocument();
    expect(
      screen.getByText("Checked with NOC and waiting for confirmation."),
    ).toBeInTheDocument();
    expect(screen.getByText("Second update from Omar.")).toBeInTheDocument();
    expect(screen.getAllByText("Amina Ali").length).toBeGreaterThan(0);
    expect(screen.getByText("Omar Hassan")).toBeInTheDocument();
  });

  it("shows an unavailable state when a task is missing", () => {
    mocks.task = null;
    renderTaskDetailPage("/tasks/missing-task");

    expect(
      screen.getByRole("heading", { name: "Task not found or unavailable" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Tasks/i })).toBeInTheDocument();
  });

  it("adds a valid task comment", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.type(
      screen.getByLabelText("Add comment"),
      "Customer confirmed the rollout.",
    );
    await user.click(screen.getByRole("button", { name: "Add Comment" }));

    await waitFor(() => {
      expect(mocks.createComment).toHaveBeenCalledWith({
        taskId: "task-1",
        body: "Customer confirmed the rollout.",
      });
    });
  });

  it("does not submit a blank task comment", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.type(screen.getByLabelText("Add comment"), "   ");

    expect(screen.getByRole("button", { name: "Add Comment" })).toBeDisabled();
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("edits a task comment", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const editBox = screen.getByLabelText(/Edit comment comment-1/i);
    await user.clear(editBox);
    await user.type(editBox, "Edited progress update.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.updateComment).toHaveBeenCalledWith({
        commentId: "comment-1",
        body: "Edited progress update.",
      });
    });
  });

  it("archives a task comment", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);

    await waitFor(() => {
      expect(mocks.archiveComment).toHaveBeenCalledWith({
        commentId: "comment-1",
      });
    });
  });

  it("shows backend denial errors from comment actions", async () => {
    const user = userEvent.setup();
    mocks.createComment.mockRejectedValue(new Error("FORBIDDEN"));
    renderTaskDetailPage();

    await user.type(screen.getByLabelText("Add comment"), "No access");
    await user.click(screen.getByRole("button", { name: "Add Comment" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });
});
