import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Paperclip, Pencil, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type Task = Doc<"tasks">;
type TaskComment = Doc<"taskComments">;
type TaskAttachment = Doc<"taskAttachments">;
type TaskStatus = Task["status"];
type TaskPriority = Task["priority"];
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ATTACHMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.xls,.xlsx,.doc,.docx";

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  canceled: "Canceled",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

function formatDate(timestamp?: number) {
  if (!timestamp) return "No date";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "No date";
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadgeClass(status: TaskStatus) {
  if (status === "done") return "bg-emerald-100 text-emerald-800";
  if (status === "blocked") return "bg-amber-100 text-amber-800";
  if (status === "canceled") return "bg-muted text-muted-foreground";
  if (status === "in_progress") return "bg-cyan-100 text-cyan-800";
  return "bg-slate-100 text-slate-700";
}

function priorityBadgeClass(priority: TaskPriority) {
  if (priority === "urgent") return "bg-red-100 text-red-800";
  if (priority === "high") return "bg-orange-100 text-orange-800";
  if (priority === "medium") return "bg-blue-100 text-blue-800";
  return "bg-muted text-muted-foreground";
}

function canManageComment(
  currentUser: Doc<"users"> | null | undefined,
  comment: TaskComment,
) {
  if (!currentUser) return false;
  return (
    comment.createdBy === currentUser._id ||
    currentUser.role === "ceo" ||
    currentUser.role === "head_of_business"
  );
}

function canArchiveAttachment(
  currentUser: Doc<"users"> | null | undefined,
  attachment: TaskAttachment,
) {
  if (!currentUser) return false;
  return (
    attachment.uploadedBy === currentUser._id ||
    currentUser.role === "ceo" ||
    currentUser.role === "head_of_business"
  );
}

export default function TaskDetailPage() {
  const navigate = useNavigate();
  const convex = useConvex();
  const { taskId } = useParams();
  const { currentUser } = useCrm();
  const task = useQuery(
    api.tasks.get,
    taskId ? { taskId: taskId as Id<"tasks"> } : "skip",
  );
  const comments = useQuery(
    api.tasks.listComments,
    task ? { taskId: task._id } : "skip",
  );
  const attachments = useQuery(
    api.tasks.listAttachments,
    task ? { taskId: task._id } : "skip",
  );
  const users = useQuery(api.users.listAll, {});
  const reportToCandidates = useQuery(api.tasks.listReportToCandidates, {});
  const companies = useQuery(api.companies.list, {});
  const generateAttachmentUploadUrl = useMutation(
    api.tasks.generateAttachmentUploadUrl,
  );
  const saveAttachmentMetadata = useMutation(api.tasks.saveAttachmentMetadata);
  const archiveAttachment = useMutation(api.tasks.archiveAttachment);
  const createComment = useMutation(api.tasks.createComment);
  const updateComment = useMutation(api.tasks.updateComment);
  const archiveComment = useMutation(api.tasks.archiveComment);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] =
    useState<Id<"taskComments"> | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [pendingAttachmentAction, setPendingAttachmentAction] = useState<
    string | null
  >(null);
  const [pendingCommentAction, setPendingCommentAction] = useState<string | null>(
    null,
  );

  const userMap = useMemo(
    () =>
      new Map(
        [...(users ?? []), ...(reportToCandidates ?? [])].map((user) => [
          user._id,
          user,
        ]),
      ),
    [reportToCandidates, users],
  );
  const companyMap = useMemo(
    () => new Map((companies ?? []).map((company) => [company._id, company])),
    [companies],
  );

  const isLoading =
    task === undefined ||
    users === undefined ||
    reportToCandidates === undefined ||
    companies === undefined ||
    currentUser === undefined;

  const handleCreateComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!task) return;

    const body = newComment.trim();
    if (!body) return;

    setPendingCommentAction("create");
    try {
      await createComment({ taskId: task._id, body });
      setNewComment("");
      toast.success("Comment added");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add comment",
      );
    } finally {
      setPendingCommentAction(null);
    }
  };

  const validateAttachmentFile = (file: File) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type)) {
      toast.error("This file type is not allowed for task attachments");
      return false;
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      toast.error("Attachments must be 10 MB or less");
      return false;
    }
    return true;
  };

  const handleUploadAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!task || !file || !validateAttachmentFile(file)) return;

    setPendingAttachmentAction("upload");
    try {
      const uploadUrl = await generateAttachmentUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("File upload failed");
      }
      const { storageId } = (await uploadResponse.json()) as {
        storageId: Id<"_storage">;
      };
      await saveAttachmentMetadata({
        taskId: task._id,
        storageId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
      toast.success("Attachment uploaded");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload attachment",
      );
    } finally {
      setPendingAttachmentAction(null);
    }
  };

  const handleDownloadAttachment = async (
    attachmentId: Id<"taskAttachments">,
  ) => {
    setPendingAttachmentAction(`${attachmentId}:download`);
    try {
      const url = await convex.query(api.tasks.getAttachmentDownloadUrl, {
        attachmentId,
      });
      if (!url) {
        throw new Error("Attachment download URL is unavailable");
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to download attachment",
      );
    } finally {
      setPendingAttachmentAction(null);
    }
  };

  const handleArchiveAttachment = async (
    attachmentId: Id<"taskAttachments">,
  ) => {
    setPendingAttachmentAction(`${attachmentId}:archive`);
    try {
      await archiveAttachment({ attachmentId });
      toast.success("Attachment archived");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to archive attachment",
      );
    } finally {
      setPendingAttachmentAction(null);
    }
  };

  const handleUpdateComment = async (commentId: Id<"taskComments">) => {
    const body = editingBody.trim();
    if (!body) return;

    setPendingCommentAction(`${commentId}:update`);
    try {
      await updateComment({ commentId, body });
      setEditingCommentId(null);
      setEditingBody("");
      toast.success("Comment updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update comment",
      );
    } finally {
      setPendingCommentAction(null);
    }
  };

  const handleArchiveComment = async (commentId: Id<"taskComments">) => {
    setPendingCommentAction(`${commentId}:archive`);
    try {
      await archiveComment({ commentId });
      toast.success("Comment archived");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to archive comment",
      );
    } finally {
      setPendingCommentAction(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Button variant="ghost" onClick={() => navigate("/tasks")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Tasks
        </Button>
        <Card>
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold">Task not found or unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The task may have been archived, removed, or outside your access.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const assignee = task.assigneeId ? userMap.get(task.assigneeId) : null;
  const reportTo = task.reportToId ? userMap.get(task.reportToId) : undefined;
  const creator = userMap.get(task.createdBy);
  const company = task.companyId ? companyMap.get(task.companyId) : null;
  const reportToLabel =
    reportTo?.name ||
    reportTo?.email ||
    (task.reportToId ? "Unknown" : creator?.name || creator?.email || "Not set");

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button variant="ghost" onClick={() => navigate("/tasks")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Tasks
      </Button>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
        <p className="text-muted-foreground">
          Task details, ownership, and team discussion.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            <Badge className={statusBadgeClass(task.status)}>
              {STATUS_LABELS[task.status]}
            </Badge>
            <Badge className={priorityBadgeClass(task.priority)}>
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <DetailField
              label="Assignee"
              value={assignee?.name || assignee?.email || "Unassigned"}
            />
            <DetailField
              label="Report To"
              value={`${reportToLabel}${!task.reportToId && creator ? " (created by)" : ""}`}
            />
            <DetailField label="Due Date" value={formatDate(task.dueDate)} />
            {company ? <DetailField label="Company" value={company.name} /> : null}
          </div>

          {task.description ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Description</h2>
              <p className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                {task.description}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Attachments
              <Badge variant="secondary" className="text-xs">
                {attachments?.length ?? 0}
              </Badge>
            </span>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(event) => void handleUploadAttachment(event)}
                aria-label="Upload task attachment"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pendingAttachmentAction === "upload"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {pendingAttachmentAction === "upload" ? "Uploading..." : "Upload File"}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {attachments === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : attachments.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No attachments yet.
            </div>
          ) : (
            <div className="space-y-3">
              {attachments.map((attachment) => {
                const uploader = userMap.get(attachment.uploadedBy);
                const canArchive = canArchiveAttachment(currentUser, attachment);

                return (
                  <div
                    key={attachment._id}
                    className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {attachment.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {attachment.mimeType} - {formatFileSize(attachment.size)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Uploaded by{" "}
                        {uploader?.name || uploader?.email || "Team member"} -{" "}
                        {formatDateTime(attachment.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={
                          pendingAttachmentAction === `${attachment._id}:download`
                        }
                        onClick={() => void handleDownloadAttachment(attachment._id)}
                      >
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Download
                      </Button>
                      {canArchive ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              disabled={
                                pendingAttachmentAction ===
                                `${attachment._id}:archive`
                              }
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Remove
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent size="sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Remove this attachment?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the attachment from this task.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  void handleArchiveAttachment(attachment._id)
                                }
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Comments</span>
            <Badge variant="secondary" className="text-xs">
              {comments?.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {comments === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : comments.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No comments yet.
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => {
                const commenter = userMap.get(comment.createdBy);
                const canEdit = canManageComment(currentUser, comment);
                const isEditing = editingCommentId === comment._id;

                return (
                  <div key={comment._id} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {commenter?.name || commenter?.email || "Team member"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(comment.createdAt)}
                          {comment.updatedAt ? " - edited" : ""}
                        </p>
                      </div>
                      {canEdit ? (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingCommentId(comment._id);
                              setEditingBody(comment.body);
                            }}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            disabled={
                              pendingCommentAction === `${comment._id}:archive`
                            }
                            onClick={() => void handleArchiveComment(comment._id)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Archive
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <div className="mt-3 space-y-2">
                        <Textarea
                          value={editingBody}
                          maxLength={2000}
                          onChange={(event) => setEditingBody(event.target.value)}
                          aria-label={`Edit comment ${comment._id}`}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingCommentId(null);
                              setEditingBody("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={
                              !editingBody.trim() ||
                              pendingCommentAction === `${comment._id}:update`
                            }
                            onClick={() => void handleUpdateComment(comment._id)}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {comment.body}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <form className="space-y-2" onSubmit={handleCreateComment}>
            <Label htmlFor="task-comment">Add comment</Label>
            <Textarea
              id="task-comment"
              value={newComment}
              maxLength={2000}
              onChange={(event) => setNewComment(event.target.value)}
              placeholder="Share an update or ask a question..."
              rows={3}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {newComment.length}/2000 characters
              </p>
              <Button
                type="submit"
                disabled={!newComment.trim() || pendingCommentAction === "create"}
              >
                <Send className="mr-2 h-4 w-4" />
                Add Comment
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p>{value}</p>
    </div>
  );
}
