import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
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
} from "@/components/ui/empty.tsx";
import {
  Lightbulb,
  AlertTriangle,
  ShieldCheck,
  Database,
  Cloud,
  Lock,
  FileWarning,
  DollarSign,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import type { Recommendation } from "./_lib/recommendation-engine.ts";
import { formatCurrency } from "@/lib/format.ts";
import {
  ADVISOR_CATEGORY_OPTIONS,
  getAdvisorCategory,
  getAdvisorRecommendationTitle,
  getAdvisorRecommendedAction,
  getAdvisorRuleLabel,
  formatAdvisorEstimatedValue,
  type AdvisorCategory,
} from "@/lib/recommendations/advisorPresentation.ts";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

type RecommendationStatus =
  | "open"
  | "acknowledged"
  | "in_progress"
  | "snoozed"
  | "dismissed"
  | "resolved";

type StatusFilter = "active" | RecommendationStatus | "all";

type AdvisorRecommendation = Recommendation & {
  recommendationKey: string;
  status?: string;
  statusUpdatedAt?: number;
  snoozedUntil?: number;
  note?: string;
};

type StatusAction =
  | "acknowledged"
  | "in_progress"
  | "snoozed"
  | "dismissed"
  | "resolved"
  | "reopen";

const SNOOZE_OPTIONS = [
  { days: 7, label: "Snooze 7 days" },
  { days: 30, label: "Snooze 30 days" },
  { days: 90, label: "Snooze 90 days" },
];
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_progress", label: "In Progress" },
  { value: "snoozed", label: "Snoozed" },
  { value: "dismissed", label: "Dismissed" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const RULE_ICONS: Record<string, React.ReactNode> = {
  backup: <Database className="h-4 w-4" />,
  object_storage: <Cloud className="h-4 w-4" />,
  log_management: <FileWarning className="h-4 w-4" />,
  secure_connectivity: <Lock className="h-4 w-4" />,
  waf: <ShieldCheck className="h-4 w-4" />,
  payment_risk: <DollarSign className="h-4 w-4" />,
  compliance: <AlertTriangle className="h-4 w-4" />,
};

function PriorityBadge({ priority }: { priority: Recommendation["priority"] }) {
  switch (priority) {
    case "high":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          High
        </Badge>
      );
    case "medium":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Medium
        </Badge>
      );
    case "low":
      return <Badge variant="secondary">Low</Badge>;
  }
}

function getRecommendationStatus(
  recommendation: AdvisorRecommendation,
): RecommendationStatus {
  if (
    recommendation.status === "open" ||
    recommendation.status === "acknowledged" ||
    recommendation.status === "in_progress" ||
    recommendation.status === "snoozed" ||
    recommendation.status === "dismissed" ||
    recommendation.status === "resolved"
  ) {
    return recommendation.status;
  }
  return "open";
}

function isActiveStatus(status: RecommendationStatus) {
  return (
    status === "open" ||
    status === "acknowledged" ||
    status === "in_progress"
  );
}

function StatusBadge({ status }: { status: RecommendationStatus }) {
  if (status === "open") {
    return <Badge className="bg-primary/10 text-primary">Open</Badge>;
  }
  if (status === "acknowledged") {
    return <Badge variant="outline">Acknowledged</Badge>;
  }
  if (status === "in_progress") {
    return (
      <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
        In Progress
      </Badge>
    );
  }
  if (status === "snoozed") {
    return (
      <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">
        Snoozed
      </Badge>
    );
  }
  if (status === "dismissed") {
    return <Badge variant="secondary">Dismissed</Badge>;
  }
  return (
    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
      Resolved
    </Badge>
  );
}

function formatStatusDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

function getStatusActions(status: RecommendationStatus): StatusAction[] {
  if (status === "open") {
    return ["acknowledged", "in_progress", "snoozed", "dismissed", "resolved"];
  }
  if (status === "acknowledged") {
    return ["in_progress", "snoozed", "resolved", "dismissed", "reopen"];
  }
  if (status === "in_progress") {
    return ["snoozed", "resolved", "dismissed", "reopen"];
  }
  return ["reopen"];
}

function getActionLabel(action: StatusAction) {
  if (action === "acknowledged") return "Acknowledge";
  if (action === "in_progress") return "Start Progress";
  if (action === "snoozed") return "Snooze";
  if (action === "dismissed") return "Dismiss";
  if (action === "resolved") return "Resolve";
  return "Reopen";
}

