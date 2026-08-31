import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Database, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

function formatDate(value?: number) {
  return value
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value)
    : "Never";
}

export default function DataHealthPage() {
  const health = useQuery(api.operations.healthOverview, {});
  const reconcile = useMutation(api.companies.backfillLifecycleAndNames);
  const runBilling = useMutation(api.invoices.runDueContractDraftsNow);
  const [action, setAction] = useState<"reconcile" | "billing" | null>(null);

  const execute = async (kind: "reconcile" | "billing") => {
    setAction(kind);
    try {
      if (kind === "reconcile") {
        const result = await reconcile({});
        toast.success(`Customer data reconciled (${result.updated} updated)`);
      } else {
        const result = await runBilling({});
        toast.success(`Billing run complete (${result.created} drafts, ${result.skipped} skipped)`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setAction(null);
    }
  };

  if (!health) {
    return <div className="space-y-6 p-6 md:p-8"><Skeleton className="h-9 w-64" /><div className="grid gap-4 md:grid-cols-4">{[1,2,3,4].map((item) => <Skeleton key={item} className="h-28" />)}</div><Skeleton className="h-96" /></div>;
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Health</h1>
          <p className="mt-1 text-muted-foreground">Operational readiness, billing automation, and lifecycle exceptions in one place.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!action} onClick={() => void execute("reconcile")}>
            <RefreshCw className="mr-2 h-4 w-4" />Reconcile customer data
          </Button>
          <Button disabled={!!action} onClick={() => void execute("billing")}>
            <Play className="mr-2 h-4 w-4" />Run billing now
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Open issues" value={health.summary.openIssues} icon={<AlertTriangle className="h-5 w-5 text-amber-500" />} />
        <Metric title="High priority" value={health.summary.highIssues} icon={<AlertTriangle className="h-5 w-5 text-destructive" />} />
        <Metric title="Onboarding ready" value={health.summary.onboardingComplete} icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} />
        <Metric title="Onboarding pending" value={health.summary.onboardingPending} icon={<Database className="h-5 w-5 text-blue-500" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle>Exceptions requiring attention</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {health.issues.length === 0 ? <Empty label="No lifecycle or onboarding exceptions detected." /> : health.issues.map((issue, index) => (
              <div key={`${issue.type}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0"><div className="flex items-center gap-2"><Badge variant={issue.severity === "high" ? "destructive" : "secondary"}>{issue.severity}</Badge><span className="text-xs text-muted-foreground">{issue.type.replaceAll("_", " ")}</span></div><p className="mt-1 text-sm font-medium">{issue.message}</p></div>
                {issue.href && <Button asChild size="sm" variant="outline"><Link to={issue.href}>Review</Link></Button>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Billing automation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {health.billingRuns.length === 0 ? <Empty label="No billing automation runs yet." /> : health.billingRuns.slice(0, 8).map((run) => (
              <div key={run._id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between"><span className="font-medium">{formatDate(run.startedAt)}</span><Badge variant={run.status === "completed" ? "secondary" : run.status === "failed" ? "destructive" : "outline"}>{run.status}</Badge></div>
                <p className="mt-1 text-muted-foreground">{run.trigger} · {run.contractsScanned} contracts · {run.created} created · {run.skipped} skipped</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Won opportunity onboarding</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {health.onboarding.length === 0 ? <Empty label="No won opportunities to onboard." /> : health.onboarding.map((item) => (
            <Link key={item.leadId} to={`/pipeline/${item.leadId}`} className="block rounded-lg border p-4 transition-colors hover:bg-muted/40">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{item.companyName ?? item.title}</p><p className="text-xs text-muted-foreground">{item.opportunityNumber ?? "Opportunity"} · {item.commercialModel ?? "Commercial model missing"}</p></div><Badge variant={item.complete ? "secondary" : "outline"}>{item.complete ? "Ready" : "Action needed"}</Badge></div>
              <div className="mt-3 flex flex-wrap gap-2">{Object.entries(item.checks).map(([key, ready]) => <Badge key={key} variant={ready ? "secondary" : "destructive"}>{ready ? "✓" : "!"} {key.replace(/([A-Z])/g, " $1").toLowerCase()}</Badge>)}</div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-3xl font-semibold">{value}</p></div>{icon}</CardContent></Card>;
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>;
}
