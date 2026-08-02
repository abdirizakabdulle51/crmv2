import { render, screen, waitFor, within } from "@testing-library/react";
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
      listAttachments: "tasks.listAttachments",
      listComments: "tasks.listComments",
      listReportToCandidates: "tasks.listReportToCandidates",
      generateAttachmentUploadUrl: "tasks.generateAttachmentUploadUrl",
      saveAttachmentMetadata: "tasks.saveAttachmentMetadata",
      getAttachmentDownloadUrl: "tasks.getAttachmentDownloadUrl",
      archiveAttachment: "tasks.archiveAttachment",
      update: "tasks.update",
      updateStatus: "tasks.updateStatus",
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
  attachments: [] as Doc<"taskAttachments">[],
  comments: [] as Doc<"taskComments">[],
  reportToCandidates: [] as Doc<"users">[],
  users: [] as Doc<"users">[],
  companies: [] as Doc<"companies">[],
  generateAttachmentUploadUrl: vi.fn(),
  saveAttachmentMetadata: vi.fn(),
  archiveAttachment: vi.fn(),
  convexQuery: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  archiveComment: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: mocks.convexQuery,
  }),
  useQuery: (query: string) => {
    if (query === "tasks.get") return mocks.task;
    if (query === "tasks.listAttachments") return mocks.attachments;
    if (query === "tasks.listComments") return mocks.comments;
    if (query === "tasks.listReportToCandidates")
      return mocks.reportToCandidates;
    if (query === "users.listAll") return mocks.users;
    if (query === "companies.list") return mocks.companies;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "tasks.generateAttachmentUploadUrl")
      return mocks.generateAttachmentUploadUrl;
    if (mutation === "tasks.saveAttachmentMetadata")
      return mocks.saveAttachmentMetadata;
    if (mutation === "tasks.archiveAttachment") return mocks.archiveAttachment;
    if (mutation === "tasks.update") return mocks.updateTask;
    if (mutation === "tasks.updateStatus") return mocks.updateTaskStatus;
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