function getActionSuccessMessage(action: StatusAction) {
  if (action === "acknowledged") return "Recommendation acknowledged";
  if (action === "in_progress") return "Recommendation marked in progress";
  if (action === "snoozed") return "Recommendation snoozed";
  if (action === "dismissed") return "Recommendation dismissed";
  if (action === "resolved") return "Recommendation resolved";
  return "Recommendation reopened";
}

export default function RecommendationsPage() {
  const companies = useQuery(api.companies.list, {});
  const recommendations = useQuery(api.recommendations.listComputed, {});
  const aiRecommendations = useQuery(api.aiRecommendations.listVisible, {});
  const setRecommendationStatus = useMutation(
    api.cloudAdvisorStatuses.setRecommendationStatus,
  );
  const reopenRecommendation = useMutation(
    api.cloudAdvisorStatuses.reopenRecommendation,
  );

  const [companyFilter, setCompanyFilter] = useState("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState<AdvisorCategory>("All");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const handleStatusAction = async (
    recommendation: AdvisorRecommendation,
    action: StatusAction,
    snoozeDays?: number,
  ) => {
    const actionKey = `${recommendation.recommendationKey}:${action}${
      snoozeDays ? `:${snoozeDays}` : ""
    }`;
    setPendingAction(actionKey);
    try {
      if (action === "reopen") {
        await reopenRecommendation({
          recommendationKey: recommendation.recommendationKey,
        });
      } else {
        await setRecommendationStatus({
          recommendationKey: recommendation.recommendationKey,
          companyId: recommendation.companyId,
          rule: recommendation.rule,
          recommendedService: recommendation.recommendedService,
          status: action,
          ...(action === "snoozed" && snoozeDays
            ? { snoozedUntil: Date.now() + snoozeDays * DAY_IN_MS }
            : {}),
        });
      }
      toast.success(getActionSuccessMessage(action));
    } catch {
      toast.error("Failed to update recommendation status");
    } finally {
      setPendingAction(null);
    }
  };

  const startEditingNote = (recommendation: AdvisorRecommendation) => {
    setNoteDrafts((drafts) => ({
      ...drafts,
      [recommendation.recommendationKey]: recommendation.note ?? "",
    }));
    setEditingNoteKey(recommendation.recommendationKey);
  };

  const handleSaveNote = async (recommendation: AdvisorRecommendation) => {
    const status = getRecommendationStatus(recommendation);
    if (status === "open") {
      toast.error("Set a status before adding a note");
      return;
    }
    if (status === "snoozed" && recommendation.snoozedUntil === undefined) {
      toast.error("Snoozed recommendations need a snooze date");
      return;
    }

    const actionKey = `${recommendation.recommendationKey}:note`;
    setPendingAction(actionKey);
    try {
      await setRecommendationStatus({
        recommendationKey: recommendation.recommendationKey,
        companyId: recommendation.companyId,
        rule: recommendation.rule,
        recommendedService: recommendation.recommendedService,
        status,
        ...(status === "snoozed"
          ? { snoozedUntil: recommendation.snoozedUntil }
          : {}),
        note: noteDrafts[recommendation.recommendationKey] ?? "",
      });
      toast.success("Recommendation note saved");
      setEditingNoteKey(null);
    } catch {
      toast.error("Failed to save recommendation note");
    } finally {
      setPendingAction(null);
    }
  };

  if (!companies || !recommendations || !aiRecommendations) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const aiByCompany = new Map(
    aiRecommendations.map((row) => [row.companyId, row]),
  );

  // Apply filters
  const filtered = recommendations.filter((r: AdvisorRecommendation) => {
    const status = getRecommendationStatus(r);
    if (companyFilter !== "all" && r.companyId !== companyFilter) return false;
    if (ruleFilter !== "all" && r.rule !== ruleFilter) return false;
    if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
    if (statusFilter === "active" && !isActiveStatus(status)) return false;
    if (statusFilter !== "active" && statusFilter !== "all") {
      return status === statusFilter;
    }
    if (
      categoryFilter !== "All" &&
      getAdvisorCategory(r.rule) !== categoryFilter
    ) {
      return false;
    }
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, pageCount);
  const pageStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filtered.length);
  const paginatedRecommendations = filtered.slice(pageStart - 1, pageEnd);
  const seenAiCompanies = new Set<Recommendation["companyId"]>();
  const recommendationRows = paginatedRecommendations.flatMap((rec, idx) => {
    const aiRow = aiByCompany.get(rec.companyId);
    const shouldShowAi = aiRow && !seenAiCompanies.has(rec.companyId);
    seenAiCompanies.add(rec.companyId);
    return [
      ...(shouldShowAi
        ? [{ type: "ai" as const, row: aiRow as Doc<"aiRecommendations"> }]
        : []),
      { type: "recommendation" as const, rec, idx },
    ];
  });

  // Summary stats
  const highCount = recommendations.filter((r) => r.priority === "high").length;
  const estimatedMonthlyValue = recommendations.reduce(
    (sum, recommendation) =>
      sum + (recommendation.estimatedMonthlyValue ?? 0),
    0,
  );
  const uniqueCompanies = new Set(recommendations.map((r) => r.companyId)).size;

  // Available rules for filter
  const availableRules = [...new Set(recommendations.map((r) => r.rule))];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cloud Advisor</h1>
        <p className="text-muted-foreground mt-1">
          Advisor recommendations are based on usage, catalog, company, and
          cloud signals. AI narratives summarize the rule-based findings.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Open Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recommendations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              High Priority
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{highCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Estimated Monthly Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(estimatedMonthlyValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Companies with Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueCompanies}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {ADVISOR_CATEGORY_OPTIONS.map((category) => (
          <Button
            key={category}
            type="button"
            variant={categoryFilter === category ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setCategoryFilter(category);
              setCurrentPage(1);
            }}
          >
            {category}
          </Button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select
          value={companyFilter}
          onValueChange={(value) => {
            setCompanyFilter(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={ruleFilter}
          onValueChange={(value) => {
            setRuleFilter(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Rules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Rules</SelectItem>
            {availableRules.map((rule) => (
              <SelectItem key={rule} value={rule}>
                {getAdvisorRuleLabel(rule)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priorityFilter}
          onValueChange={(value) => {
            setPriorityFilter(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as StatusFilter);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[170px]" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setCurrentPage(1);
          }}
        >
          <SelectTrigger
            className="w-[150px]"
            aria-label="Recommendations per page"
          >
            <SelectValue placeholder="Per page" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Recommendations list */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Lightbulb />
            </EmptyMedia>
            <EmptyTitle>
              {recommendations.length === 0
                ? "No recommendations"
                : "No matching results"}
            </EmptyTitle>
            <EmptyDescription>
              {recommendations.length === 0
                ? "Recommendations will appear once companies have usage data and service catalog items are configured"
                : "Adjust your filters to see recommendations"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {pageStart}-{pageEnd} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <span>
                Page {safePage} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === pageCount}
                onClick={() =>
                  setCurrentPage((page) => Math.min(pageCount, page + 1))
                }
              >
                Next
              </Button>
            </div>
          </div>
          {recommendationRows.map((row) =>
            row.type === "ai" ? (
              <Card
                key={`ai-${row.row.companyId}`}
                className="border-primary/30 bg-primary/5"
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-primary text-primary-foreground">
                        AI-generated
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Generated{" "}
                        {new Date(row.row.generatedAt).toLocaleDateString()}
                        {row.row.model ? ` with ${row.row.model}` : ""}
                      </span>
                      {row.row.topPriority ? (
                        <Badge variant="outline">
                          Top priority: {row.row.topPriority}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm leading-6 text-foreground">
                      {row.row.narrative}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card key={`${row.rec.companyId}-${row.rec.rule}-${row.idx}`}>
                <CardContent className="space-y-4 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {RULE_ICONS[row.rec.rule] || (
                          <Lightbulb className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold leading-6 text-foreground">
                          {getAdvisorRecommendationTitle(row.rec)}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {row.rec.companyName} · Source rule:{" "}
                          {getAdvisorRuleLabel(row.rec.rule)}
                        </p>
                        {row.rec.statusUpdatedAt || row.rec.snoozedUntil ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.rec.statusUpdatedAt
                              ? `Updated ${formatStatusDate(row.rec.statusUpdatedAt)}`
                              : null}
                            {row.rec.statusUpdatedAt && row.rec.snoozedUntil
                              ? " · "
                              : null}
                            {row.rec.snoozedUntil
                              ? `Snoozed until ${formatStatusDate(row.rec.snoozedUntil)}`
                              : null}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <StatusBadge
                        status={getRecommendationStatus(row.rec)}
                      />
                      <PriorityBadge priority={row.rec.priority} />
                      <Badge variant="outline">
                        {getAdvisorCategory(row.rec.rule)}
                      </Badge>
                      <Badge variant="secondary">
                        {formatAdvisorEstimatedValue(row.rec)}
                      </Badge>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Reason
                    </div>
                    <p className="mt-1 text-sm text-foreground">
                      {row.rec.triggerReason}
                    </p>
                  </div>

                  <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Evidence
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {row.rec.estimateBasis ?? "Rule-based usage signal"}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Catalog Item
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {row.rec.estimateCatalogItemName ?? "Not specified"}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Source Rule
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {row.rec.rule}
                      </p>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        Service
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {row.rec.recommendedService}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <span className="font-medium text-foreground">
                      Recommended action:
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {getAdvisorRecommendedAction(row.rec)}
                    </span>
                  </div>

                  {getRecommendationStatus(row.rec) !== "open" ||
                  row.rec.note ? (
                    <div className="rounded-lg border bg-muted/10 p-3 text-sm">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium uppercase text-muted-foreground">
                          Workflow note
                        </span>
                        {editingNoteKey !== row.rec.recommendationKey ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => startEditingNote(row.rec)}
                          >
                            {row.rec.note ? "Edit note" : "Add note"}
                          </Button>
                        ) : null}
                      </div>
                      {editingNoteKey === row.rec.recommendationKey ? (
                        <div className="space-y-2">
                          <Textarea
                            value={
                              noteDrafts[row.rec.recommendationKey] ?? ""
                            }
                            maxLength={300}
                            rows={3}
                            placeholder="Add a short workflow note..."
                            onChange={(event) =>
                              setNoteDrafts((drafts) => ({
                                ...drafts,
                                [row.rec.recommendationKey]:
                                  event.target.value,
                              }))
                            }
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">
                              {(noteDrafts[row.rec.recommendationKey] ?? "")
                                .length}
                              /300
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingNoteKey(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={
                                  pendingAction ===
                                  `${row.rec.recommendationKey}:note`
                                }
                                onClick={() => void handleSaveNote(row.rec)}
                              >
                                {pendingAction ===
                                `${row.rec.recommendationKey}:note`
                                  ? "Saving..."
                                  : "Save note"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : row.rec.note ? (
                        <p className="text-muted-foreground">{row.rec.note}</p>
                      ) : (
                        <p className="text-muted-foreground">
                          No workflow note yet.
                        </p>
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      Status actions
                    </span>
                    {getStatusActions(getRecommendationStatus(row.rec)).map(
                      (action) => {
                        if (action === "snoozed") {
                          const isSnoozing = pendingAction?.startsWith(
                            `${row.rec.recommendationKey}:snoozed`,
                          );
                          return (
                            <Select
                              key={action}
                              value=""
                              onValueChange={(value) =>
                                void handleStatusAction(
                                  row.rec,
                                  "snoozed",
                                  Number(value),
                                )
                              }
                              disabled={isSnoozing}
                            >
                              <SelectTrigger
                                className="h-8 w-[132px]"
                                aria-label="Snooze"
                              >
                                <SelectValue
                                  placeholder={
                                    isSnoozing ? "Saving..." : "Snooze"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {SNOOZE_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={option.days}
                                    value={String(option.days)}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          );
                        }

                        const actionKey = `${row.rec.recommendationKey}:${action}`;
                        const isPending = pendingAction === actionKey;
                        return (
                          <Button
                            key={action}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => void handleStatusAction(row.rec, action)}
                          >
                            {isPending ? "Saving..." : getActionLabel(action)}
                          </Button>
                        );
                      },
                    )}
                    {row.rec.recommendationKey ? (
                      <Button asChild variant="secondary" size="sm">
                        <Link
                          to={`/quotes/from-advisor?recommendationKey=${encodeURIComponent(
                            row.rec.recommendationKey,
                          )}`}
                        >
                          <FileText className="h-4 w-4" />
                          Create Quote
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ),
          )}
          <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Showing {pageStart}-{pageEnd} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <span>
                Page {safePage} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage === pageCount}
                onClick={() =>
                  setCurrentPage((page) => Math.min(pageCount, page + 1))
                }
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
