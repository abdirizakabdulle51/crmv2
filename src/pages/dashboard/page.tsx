import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useCrm, getRoleLabel } from "@/lib/crm-context.tsx";
import { isDrMode } from "@/lib/dr-mode.ts";
import {
  AlertTriangle,
  Brain,
  Building2,
  ClipboardList,
  Cloud,
  DollarSign,
  FileText,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const CURRENT_YEAR = new Date().getFullYear();

type FinanceActivityPoint = {
  period: string;
  label: string;
  invoicesSent: number;
  invoicesPaid: number;
  expenses: number;
};

type DashboardSummary = {
  year: number;
  month: string;
  companies: { total: number; activeContracts: number };
  leads: { active: number; won: number; wonValue: number };
  targets: { target: number; achieved: number; achievementPercent: number };
  collectionSummary: {
    target: number;
    collected: number;
    remaining: number;
    achievementPercent: number;
    outstanding: number;
    totalInvoiced: number;
  };
  pipeline: { stageCounts: Record<string, number>; value: number };
  usage: {
    month: string;
    total: number;
    entries: number;
    companiesWithUsage: number;
  };
  quotes: {
    total: number;
    draft: number;
    sent: number;
    accepted: number;
    monthlyValue: number;
    acceptedMonthlyValue: number;
  };
  aiRecommendations: {
    openOpportunityCount: number;
    highPriorityCount: number;
    estimatedMonthlyValue: number;
    companiesWithOpportunities: number;
  };
  atRisk: { count: number };
  tasks: {
    myOpen: number;
    overdue: number;
    dueThisWeek: number;
    blocked: number;
  };
  cloudHealth: {
    regions: number;
    healthyRegions: number;
    warningRegions: number;
    criticalRegions: number;
    activePingTargets: number;
    upPingTargets: number;
    downPingTargets: number;
  } | null;
  charts: {
    accountManagers: {
      name: string;
      fullName: string;
      target: number;
      achieved: number;
      percentage: number;
    }[];
    countries: {
      name: string;
      target: number;
      achieved: number;
      percentage: number;
    }[];
  };
  financeActivity: {
    countries: { id: string; name: string }[];
    daily: {
      overall: FinanceActivityPoint[];
      byCountry: Record<string, FinanceActivityPoint[]>;
    };
    monthly: {
      overall: FinanceActivityPoint[];
      byCountry: Record<string, FinanceActivityPoint[]>;
    };
  } | null;
};

function useDrDashboardSummary(year: number, enabled: boolean) {
  const [summary, setSummary] = useState<DashboardSummary | undefined>();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    setSummary(undefined);

    fetch(`/api/dashboard/summary?year=${year}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Dashboard summary failed: ${response.status}`);
        }
        return response.json() as Promise<DashboardSummary>;
      })
      .then(setSummary)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      });

    return () => controller.abort();
  }, [enabled, year]);

  return summary;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function tooltipFormatter(value: unknown): string {
  return formatCurrency(Number(value));
}

function financeTooltipFormatter(value: unknown, name: unknown) {
  return [formatCurrency(Number(value)), String(name)];
}

function formatMonthLabel(month: string | undefined): string | null {
  if (!month) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, monthNumber - 1, 1));
}

function amLabelFormatter(
  label: unknown,
  amChartData: { name: string; fullName: string }[],
): string {
  const item = amChartData.find((d) => d.name === String(label));
  return item?.fullName || String(label);
}

function ClickableCard({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Card
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer transition-colors hover:border-primary/60 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {children}
    </Card>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  onClick,
}: {
  title: string;
  value: ReactNode;
  subtitle: ReactNode;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <ClickableCard onClick={onClick}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </ClickableCard>
  );
}

