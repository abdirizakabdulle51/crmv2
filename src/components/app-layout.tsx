import { NavLink, Outlet } from "react-router-dom";
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
  Lightbulb,
  Zap,
  Cloud,
  CloudSun,
} from "lucide-react";
import { useCrm, getRoleLabel } from "@/lib/crm-context.tsx";
import { useAuth } from "@/hooks/use-auth.ts";
import { ThemeToggle } from "@/components/theme-toggle.tsx";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/pipeline", label: "Pipeline", icon: TrendingUp },
  { to: "/targets", label: "Targets", icon: Target },
  { to: "/performance", label: "Pace", icon: Gauge },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/at-risk", label: "At Risk", icon: AlertTriangle },
  { to: "/quotes", label: "Quotes", icon: FileText },
  { to: "/recommendations", label: "AI Recs", icon: Lightbulb },
  { to: "/coach", label: "Coach", icon: Zap },
  { to: "/activities", label: "Activities", icon: Activity },
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
  { to: "/team", label: "Team", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppLayout() {
  const { currentUser } = useCrm();
  const { signout } = useAuth();
  const visibleNavItems = NAV_ITEMS.filter(
    (item) =>
      !item.adminOnly ||
      currentUser?.role === "ceo" ||
      currentUser?.role === "head_of_business",
  ).filter(
    (item) =>
      !item.cloudHealthOnly ||
      currentUser?.role === "ceo" ||
      currentUser?.role === "head_of_business" ||
      currentUser?.role === "country_gm",
  );

  return (
    <div className="flex h-screen">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="p-5 border-b border-sidebar-border">
          <h1 className="text-lg font-bold tracking-tight text-sidebar-primary">
            HTGCLOUDS
          </h1>
          <p className="text-xs text-sidebar-foreground/60 mt-0.5">
            Internal CRM
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
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
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
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
