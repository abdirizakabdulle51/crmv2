import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty.tsx";
import { Plus, Phone, Users, FileText, Activity, Trash2 } from "lucide-react";
import ActivityDialog from "./_components/activity-dialog.tsx";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { toast } from "sonner";

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Phone; color: string }> = {
  call: {
    label: "Call",
    icon: Phone,
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  meeting: {
    label: "Meeting",
    icon: Users,
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  },
  proposal_sent: {
    label: "Proposal Sent",
    icon: FileText,
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
};

export default function ActivitiesPage() {
  const activities = useQuery(api.activities.list, {});
  const leads = useQuery(api.leads.list, {});
  const users = useQuery(api.users.listAll, {});
  const removeActivity = useMutation(api.activities.remove);
  const { isAdmin } = useCrm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [amFilter, setAmFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<Id<"activities"> | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!activities || !leads || !users) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const leadMap = new Map(leads.map((l) => [l._id, l]));
  const userMap = new Map(users.map((u) => [u._id, u]));

  const filtered = activities.filter((a) => {
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (amFilter !== "all" && a.accountManagerId !== amFilter) return false;
    return true;
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity Log</h1>
          <p className="text-muted-foreground mt-1">
            {filtered.length} {filtered.length === 1 ? "activity" : "activities"}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Log Activity
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Activity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="meeting">Meeting</SelectItem>
            <SelectItem value="proposal_sent">Proposal Sent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={amFilter} onValueChange={setAmFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Account Manager" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Managers</SelectItem>
            {users.map((u) => (
              <SelectItem key={u._id} value={u._id}>
                {u.name || u.email || "Unknown"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Activity list */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Activity />
            </EmptyMedia>
            <EmptyTitle>
              {activities.length === 0 ? "No activities yet" : "No results"}
            </EmptyTitle>
            <EmptyDescription>
              {activities.length === 0
                ? "Log your first activity to start tracking"
                : "Try adjusting your filters"}
            </EmptyDescription>
          </EmptyHeader>
          {activities.length === 0 && (
            <EmptyContent>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Log Activity
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="space-y-2">
          {filtered.map((activity) => {
            const lead = leadMap.get(activity.leadId);
            const am = userMap.get(activity.accountManagerId);
            const config = TYPE_CONFIG[activity.type];
            const Icon = config?.icon || Activity;

            return (
              <Card key={activity._id}>
                <CardContent className="flex items-center gap-4 py-3">
                  <div className={`rounded-md p-2 ${config?.color || "bg-muted"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {config?.label || activity.type}
                      </span>
                      {lead && (
                        <Badge variant="secondary" className="text-xs">
                          {lead.title}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{am?.name || "Unknown"}</span>
                      <span>{new Date(activity.date + "T00:00:00").toLocaleDateString()}</span>
                    </div>
                    {activity.description && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {activity.description}
                      </p>
                    )}
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="cursor-pointer shrink-0"
                      onClick={() => setDeleteId(activity._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ActivityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leads={leads}
      />

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(v) => { if (!v) setDeleteId(null); }}
        onConfirm={async () => {
          if (!deleteId) return;
          setDeleting(true);
          try {
            await removeActivity({ id: deleteId });
            toast.success("Activity deleted");
          } catch {
            toast.error("Failed to delete activity");
          } finally {
            setDeleting(false);
            setDeleteId(null);
          }
        }}
        title="Delete this activity?"
        description="This action is irreversible. The activity record will be permanently removed."
        loading={deleting}
      />
    </div>
  );
}
