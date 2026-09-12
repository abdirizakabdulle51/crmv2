import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Network,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

export default function HrOverviewPage() {
  const overview = useQuery(api.hr.getOverview, {});
  if (!overview) {
    return (
      <div className="space-y-5 p-6 md:p-8">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }
  const metrics = [
    { label: "Total workforce", value: overview.total, icon: Users },
    { label: "Active employees", value: overview.active, icon: ShieldCheck },
    { label: "Preboarding", value: overview.preboarding, icon: UserPlus },
    { label: "Currently on leave", value: overview.onLeave, icon: Users },
    {
      label: "Lifecycle tasks due",
      value: overview.lifecycleDue,
      icon: AlertTriangle,
    },
    {
      label: "Compliance actions",
      value: overview.complianceDue,
      icon: AlertTriangle,
    },
    {
      label: "Probation due in 30 days",
      value: overview.probationDue,
      icon: AlertTriangle,
    },
  ];
  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HR Overview</h1>
        <p className="mt-1 text-muted-foreground">
          Workforce status, security readiness, and actions requiring attention.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-3xl font-semibold">{value}</p>
              </div>
              <div className="rounded-xl bg-cyan-50 p-3 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300">
                <Icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>People workspace</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-muted/20 p-5">
            <Users className="h-5 w-5 text-cyan-600" />
            <h2 className="mt-3 font-semibold">Employee directory</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Maintain employment, country, department, compliance, and
              reporting details.
            </p>
            <Button asChild className="mt-4">
              <Link to="/people/employees">Open employees</Link>
            </Button>
          </div>
          <div className="rounded-xl border bg-muted/20 p-5">
            <Network className="h-5 w-5 text-cyan-600" />
            <h2 className="mt-3 font-semibold">Organizational chart</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Automatically follows primary and secondary manager relationships.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/people/org-chart">View organization</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
