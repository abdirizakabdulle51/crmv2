import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  TrendingUp,
  Target,
  Activity,
  Gauge,
  BarChart3,
  AlertTriangle,
  LogOut,
  FileText,
  ReceiptText,
  WalletCards,
  ChartColumn,
  Lightbulb,
  Zap,
  Cloud,
  CloudSun,
  BookOpen,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Tags,
  SlidersHorizontal,
  Landmark,
  FileSignature,
} from "lucide-react";
import { useCrm, getRoleLabel } from "@/lib/crm-context.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import { BrandLogo } from "@/components/brand-logo.tsx";
import {
  canViewCloudHealth,
  isAdminRole,
  isMonitoringAllowedPath,
  isMonitoringRole,
} from "@/lib/role-access.ts";

const NotificationBell = lazy(() =>
  import("@/components/notification-bell.tsx").then((module) => ({
    default: module.NotificationBell,
  })),
);

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/pipeline", label: "Pipeline", icon: TrendingUp },
  { to: "/targets", label: "Targets", icon: Target },
  { to: "/performance", label: "Pace", icon: Gauge },
  { to: "/coach", label: "Coach", icon: Zap },
  { to: "/activities", label: "Activities", icon: Activity },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/at-risk", label: "At Risk", icon: AlertTriangle },
  { to: "/quotes", label: "Quotes", icon: FileText },
  { to: "/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/finance/expenses", label: "Expenses", icon: WalletCards },
  { to: "/finance/reports", label: "Finance Reports", icon: ChartColumn },
  {
    to: "/finance/expense-categories",
    label: "Expense Categories",
    icon: Tags,
  },
  {
    to: "/finance/invoice-profiles",
    label: "Invoice Profiles",
    icon: Landmark,
  },
  {
    to: "/finance/customer-contracts",
    label: "Customer Contracts",
    icon: FileSignature,
  },
  {
    to: "/finance/settings",
    label: "Finance Settings",
    icon: SlidersHorizontal,
  },
  { to: "/recommendations", label: "Cloud Advisor", icon: Lightbulb },
  {
    to: "/manageone-tenants",
    label: "ManageOne",
    icon: Cloud,
    adminOnly: true,
  },
  {
    to: "/cloud-health",
    label: "Cloud Health",
    icon: CloudSun,
    cloudHealthOnly: true,
  },
  { to: "/documentation", label: "Documentation", icon: BookOpen },
  { to: "/tasks", label: "Tasks", icon: ClipboardList },
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

const NAV_GROUPS = [
  {
    label: "Sales",
    items: [
      "/companies",
      "/pipeline",
      "/targets",
      "/performance",
      "/coach",
      "/activities",
    ],
  },
  {
    label: "Revenue",
    items: ["/usage", "/at-risk", "/quotes", "/invoices", "/recommendations"],
  },
  {
    label: "Finance",
    items: [
      "/finance/expenses",
      "/finance/reports",
      "/finance/expense-categories",
      "/finance/invoice-profiles",
      "/finance/customer-contracts",
      "/finance/settings",
    ],
  },
  {
    label: "Infrastructure",
    items: ["/manageone-tenants", "/cloud-health"],
  },
  {
    label: "System",
    items: ["/documentation", "/tasks", "/team", "/settings"],
  },
];

const COLLAPSIBLE_GROUPS = new Set(["Sales", "Revenue"]);
const SIDEBAR_GROUP_STORAGE_KEY = "crm.sidebar.collapsedGroups";

function loadCollapsedGroups() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SIDEBAR_GROUP_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export default function AppLayout() {
  const { currentUser } = useCrm();
  const { signout } = useAuth();
  const location = useLocation();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => loadCollapsedGroups(),
  );

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (isMonitoringRole(currentUser?.role)) {
      return item.to === "/cloud-health" || item.to === "/documentation";
    }
    if (item.adminOnly) {
      return isAdminRole(currentUser?.role);
    }
    if (item.cloudHealthOnly) {
      return canViewCloudHealth(currentUser?.role);
    }
    return true;
  });
  const dashboardItem = visibleNavItems.find(
    (item) => item.to === "/dashboard",
  );

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_GROUP_STORAGE_KEY,
      JSON.stringify([...collapsedGroups]),
    );
  }, [collapsedGroups]);

  if (
    isMonitoringRole(currentUser?.role) &&
    !isMonitoringAllowedPath(location.pathname)
  ) {
    return <Navigate to="/cloud-health" replace />;
  }

  const toggleGroup = (label: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-5 border-b border-sidebar-border">
          <BrandLogo
            iconClassName="h-8 w-auto max-w-[170px]"
          />
          <p className="mt-0.5 whitespace-nowrap text-[11px] text-sidebar-foreground/60">
            One System. Every Team. Total Control.
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-5 overflow-y-auto">
          {dashboardItem ? <SidebarNavLink item={dashboardItem} /> : null}

          {NAV_GROUPS.map((group) => {
            const groupItems = group.items
              .map((path) => visibleNavItems.find((item) => item.to === path))
              .filter((item): item is (typeof visibleNavItems)[number] =>
                Boolean(item),
              );

            if (groupItems.length === 0) {
              return null;
            }
            const isCollapsible = COLLAPSIBLE_GROUPS.has(group.label);
            const hasActiveItem = groupItems.some((item) =>
              location.pathname.startsWith(item.to),
            );
            const isOpen =
              !isCollapsible ||
              hasActiveItem ||
              !collapsedGroups.has(group.label);

            return (
              <div key={group.label}>
                {isCollapsible ? (
                  <button
                    type="button"
                    className="mb-2 flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${group.label}`}
                    onClick={() => toggleGroup(group.label)}
                  >
                    <span>{group.label}</span>
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (
                  <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                )}
                {isOpen ? (
                  <div className="space-y-1">
                    {groupItems.map((item) => (
                      <SidebarNavLink key={item.to} item={item} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {currentUser && (
          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {currentUser.name || "User"}
                </div>
                <div className="text-xs text-sidebar-foreground/60 truncate">
                  {getRoleLabel(currentUser.role)}
                </div>
              </div>
              <ThemeToggle />
              <button
                onClick={() => signout()}
                className="shrink-0 p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors cursor-pointer"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-16 md:pb-0">
        {currentUser && !isMonitoringRole(currentUser.role) ? (
          <div
            className="sticky top-0 z-40 flex justify-end px-4 pt-4 sm:px-6 md:px-8"
            data-testid="app-top-notification-area"
          >
            <div className="rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
              <Suspense
                fallback={
                  <div
                    className="h-7 w-7"
                    aria-hidden="true"
                    data-testid="notification-bell-loading"
                  />
                }
              >
                <NotificationBell />
              </Suspense>
            </div>
          </div>
        ) : null}
        <Outlet />
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 flex justify-around border-t bg-background py-2 md:hidden z-50">
        {visibleNavItems.slice(0, 5).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 text-xs ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SidebarNavLink({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-3 border-l-4 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "border-l-[#35C7C9] bg-[#DDF8F9] text-[#149CA3]"
            : "border-l-transparent text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
        }`
      }
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  );
}
