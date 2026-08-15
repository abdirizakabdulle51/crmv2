import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty.tsx";
import { Zap, TrendingUp, TrendingDown, Minus, Target, FileText, AlertCircle } from "lucide-react";
import {
  calculatePace,
  type QuarterlyTargets,
  getStatusLabel,
  getStatusColor,
  formatCurrency,
  type PaceMetrics,
} from "@/pages/performance/_lib/pace-utils.ts";
import { generateRecommendations } from "@/pages/recommendations/_lib/recommendation-engine.ts";
import { useCrm } from "@/lib/crm-context.tsx";

type CoachSummary = {
  userId: Id<"users">;
  userName: string;
  pace: PaceMetrics | null;
  activeProposals: { title: string; value: number; company: string; closeDate: string }[];
  totalProposalValue: number;
  priorities: string[];
};

export default function CoachPage() {
  const { currentUser } = useCrm();
  const users = useQuery(api.users.listAll, {});
  const leads = useQuery(api.leads.list, {});
  const targets = useQuery(api.salesTargets.list, { year: new Date().getFullYear() });
  const achievement = useQuery(api.targetAchievement.byYear, {
    year: new Date().getFullYear(),
  });
  const companies = useQuery(api.companies.list, {});
  const consumption = useQuery(api.consumption.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const catalog = useQuery(api.serviceCatalog.list, {});

  if (!users || !leads || !targets || !achievement || !companies || !consumption || !sectors || !catalog) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  const today = new Date();
  const currentYear = today.getFullYear();
  const companyMap = new Map(companies.map((c) => [c._id, c]));

  // Get AMs to build coach summaries for
  const accountManagers = users.filter((u) => u.role === "account_manager");

  // Determine which AMs to show based on current user role
  const visibleAMs = (() => {
    if (!currentUser) return [];
    if (currentUser.role === "ceo" || currentUser.role === "head_of_business") {
      return accountManagers;
    }
    if (currentUser.role === "country_gm" && currentUser.countryId) {
      return accountManagers.filter((am) => am.countryId === currentUser.countryId);
    }
    // Account manager sees only own coach
    return accountManagers.filter((am) => am._id === currentUser._id);
  })();

  // Get recommendations
  const recommendations = generateRecommendations(companies, consumption, sectors, catalog);

  // Build summaries
  const summaries: CoachSummary[] = visibleAMs.map((am) => {
    // Pace calculation
    const amTargets = targets.filter(
      (t) => t.accountManagerId === am._id && t.year === currentYear,
    );
    const quarterlyTargets: QuarterlyTargets = { q1: 0, q2: 0, q3: 0, q4: 0 };
    for (const t of amTargets) {
      const key = `q${t.quarter}` as keyof QuarterlyTargets;
      quarterlyTargets[key] = t.target;
    }

    const yearlyTarget = quarterlyTargets.q1 + quarterlyTargets.q2 + quarterlyTargets.q3 + quarterlyTargets.q4;

    // Achieved = collected invoice payments from accounts assigned to this AM.
    const achieved = achievement.byAccountManager[am._id] ?? 0;

    const pace = yearlyTarget > 0 ? calculatePace(quarterlyTargets, achieved, today) : null;

    // Active proposals (proposal + negotiation stages)
    const activeProposals = leads
      .filter(
        (l) =>
          l.accountManagerId === am._id &&
          (l.stage === "proposal" || l.stage === "negotiation"),
      )
      .map((l) => ({
        title: l.title,
        value: l.potentialValue,
        company: l.companyId
          ? companyMap.get(l.companyId)?.name || "Unknown"
          : "New company lead",
        closeDate: l.expectedCloseDate,
      }))
      .sort((a, b) => b.value - a.value);

    const totalProposalValue = activeProposals.reduce((s, p) => s + p.value, 0);

    // Generate 1-2 priority actions
    const priorities: string[] = [];

    // Priority 1: Pace-related
    if (pace && pace.status === "behind") {
      priorities.push(
        `Behind target by ${formatCurrency(Math.abs(pace.gap))} — need ${formatCurrency(pace.dailyPace)}/day to recover`,
      );
    } else if (pace && pace.status === "ahead") {
      priorities.push(
        `Ahead by ${formatCurrency(pace.gap)} — maintain momentum on active deals`,
      );
    }

    // Priority 2: Based on proposals or recommendations
    if (activeProposals.length > 0) {
      const topDeal = activeProposals[0];
      const daysUntilClose = Math.ceil(
        (new Date(topDeal.closeDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysUntilClose <= 7 && daysUntilClose > 0) {
        priorities.push(
          `${topDeal.title} (${formatCurrency(topDeal.value)}) closing in ${daysUntilClose} day${daysUntilClose !== 1 ? "s" : ""} — follow up now`,
        );
      } else if (daysUntilClose <= 0) {
        priorities.push(
          `${topDeal.title} (${formatCurrency(topDeal.value)}) past expected close — urgent follow-up needed`,
        );
      } else {
        priorities.push(
          `Push ${topDeal.title} (${formatCurrency(topDeal.value)}) toward close by ${topDeal.closeDate}`,
        );
      }
    } else {
      // No active proposals — check recommendations for their companies
      const amCompanies = companies.filter((c) => c.accountManagerId === am._id);
      const amCompanyIds = new Set(amCompanies.map((c) => c._id));
      const amRecs = recommendations.filter(
        (r) => amCompanyIds.has(r.companyId) && r.priority === "high",
      );
      if (amRecs.length > 0) {
        priorities.push(
          `Cross-sell opportunity: ${amRecs[0].companyName} — ${amRecs[0].recommendedService}`,
        );
      }
    }

    // Cap at 2 priorities
    return {
      userId: am._id,
      userName: am.name || "Unnamed AM",
      pace,
      activeProposals: activeProposals.slice(0, 5),
      totalProposalValue,
      priorities: priorities.slice(0, 2),
    };
  });

  const today_str = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily Sales Coach</h1>
        <p className="text-muted-foreground mt-1">{today_str}</p>
      </div>

      {summaries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Zap /></EmptyMedia>
            <EmptyTitle>No coaching data available</EmptyTitle>
            <EmptyDescription>
              Coaching summaries appear once account managers have targets and pipeline activity
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-4">
          {summaries.map((summary) => (
            <CoachCard key={summary.userId} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoachCard({ summary }: { summary: CoachSummary }) {
  const { pace, activeProposals, totalProposalValue, priorities, userName } = summary;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{userName}</CardTitle>
          {pace && (
            <Badge className={getStatusColor(pace.status)}>
              {pace.status === "ahead" && <TrendingUp className="h-3 w-3 mr-1" />}
              {pace.status === "behind" && <TrendingDown className="h-3 w-3 mr-1" />}
              {pace.status === "on_track" && <Minus className="h-3 w-3 mr-1" />}
              {getStatusLabel(pace.status)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pace summary row */}
        {pace && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Target (Year)</div>
              <div className="font-semibold">{formatCurrency(pace.yearlyTarget)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Expected to Date</div>
              <div className="font-semibold">{formatCurrency(pace.expectedToDate)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Achieved</div>
              <div className="font-semibold">{formatCurrency(pace.achieved)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Gap</div>
              <div className={`font-semibold ${pace.gap >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {pace.gap >= 0 ? "+" : ""}{formatCurrency(pace.gap)}
              </div>
            </div>
          </div>
        )}

        {/* Active proposals */}
        {activeProposals.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Active Proposals ({activeProposals.length}) · {formatCurrency(totalProposalValue)} total
              </span>
            </div>
            <div className="space-y-1">
              {activeProposals.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{p.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">({p.company})</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="font-medium">{formatCurrency(p.value)}</span>
                    <span className="text-xs text-muted-foreground">{p.closeDate}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Priority actions */}
        {priorities.length > 0 && (
          <div className="border-t pt-3">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary uppercase tracking-wide">
                Today&#39;s priorities
              </span>
            </div>
            <div className="space-y-1.5">
              {priorities.map((priority, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>{priority}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No pace + no proposals */}
        {!pace && activeProposals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No targets or pipeline activity yet. Set quarterly targets and add deals to see coaching.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
