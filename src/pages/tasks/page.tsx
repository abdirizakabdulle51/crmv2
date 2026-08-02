import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  AlertCircle,
  Archive,
  CalendarClock,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type Task = Doc<"tasks">;
type TaskComment = Doc<"taskComments">;
type TaskStatus = Task["status"];
type TaskPriority = Task["priority"];
type ViewFilter = "my" | "created" | "all";
type ViewMode = "list" | "board";
type StatusFilter = "active" | TaskStatus;
type PriorityFilter = "all" | TaskPriority;
type CreateTaskArgs = {
  title: string;
  description?: string;
  assigneeId?: Id<"users">;
  reportToId?: Id<"users">;
  priority: TaskPriority;
  dueDate?: number;
  companyId?: Id<"companies">;
};

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function isOpenTask(task: Task) {
  return task.status !== "done" && task.status !== "canceled";
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfThisWeek() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  date.setDate(date.getDate() + 7);
  return date.getTime();
}

function formatDate(timestamp?: number) {
  if (!timestamp) {
    return "No date";
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "No date";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateInputToTimestamp(value: string) {
  if (!value) {
    return undefined;
  }
  return new Date(`${value}T00:00:00`).getTime();
}

function statusLabel(status: TaskStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function priorityLabel(priority: TaskPriority) {
  return (
    PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ??
    priority
  );
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

function statusAccentClass(status: TaskStatus) {
  if (status === "done") return "border-t-emerald-500";
  if (status === "blocked") return "border-t-amber-500";
  if (status === "canceled") return "border-t-muted-foreground/40";
  if (status === "in_progress") return "border-t-cyan-500";
  return "border-t-slate-400";
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

export default function TasksPage() {
  const { currentUser } = useCrm();
  const tasks = useQuery(api.tasks.list, {});
  const reportToCandidates = useQuery(api.tasks.listReportToCandidates, {});
  const users = useQuery(api.users.listAll, {});
  const companies = useQuery(api.companies.list, {});
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const selectedTaskComments = useQuery(
    api.tasks.listComments,
    selectedTask ? { taskId: selectedTask._id } : "skip",
  );
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const updateStatus = useMutation(api.tasks.updateStatus);
  const archiveTask = useMutation(api.tasks.archive);
  const createComment = useMutation(api.tasks.createComment);
  const updateComment = useMutation(api.tasks.updateComment);
  const archiveComment = useMutation(api.tasks.archiveComment);

  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("my");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

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

  if (
    !tasks ||
    !reportToCandidates ||
    !users ||
    !companies ||
    currentUser === undefined
  ) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const today = startOfToday();
  const weekEnd = endOfThisWeek();
  const openTasks = tasks.filter(isOpenTask);
  const myOpenTasks = openTasks.filter(
    (task) => task.assigneeId === currentUser?._id,
  );
  const overdueTasks = openTasks.filter(
    (task) => task.dueDate !== undefined && task.dueDate < today,
  );
  const dueThisWeekTasks = openTasks.filter(
    (task) =>
      task.dueDate !== undefined &&
      task.dueDate >= today &&
      task.dueDate <= weekEnd,
  );
  const blockedTasks = tasks.filter((task) => task.status === "blocked");

  const filteredTasks = tasks.filter((task) => {
    if (viewFilter === "my" && task.assigneeId !== currentUser?._id) {
      return false;
    }
    if (viewFilter === "created" && task.createdBy !== currentUser?._id) {
      return false;
    }
    if (statusFilter === "active" && !isOpenTask(task)) {
      return false;
    }
    if (statusFilter !== "active" && task.status !== statusFilter) {
      return false;
    }
    if (priorityFilter !== "all" && task.priority !== priorityFilter) {
      return false;
    }
    return true;
  });

  const handleStatusChange = async (taskId: Id<"tasks">, status: TaskStatus) => {
    const actionKey = `${taskId}:status`;
    setPendingAction(actionKey);
    try {
      await updateStatus({ taskId, status });
      toast.success("Task status updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setPendingAction(null);
    }
  };

  const handleAssigneeChange = async (
    taskId: Id<"tasks">,
    assigneeId: Id<"users">,
  ) => {
    const actionKey = `${taskId}:assignee`;
    setPendingAction(actionKey);
    try {
      await updateTask({ taskId, assigneeId });
      toast.success("Task assignee updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setPendingAction(null);
    }
  };

  const handleReportToChange = async (
    taskId: Id<"tasks">,
    reportToId: Id<"users">,
  ) => {
    const actionKey = `${taskId}:reportTo`;
    setPendingAction(actionKey);
    try {
      await updateTask({ taskId, reportToId });
      toast.success("Task report-to updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setPendingAction(null);
    }
  };

  const handleArchive = async (taskId: Id<"tasks">) => {
    const actionKey = `${taskId}:archive`;
    setPendingAction(actionKey);
    try {
      await archiveTask({ taskId });
      toast.success("Task archived");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive task");
    } finally {
      setPendingAction(null);
    }
  };

  const selectedTaskAssignee = selectedTask?.assigneeId
    ? userMap.get(selectedTask.assigneeId)
    : null;
  const selectedTaskReportTo = selectedTask?.reportToId
    ? userMap.get(selectedTask.reportToId)
    : undefined;
  const selectedTaskCreator = selectedTask
    ? userMap.get(selectedTask.createdBy)
    : undefined;
  const selectedTaskCompany = selectedTask?.companyId
    ? companyMap.get(selectedTask.companyId)
    : null;

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="mt-1 text-muted-foreground">
            Assign and track internal CRM work.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="My Open Tasks"
          value={myOpenTasks.length}
          icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
        />
        <SummaryCard
          title="Overdue"
          value={overdueTasks.length}
          icon={<AlertCircle className="h-4 w-4 text-red-600" />}
        />
        <SummaryCard
          title="Due This Week"
          value={dueThisWeekTasks.length}
          icon={<CalendarClock className="h-4 w-4 text-amber-600" />}
        />
        <SummaryCard
          title="Blocked"
          value={blockedTasks.length}
          icon={<Clock className="h-4 w-4 text-amber-700" />}
        />
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Task List</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Showing {filteredTasks.length} of {tasks.length} visible tasks.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div
                className="grid grid-cols-2 rounded-lg border bg-muted/40 p-1"
                aria-label="Task view"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={
                    viewMode === "list"
                      ? "h-8 bg-background text-foreground shadow-sm"
                      : "h-8 text-muted-foreground"
                  }
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                >
                  <List className="mr-2 h-4 w-4" />
                  List
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={
                    viewMode === "board"
                      ? "h-8 bg-background text-foreground shadow-sm"
                      : "h-8 text-muted-foreground"
                  }
                  onClick={() => setViewMode("board")}
                  aria-pressed={viewMode === "board"}
                >
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  Board
                </Button>
              </div>
              <Select
                value={viewFilter}
                onValueChange={(value) => setViewFilter(value as ViewFilter)}
              >
                <SelectTrigger
                  className="w-full sm:w-[160px]"
                  aria-label="View filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="my">My Tasks</SelectItem>
                  <SelectItem value="created">Created by Me</SelectItem>
                  <SelectItem value="all">All Visible</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StatusFilter)}
              >
                <SelectTrigger
                  className="w-full sm:w-[160px]"
                  aria-label="Status filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">All Active</SelectItem>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={priorityFilter}
                onValueChange={(value) =>
                  setPriorityFilter(value as PriorityFilter)
                }
              >
                <SelectTrigger
                  className="w-full sm:w-[160px]"
                  aria-label="Priority filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  {PRIORITY_OPTIONS.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">No tasks match these filters.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a task or adjust the filters to see more work.
              </p>
            </div>
          ) : viewMode === "board" ? (
            <TaskBoard
              tasks={filteredTasks}
              userMap={userMap}
              companyMap={companyMap}
              pendingAction={pendingAction}
              onStatusChange={handleStatusChange}
              onOpenDetails={setSelectedTask}
            />
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => (
                <TaskRow
                  key={task._id}
                  task={task}
                  users={users}
                  reportToCandidates={reportToCandidates}
                  assignee={task.assigneeId ? userMap.get(task.assigneeId) : null}
                  reportTo={
                    task.reportToId ? userMap.get(task.reportToId) : undefined
                  }
                  creator={userMap.get(task.createdBy)}
                  company={task.companyId ? companyMap.get(task.companyId) : null}
                  pendingAction={pendingAction}
                  onStatusChange={handleStatusChange}
                  onAssigneeChange={handleAssigneeChange}
                  onReportToChange={handleReportToChange}
                  onArchive={handleArchive}
                  onOpenDetails={setSelectedTask}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        currentUser={currentUser}
        users={users}
        reportToCandidates={reportToCandidates}
        companies={companies}
        onCreate={createTask}
      />
      <TaskDetailDialog
        task={selectedTask}
        open={selectedTask !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTask(null);
          }
        }}
        comments={selectedTaskComments}
        currentUser={currentUser}
        userMap={userMap}
        assignee={selectedTaskAssignee}
        reportTo={selectedTaskReportTo}
        creator={selectedTaskCreator}
        company={selectedTaskCompany}
        onCreateComment={createComment}
        onUpdateComment={updateComment}
        onArchiveComment={archiveComment}
      />
    </div>
  );
}

function TaskBoard({
  tasks,
  userMap,
  companyMap,
  pendingAction,
  onStatusChange,
  onOpenDetails,
}: {
  tasks: Task[];
  userMap: Map<Id<"users">, Doc<"users">>;
  companyMap: Map<Id<"companies">, Doc<"companies">>;
  pendingAction: string | null;
  onStatusChange: (taskId: Id<"tasks">, status: TaskStatus) => Promise<void>;
  onOpenDetails: (task: Task) => void;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[980px] grid-cols-5 gap-3 xl:min-w-0">
        {STATUS_OPTIONS.map((status) => {
          const statusTasks = tasks.filter((task) => task.status === status.value);

          return (
            <section key={status.value} aria-labelledby={`tasks-${status.value}`}>
              <div
                className={`rounded-lg border border-t-4 bg-card p-3 ${statusAccentClass(
                  status.value,
                )}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3
                    id={`tasks-${status.value}`}
                    className="text-sm font-semibold"
                  >
                    {status.label}
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {statusTasks.length}
                  </Badge>
                </div>
              </div>

              <div className="mt-3 space-y-2 rounded-lg bg-muted/30 p-2 min-h-[160px]">
                {statusTasks.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-background/70 p-3 text-center text-xs text-muted-foreground">
                    No tasks
                  </div>
                ) : (
                  statusTasks.map((task) => (
                    <TaskBoardCard
                      key={task._id}
                      task={task}
                      assignee={
                        task.assigneeId ? userMap.get(task.assigneeId) : null
                      }
                      reportTo={
                        task.reportToId ? userMap.get(task.reportToId) : undefined
                      }
                      creator={userMap.get(task.createdBy)}
                      company={
                        task.companyId ? companyMap.get(task.companyId) : null
                      }
                      pendingAction={pendingAction}
                      onStatusChange={onStatusChange}
                      onOpenDetails={onOpenDetails}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskBoardCard({
  task,
  assignee,
  reportTo,
  creator,
  company,
  pendingAction,
  onStatusChange,
  onOpenDetails,
}: {
  task: Task;
  assignee: Doc<"users"> | null | undefined;
  reportTo: Doc<"users"> | undefined;
  creator: Doc<"users"> | undefined;
  company: Doc<"companies"> | null | undefined;
  pendingAction: string | null;
  onStatusChange: (taskId: Id<"tasks">, status: TaskStatus) => Promise<void>;
  onOpenDetails: (task: Task) => void;
}) {
  const reportToLabel =
    reportTo?.name ||
    reportTo?.email ||
    (task.reportToId ? "Unknown" : creator?.name || creator?.email || "Not set");

  return (
    <Card className="border bg-background shadow-sm transition-colors hover:border-primary/30">
      <CardContent className="space-y-3 p-3">
        <div className="space-y-2">
          <div className="font-medium leading-snug">{task.title}</div>
          <div className="flex flex-wrap gap-1.5">
            <Badge className={priorityBadgeClass(task.priority)}>
              {priorityLabel(task.priority)}
            </Badge>
            <Badge className={statusBadgeClass(task.status)}>
              {statusLabel(task.status)}
            </Badge>
          </div>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Assignee: {assignee?.name || assignee?.email || "Unassigned"}</p>
          <p>
            Report To: {reportToLabel}
            {!task.reportToId && creator ? " (created by)" : ""}
          </p>
          <p>Due: {formatDate(task.dueDate)}</p>
          {company ? <p>Company: {company.name}</p> : null}
        </div>

        <Select
          value={task.status}
          onValueChange={(value) =>
            void onStatusChange(task._id, value as TaskStatus)
          }
          disabled={pendingAction === `${task._id}:status`}
        >
          <SelectTrigger
            className="h-8 text-xs"
            aria-label={`Move task ${task.title}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 w-full text-xs"
          onClick={() => onOpenDetails(task)}
        >
          <MessageSquare className="mr-2 h-3.5 w-3.5" />
          Comments
        </Button>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-md bg-muted p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  users,
  reportToCandidates,
  assignee,
  reportTo,
  creator,
  company,
  pendingAction,
  onStatusChange,
  onAssigneeChange,
  onReportToChange,
  onArchive,
  onOpenDetails,
}: {
  task: Task;
  users: Doc<"users">[];
  reportToCandidates: Doc<"users">[];
  assignee: Doc<"users"> | null | undefined;
  reportTo: Doc<"users"> | undefined;
  creator: Doc<"users"> | undefined;
  company: Doc<"companies"> | null | undefined;
  pendingAction: string | null;
  onStatusChange: (taskId: Id<"tasks">, status: TaskStatus) => Promise<void>;
  onAssigneeChange: (
    taskId: Id<"tasks">,
    assigneeId: Id<"users">,
  ) => Promise<void>;
  onReportToChange: (
    taskId: Id<"tasks">,
    reportToId: Id<"users">,
  ) => Promise<void>;
  onArchive: (taskId: Id<"tasks">) => Promise<void>;
  onOpenDetails: (task: Task) => void;
}) {
  const reportToLabel =
    reportTo?.name ||
    reportTo?.email ||
    (task.reportToId ? "Unknown" : creator?.name || creator?.email || "Not set");

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{task.title}</h3>
            <Badge className={statusBadgeClass(task.status)}>
              {statusLabel(task.status)}
            </Badge>
            <Badge className={priorityBadgeClass(task.priority)}>
              {priorityLabel(task.priority)}
            </Badge>
          </div>
          {task.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {task.description}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Assignee: {assignee?.name || assignee?.email || "Unassigned"}</span>
            <span>
              Report To: {reportToLabel}
              {!task.reportToId && creator ? " (created by)" : ""}
            </span>
            <span>Created by: {creator?.name || creator?.email || "Unknown"}</span>
            <span>Due: {formatDate(task.dueDate)}</span>
            {company ? <span>Company: {company.name}</span> : null}
            <span>Updated: {formatDate(task.updatedAt)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
          <Select
            value={task.status}
            onValueChange={(value) =>
              void onStatusChange(task._id, value as TaskStatus)
            }
            disabled={pendingAction === `${task._id}:status`}
          >
            <SelectTrigger
              className="w-full sm:w-[150px]"
              aria-label={`Change status for ${task.title}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={task.assigneeId ?? "unassigned"}
            onValueChange={(value) => {
              if (value !== "unassigned") {
                void onAssigneeChange(task._id, value as Id<"users">);
              }
            }}
            disabled={pendingAction === `${task._id}:assignee`}
          >
            <SelectTrigger
              className="w-full sm:w-[170px]"
              aria-label={`Change assignee for ${task.title}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {users.map((user) => (
                <SelectItem key={user._id} value={user._id}>
                  {user.name || user.email || "Unknown"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={task.reportToId ?? "fallback-creator"}
            onValueChange={(value) => {
              if (value !== "fallback-creator") {
                void onReportToChange(task._id, value as Id<"users">);
              }
            }}
            disabled={pendingAction === `${task._id}:reportTo`}
          >
            <SelectTrigger
              className="w-full sm:w-[170px]"
              aria-label={`Change report to for ${task.title}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!task.reportToId ? (
                <SelectItem value="fallback-creator">
                  {creator?.name || creator?.email || "Not set"} (created by)
                </SelectItem>
              ) : null}
              {reportToCandidates.map((user) => (
                <SelectItem key={user._id} value={user._id}>
                  {user.name || user.email || "Unknown"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenDetails(task)}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            Comments
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void onArchive(task._id)}
            disabled={pendingAction === `${task._id}:archive`}
          >
            <Archive className="mr-2 h-4 w-4" />
            Archive
          </Button>
        </div>
      </div>
    </div>
  );
}

function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  comments,
  currentUser,
  userMap,
  assignee,
  reportTo,
  creator,
  company,
  onCreateComment,
  onUpdateComment,
  onArchiveComment,
}: {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comments: TaskComment[] | undefined;
  currentUser: Doc<"users"> | null | undefined;
  userMap: Map<Id<"users">, Doc<"users">>;
  assignee: Doc<"users"> | null | undefined;
  reportTo: Doc<"users"> | undefined;
  creator: Doc<"users"> | undefined;
  company: Doc<"companies"> | null | undefined;
  onCreateComment: (args: {
    taskId: Id<"tasks">;
    body: string;
  }) => Promise<unknown>;
  onUpdateComment: (args: {
    commentId: Id<"taskComments">;
    body: string;
  }) => Promise<unknown>;
  onArchiveComment: (args: {
    commentId: Id<"taskComments">;
  }) => Promise<unknown>;
}) {
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] =
    useState<Id<"taskComments"> | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [pendingCommentAction, setPendingCommentAction] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setNewComment("");
      setEditingCommentId(null);
      setEditingBody("");
      setPendingCommentAction(null);
    }
  }, [open, task?._id]);

  if (!task) {
    return null;
  }

  const reportToLabel =
    reportTo?.name ||
    reportTo?.email ||
    (task.reportToId ? "Unknown" : creator?.name || creator?.email || "Not set");

  const handleCreateComment = async (event: FormEvent) => {
    event.preventDefault();
    const body = newComment.trim();
    if (!body) {
      return;
    }

    setPendingCommentAction("create");
    try {
      await onCreateComment({ taskId: task._id, body });
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

  const handleUpdateComment = async (commentId: Id<"taskComments">) => {
    const body = editingBody.trim();
    if (!body) {
      return;
    }

    setPendingCommentAction(`${commentId}:update`);
    try {
      await onUpdateComment({ commentId, body });
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
      await onArchiveComment({ commentId });
      toast.success("Comment archived");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to archive comment",
      );
    } finally {
      setPendingCommentAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge className={statusBadgeClass(task.status)}>
              {statusLabel(task.status)}
            </Badge>
            <Badge className={priorityBadgeClass(task.priority)}>
              {priorityLabel(task.priority)}
            </Badge>
          </div>

          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assignee
              </p>
              <p>{assignee?.name || assignee?.email || "Unassigned"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Report To
              </p>
              <p>
                {reportToLabel}
                {!task.reportToId && creator ? " (created by)" : ""}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Due Date
              </p>
              <p>{formatDate(task.dueDate)}</p>
            </div>
            {company ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Company
                </p>
                <p>{company.name}</p>
              </div>
            ) : null}
          </div>

          {task.description ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Description</h3>
              <p className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-sm text-muted-foreground">
                {task.description}
              </p>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Comments</h3>
              <Badge variant="secondary" className="text-xs">
                {comments?.length ?? 0}
              </Badge>
            </div>

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
                    <div
                      key={comment._id}
                      className="rounded-lg border bg-card p-3"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {commenter?.name ||
                              commenter?.email ||
                              "Team member"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(comment.createdAt)}
                            {comment.updatedAt ? " · edited" : ""}
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
                                pendingCommentAction ===
                                `${comment._id}:archive`
                              }
                              onClick={() =>
                                void handleArchiveComment(comment._id)
                              }
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
                            onChange={(event) =>
                              setEditingBody(event.target.value)
                            }
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
                                pendingCommentAction ===
                                  `${comment._id}:update`
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateTaskDialog({
  open,
  onOpenChange,
  currentUser,
  users,
  reportToCandidates,
  companies,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: Doc<"users"> | null | undefined;
  users: Doc<"users">[];
  reportToCandidates: Doc<"users">[];
  companies: Doc<"companies">[];
  onCreate: (args: CreateTaskArgs) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(
    currentUser?._id ?? "unassigned",
  );
  const [reportToId, setReportToId] = useState<string>(
    currentUser?._id ?? "unassigned",
  );
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [companyId, setCompanyId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setAssigneeId(currentUser?._id ?? "unassigned");
    setReportToId(currentUser?._id ?? "unassigned");
    setPriority("medium");
    setDueDate("");
    setCompanyId("none");
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
    }
    onOpenChange(isOpen);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }

    setSaving(true);
    try {
      await onCreate({
        title,
        description: description.trim() || undefined,
        assigneeId:
          assigneeId !== "unassigned" ? (assigneeId as Id<"users">) : undefined,
        reportToId:
          reportToId !== "unassigned" ? (reportToId as Id<"users">) : undefined,
        priority,
        dueDate: dateInputToTimestamp(dueDate),
        companyId:
          companyId !== "none" ? (companyId as Id<"companies">) : undefined,
      });
      toast.success("Task created");
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to be done?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add context for the assignee..."
              rows={3}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Assignee</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger aria-label="Assignee">
                  <SelectValue placeholder="Select assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.name || user.email || "Unknown"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Report To</Label>
              <Select value={reportToId} onValueChange={setReportToId}>
                <SelectTrigger aria-label="Report To">
                  <SelectValue placeholder="Select report-to user" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {reportToCandidates.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.name || user.email || "Unknown"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as TaskPriority)}
              >
                <SelectTrigger aria-label="Priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-due-date">Due date</Label>
              <Input
                id="task-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger aria-label="Company">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No company</SelectItem>
                {companies.map((company) => (
                  <SelectItem key={company._id} value={company._id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {saving ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
