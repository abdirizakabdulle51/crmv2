import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { cn } from "@/lib/utils.ts";

type Notification = Doc<"notifications">;

function formatNotificationTime(createdAt: number) {
  const date = new Date(createdAt);
  const now = Date.now();
  const diffMs = Math.max(0, now - createdAt);
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function NotificationBell() {
  const navigate = useNavigate();
  const notifications = useQuery(api.notifications.listMine, { limit: 20 });
  const unreadCount = useQuery(api.notifications.unreadCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const badgeLabel = useMemo(() => {
    if (unreadCount > 99) return "99+";
    return String(unreadCount);
  }, [unreadCount]);

  async function handleNotificationClick(notification: Notification) {
    setPendingId(notification._id);
    try {
      if (!notification.readAt) {
        await markRead({ notificationId: notification._id });
      }
      setOpen(false);
      navigate(notification.href);
    } finally {
      setPendingId(null);
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await markAllRead({});
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative shrink-0 rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span
              className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
              aria-label={`${unreadCount} unread notifications`}
            >
              {badgeLabel}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">
              Task updates for you
            </div>
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
            >
              {markingAll ? "Marking..." : "Mark all read"}
            </button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto py-1">
          {notifications === undefined ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications
            </div>
          ) : (
            notifications.map((notification) => {
              const isUnread = !notification.readAt;
              const isPending = pendingId === notification._id;

              return (
                <button
                  key={notification._id}
                  type="button"
                  onClick={() => void handleNotificationClick(notification)}
                  disabled={isPending}
                  className={cn(
                    "w-full border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/60 disabled:opacity-70",
                    isUnread ? "bg-primary/5" : "bg-background",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        isUnread ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span className="text-sm font-medium leading-5 text-foreground">
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatNotificationTime(notification.createdAt)}
                        </span>
                      </span>
                      {notification.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                          {notification.body}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