function stageLabel(stage: string) {
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function canViewFinanceActivity(role: string | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function ExecutiveCollectionSummaryCard({
  summary,
  onClick,
}: {
  summary: DashboardSummary["collectionSummary"];
  onClick: () => void;
}) {
  const collectionPercent =
    summary.totalInvoiced > 0
      ? Math.round((summary.collected / summary.totalInvoiced) * 100)
      : 0;
  const collectionTone =
    collectionPercent >= 90
      ? "text-emerald-600"
      : collectionPercent >= 70
        ? "text-amber-600"
        : "text-red-600";
  const metrics = [
    {
      label: "Total Invoiced",
      value: formatCurrency(summary.totalInvoiced),
      tone: "text-foreground",
    },
    {
      label: "Paid / Collected",
      value: formatCurrency(summary.collected),
      tone: "text-emerald-600",
    },
    {
      label: "Outstanding",
      value: formatCurrency(summary.outstanding),
      tone: summary.outstanding > 0 ? "text-red-600" : "text-emerald-600",
    },
    {
      label: "Collection %",
      value: `${collectionPercent}%`,
      tone: collectionTone,
    },
  ];

  return (
    <ClickableCard onClick={onClick}>
      <CardHeader className="gap-1">
        <CardTitle className="text-base">
          Executive Collection Summary
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Invoice collection status for valid CRM invoices
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-md border bg-background/50 p-3"
            >
              <p className="text-xs font-medium uppercase text-muted-foreground">
                {metric.label}
              </p>
              <p className={`mt-2 text-2xl font-bold ${metric.tone}`}>
                {metric.value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Target remaining: {formatCurrency(summary.remaining)}
        </p>
      </CardContent>
    </ClickableCard>
  );
}

function FinanceActivityChart({
  financeActivity,
}: {
  financeActivity: NonNullable<DashboardSummary["financeActivity"]>;
}) {
  const [breakdown, setBreakdown] = useState<"daily" | "monthly">("monthly");
  const [countryId, setCountryId] = useState("overall");
  const rows =
    countryId === "overall"
      ? financeActivity[breakdown].overall
      : (financeActivity[breakdown].byCountry[countryId] ?? []);
  const chartRows =
    breakdown === "monthly"
      ? rows
      : rows.filter(
          (row) =>
            row.invoicesSent > 0 || row.invoicesPaid > 0 || row.expenses > 0,
        );

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base">Finance Activity</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Invoices sent, payments received, and paid expenses
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={countryId} onValueChange={setCountryId}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {financeActivity.countries.map((country) => (
                  <SelectItem key={country.id} value={country.id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={breakdown}
              onValueChange={(value) =>
                setBreakdown(value as "daily" | "monthly")
              }
            >
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {chartRows.length > 0 ? (
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartRows}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="label" className="text-xs" />
                <YAxis tickFormatter={formatCompact} className="text-xs" />
                <Tooltip formatter={financeTooltipFormatter} />
                <Legend />
                <Bar
                  dataKey="invoicesSent"
                  name="Invoices Sent"
                  fill="oklch(0.6 0.2 260)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="invoicesPaid"
                  name="Invoices Paid"
                  fill="oklch(0.6 0.15 170)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses"
                  fill="oklch(0.65 0.18 45)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No finance activity found for this selection.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { currentUser } = useCrm();
  const navigate = useNavigate();
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const convexSummary = useQuery(
    api.dashboard.summary,
    isDrMode ? "skip" : { year: selectedYear },
  );
  const drSummary = useDrDashboardSummary(selectedYear, isDrMode);
  const summary = isDrMode ? drSummary : convexSummary;
  const isLoading = summary === undefined;

  const amChartData = summary?.charts.accountManagers ?? [];
  const countryChartData = summary?.charts.countries ?? [];
  const companyWideTarget = summary?.targets.target ?? 0;
  const companyWideAchieved = summary?.targets.achieved ?? 0;
  const companyWidePercentage = summary?.targets.achievementPercent ?? 0;
  const pipelineStageCounts = (summary?.pipeline.stageCounts ??
    {}) as Record<string, number>;
  const openPipelineStages = Object.entries(pipelineStageCounts).filter(
    ([stage]) => stage !== "won" && stage !== "lost",
  );
  const usageMonthLabel = formatMonthLabel(summary?.usage.month);
  const financeActivity = summary?.financeActivity;
  const collectionSummary = summary?.collectionSummary;
  const taskSubtitle = `${summary?.tasks.overdue ?? 0} overdue · ${
    summary?.tasks.dueThisWeek ?? 0
  } due this week${
    (summary?.tasks.blocked ?? 0) > 0
      ? ` · ${summary?.tasks.blocked ?? 0} blocked`
      : ""
  }`;

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back, {currentUser?.name || "User"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {getRoleLabel(currentUser?.role)} - HTGCLOUDS CRM Overview
          </p>
        </div>
        <Select
          value={selectedYear.toString()}
          onValueChange={(v) => setSelectedYear(Number(v))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
              <SelectItem key={y} value={y.toString()}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="executive" className="space-y-6">
        <TabsList className="grid w-full max-w-xl grid-cols-2">
          <TabsTrigger value="executive">Executive Summary</TabsTrigger>
          <TabsTrigger value="details">Operational Details</TabsTrigger>
        </TabsList>

        <TabsContent value="executive" className="space-y-8">
          {companyWideTarget > 0 && (
            <ClickableCard onClick={() => navigate("/targets")}>
              <CardHeader>
                <CardTitle className="text-base">
                  Company-Wide Target Progress - {selectedYear}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {formatCurrency(companyWideAchieved)} achieved
                    </span>
                    <span className="font-medium">
                      {formatCurrency(companyWideTarget)} target
                    </span>
                  </div>
                  <div className="h-4 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(companyWidePercentage, 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    {companyWidePercentage}% achieved
                  </p>
                </div>
              </CardContent>
            </ClickableCard>
          )}

          {!isLoading &&
            canViewFinanceActivity(currentUser?.role) &&
            collectionSummary && (
              <ExecutiveCollectionSummaryCard
                summary={collectionSummary}
                onClick={() => navigate("/invoices")}
              />
            )}

          {!isLoading &&
            canViewFinanceActivity(currentUser?.role) &&
            financeActivity && (
              <FinanceActivityChart financeActivity={financeActivity} />
            )}

          {!isLoading &&
            amChartData.length > 0 &&
            amChartData.some((d) => d.target > 0) && (
              <ClickableCard onClick={() => navigate("/performance")}>
                <CardHeader>
                  <CardTitle className="text-base">
                    Target vs Achieved - Per Account Manager
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={amChartData.filter(
                          (d) => d.target > 0 || d.achieved > 0,
                        )}
                        margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="opacity-30"
                        />
                        <XAxis dataKey="name" className="text-xs" />
                        <YAxis
                          tickFormatter={formatCompact}
                          className="text-xs"
                        />
                        <Tooltip
                          formatter={tooltipFormatter}
                          labelFormatter={(label) =>
                            amLabelFormatter(label, amChartData)
                          }
                        />
                        <Legend />
                        <Bar
                          dataKey="target"
                          name="Target"
                          fill="oklch(0.7 0.1 260)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          dataKey="achieved"
                          name="Achieved"
                          fill="oklch(0.6 0.2 260)"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </ClickableCard>
            )}

          {!isLoading && amChartData.some((d) => d.target > 0) && (
            <ClickableCard onClick={() => navigate("/performance")}>
              <CardHeader>
                <CardTitle className="text-base">
                  Individual Progress - {selectedYear}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {amChartData
                  .filter((d) => d.target > 0)
                  .sort((a, b) => b.percentage - a.percentage)
                  .map((am) => (
                    <div key={am.fullName} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{am.fullName}</span>
                        <span className="text-muted-foreground">
                          {am.percentage}% - {formatCurrency(am.achieved)} /{" "}
                          {formatCurrency(am.target)}
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(am.percentage, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </CardContent>
            </ClickableCard>
          )}
        </TabsContent>

        <TabsContent value="details" className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Companies"
              value={summary?.companies.total ?? "-"}
              subtitle={`${summary?.companies.activeContracts ?? 0} active contracts`}
              icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/companies")}
            />
            <MetricCard
              title="Active Leads"
              value={summary?.leads.active ?? "-"}
              subtitle="In pipeline"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/pipeline")}
            />
            <MetricCard
              title="Won Deals"
              value={summary?.leads.won ?? "-"}
              subtitle={`${formatCurrency(summary?.leads.wonValue ?? 0)} total`}
              icon={<Users className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/pipeline")}
            />
            <MetricCard
              title="Target Achievement"
              value={companyWideTarget > 0 ? `${companyWidePercentage}%` : "-"}
              subtitle={`${formatCurrency(companyWideAchieved)} / ${formatCurrency(companyWideTarget)}`}
              icon={<Target className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/targets")}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <MetricCard
              title="Pipeline Value"
              value={formatCurrency(summary?.pipeline.value ?? 0)}
              subtitle={`${summary?.leads.active ?? 0} active leads across ${openPipelineStages.length} open stages`}
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/pipeline")}
            />
            <MetricCard
              title="Latest Usage Month"
              value={formatCurrency(summary?.usage.total ?? 0)}
              subtitle={`${usageMonthLabel ? `${usageMonthLabel} · ` : ""}${summary?.usage.entries ?? 0} entries across ${summary?.usage.companiesWithUsage ?? 0} companies`}
              icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/usage")}
            />
            <MetricCard
              title="Quotes"
              value={summary?.quotes.total ?? "-"}
              subtitle={`${summary?.quotes.draft ?? 0} draft, ${summary?.quotes.sent ?? 0} sent, ${summary?.quotes.accepted ?? 0} accepted`}
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/quotes")}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            <MetricCard
              title="AI Opportunities"
              value={summary?.aiRecommendations.openOpportunityCount ?? "-"}
              subtitle={`${formatCurrency(summary?.aiRecommendations.estimatedMonthlyValue ?? 0)} estimated monthly value`}
              icon={<Brain className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/recommendations")}
            />
            <MetricCard
              title="Tasks"
              value={summary?.tasks.myOpen ?? "-"}
              subtitle={taskSubtitle}
              icon={<ClipboardList className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/tasks")}
            />
            <MetricCard
              title="At-Risk Companies"
              value={summary?.atRisk.count ?? "-"}
              subtitle="Strict 3-month usage decline"
              icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
              onClick={() => navigate("/at-risk")}
            />
            {summary?.cloudHealth && (
              <MetricCard
                title="Cloud Health"
                value={`${summary.cloudHealth.upPingTargets}/${summary.cloudHealth.activePingTargets}`}
                subtitle={`${summary.cloudHealth.healthyRegions}/${summary.cloudHealth.regions} healthy regions, ${summary.cloudHealth.downPingTargets} targets down`}
                icon={<Cloud className="h-4 w-4 text-muted-foreground" />}
                onClick={() => navigate("/cloud-health")}
              />
            )}
          </div>

          {Object.keys(pipelineStageCounts).length > 0 && (
            <ClickableCard onClick={() => navigate("/pipeline")}>
              <CardHeader>
                <CardTitle className="text-base">
                  Pipeline Stage Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                  {Object.entries(pipelineStageCounts).map(
                    ([stage, count]) => (
                      <div
                        key={stage}
                        className="rounded-md border bg-background/50 p-3"
                      >
                        <p className="text-xs text-muted-foreground">
                          {stageLabel(stage)}
                        </p>
                        <p className="mt-1 text-xl font-semibold">{count}</p>
                      </div>
                    ),
                  )}
                </div>
              </CardContent>
            </ClickableCard>
          )}

          {!isLoading && countryChartData.length > 0 && (
            <ClickableCard onClick={() => navigate("/performance")}>
              <CardHeader>
                <CardTitle className="text-base">
                  Target vs Achieved - Per Country
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={countryChartData}
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="opacity-30"
                      />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis
                        tickFormatter={formatCompact}
                        className="text-xs"
                      />
                      <Tooltip formatter={tooltipFormatter} />
                      <Legend />
                      <Bar
                        dataKey="target"
                        name="Target"
                        fill="oklch(0.7 0.1 260)"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="achieved"
                        name="Achieved"
                        fill="oklch(0.6 0.15 170)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </ClickableCard>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