function attachment(
  id: string,
  overrides: Partial<Doc<"taskAttachments">> = {},
): Doc<"taskAttachments"> {
  return {
    _id: id as Id<"taskAttachments">,
    _creationTime: 1,
    taskId: "task-1" as Id<"tasks">,
    storageId: `storage-${id}` as Id<"_storage">,
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    size: 2048,
    uploadedBy: "user-1" as Id<"users">,
    uploadedAt: 1785600000000,
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
  mocks.attachments = [];
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
    mocks.generateAttachmentUploadUrl.mockResolvedValue("https://upload.example");
    mocks.saveAttachmentMetadata.mockResolvedValue("attachment-new");
    mocks.archiveAttachment.mockResolvedValue(undefined);
    mocks.updateTask.mockResolvedValue(undefined);
    mocks.updateTaskStatus.mockResolvedValue(undefined);
    mocks.convexQuery.mockResolvedValue("https://download.example/invoice.pdf");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage-new" }),
      }),
    );
    vi.stubGlobal("open", vi.fn());
  });

  it("renders task details and existing comments", () => {
    renderTaskDetailPage();

    expect(
      screen.getByRole("heading", { name: "Follow up with customer" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("To Do").length).toBeGreaterThan(0);
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Task status" }))
      .toHaveTextContent("To Do");
    expect(screen.getByText("Confirm the implementation plan.")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Report To")).toBeInTheDocument();
    expect(screen.getByText("AICC")).toBeInTheDocument();
    expect(screen.getByText("Attachments")).toBeInTheDocument();
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Checked with NOC and waiting for confirmation."),
    ).toBeInTheDocument();
    expect(screen.getByText("Second update from Omar.")).toBeInTheDocument();
    expect(screen.getAllByText("Amina Ali").length).toBeGreaterThan(0);
    expect(screen.getByText("Omar Hassan")).toBeInTheDocument();
  });

  it("updates task status from the detail page", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.click(screen.getByRole("combobox", { name: "Task status" }));
    await user.click(await screen.findByRole("option", { name: "In Progress" }));

    await waitFor(() => {
      expect(mocks.updateTaskStatus).toHaveBeenCalledWith({
        taskId: "task-1",
        status: "in_progress",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Task status updated");
  });

  it("shows an error when task status update fails", async () => {
    const user = userEvent.setup();
    mocks.updateTaskStatus.mockRejectedValue(new Error("FORBIDDEN"));
    renderTaskDetailPage();

    await user.click(screen.getByRole("combobox", { name: "Task status" }));
    await user.click(await screen.findByRole("option", { name: "Blocked" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
  });

  it("shows an Edit Task button and opens with existing values", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    expect(screen.getByRole("button", { name: "Edit Task" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Task" }));

    expect(screen.getByRole("dialog", { name: "Edit Task" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Follow up with customer");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Confirm the implementation plan.",
    );
    expect(screen.getByRole("combobox", { name: "Edit task priority" }))
      .toHaveTextContent("Medium");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-08-02");
    expect(screen.getByRole("combobox", { name: "Edit task company" }))
      .toHaveTextContent("AICC");
  });

  it("saves edited task details", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Edit Task" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Updated customer follow-up");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Updated description.");
    await user.click(screen.getByRole("combobox", { name: "Edit task priority" }));
    await user.click(await screen.findByRole("option", { name: "High" }));
    await user.clear(screen.getByLabelText("Due date"));
    await user.type(screen.getByLabelText("Due date"), "2026-08-05");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.updateTask).toHaveBeenCalledWith({
        taskId: "task-1",
        title: "Updated customer follow-up",
        description: "Updated description.",
        priority: "high",
        dueDate: new Date("2026-08-05T00:00:00").getTime(),
        companyId: "company-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Task updated");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit Task" }))
        .not.toBeInTheDocument();
    });
  });

  it("does not save an empty task title", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Edit Task" }));
    await user.clear(screen.getByLabelText("Title"));

    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it("cancels task editing without saving and resets next open", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Edit Task" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Unsaved title");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocks.updateTask).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit Task" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Follow up with customer");
  });

  it("keeps the edit dialog open when update is rejected", async () => {
    const user = userEvent.setup();
    mocks.updateTask.mockRejectedValue(new Error("FORBIDDEN"));
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Edit Task" }));
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Rejected update");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
    expect(screen.getByRole("dialog", { name: "Edit Task" })).toBeInTheDocument();
  });

  it("validates attachment file type before upload", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderTaskDetailPage();

    const input = screen.getByLabelText("Upload task attachment");
    await user.upload(
      input,
      new File(["<svg></svg>"], "danger.svg", { type: "image/svg+xml" }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith(
      "This file type is not allowed for task attachments",
    );
    expect(mocks.generateAttachmentUploadUrl).not.toHaveBeenCalled();
  });

  it("validates attachment file size before upload", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    const input = screen.getByLabelText("Upload task attachment");
    await user.upload(
      input,
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", {
        type: "application/pdf",
      }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Attachments must be 10 MB or less",
    );
    expect(mocks.generateAttachmentUploadUrl).not.toHaveBeenCalled();
  });

  it("uploads a valid attachment and saves metadata", async () => {
    const user = userEvent.setup();
    renderTaskDetailPage();

    const input = screen.getByLabelText("Upload task attachment");
    await user.upload(
      input,
      new File(["invoice"], "invoice.pdf", { type: "application/pdf" }),
    );

    await waitFor(() => {
      expect(mocks.generateAttachmentUploadUrl).toHaveBeenCalledWith({});
    });
    expect(fetch).toHaveBeenCalledWith("https://upload.example", {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: expect.any(File),
    });
    await waitFor(() => {
      expect(mocks.saveAttachmentMetadata).toHaveBeenCalledWith({
        taskId: "task-1",
        storageId: "storage-new",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 7,
      });
    });
  });

  it("renders attachments with metadata", () => {
    mocks.attachments = [
      attachment("attachment-1", {
        fileName: "evidence.csv",
        mimeType: "text/csv",
        size: 1536,
        uploadedBy: "user-2" as Id<"users">,
        uploadedAt: 1785603600000,
      }),
    ];
    renderTaskDetailPage();

    expect(screen.getByText("evidence.csv")).toBeInTheDocument();
    expect(screen.getByText(/text\/csv/)).toBeInTheDocument();
    expect(screen.getByText(/1.5 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by Omar Hassan/)).toBeInTheDocument();
  });

  it("downloads an attachment through the backend URL query", async () => {
    const user = userEvent.setup();
    mocks.attachments = [attachment("attachment-1")];
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => {
      expect(mocks.convexQuery).toHaveBeenCalledWith(
        "tasks.getAttachmentDownloadUrl",
        { attachmentId: "attachment-1" },
      );
    });
    expect(open).toHaveBeenCalledWith(
      "https://download.example/invoice.pdf",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows Remove for attachment actions instead of Archive", () => {
    mocks.attachments = [attachment("attachment-1")];
    renderTaskDetailPage();

    const attachmentRow = screen.getByText("invoice.pdf").closest(".rounded-lg");
    expect(attachmentRow).not.toBeNull();
    expect(
      within(attachmentRow as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    ).toBeInTheDocument();
    expect(
      within(attachmentRow as HTMLElement).queryByRole("button", {
        name: "Archive",
      }),
    ).not.toBeInTheDocument();
  });

  it("does not archive an attachment when remove confirmation is canceled", async () => {
    const user = userEvent.setup();
    mocks.attachments = [attachment("attachment-1")];
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("alertdialog");

    expect(
      screen.getByRole("heading", { name: "Remove this attachment?" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(mocks.archiveAttachment).not.toHaveBeenCalled();
  });

  it("archives an attachment after remove confirmation", async () => {
    const user = userEvent.setup();
    mocks.attachments = [attachment("attachment-1")];
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );

    await waitFor(() => {
      expect(mocks.archiveAttachment).toHaveBeenCalledWith({
        attachmentId: "attachment-1",
      });
    });
  });

  it("shows attachment backend errors", async () => {
    const user = userEvent.setup();
    mocks.attachments = [attachment("attachment-1")];
    mocks.archiveAttachment.mockRejectedValue(new Error("FORBIDDEN"));
    renderTaskDetailPage();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("FORBIDDEN");
    });
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
