import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
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
} from "lucide-react";
import { useState } from "react";
import {
  generateRecommendations,
  type Recommendation,
} from "./_lib/recommendation-engine.ts";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const RULE_ICONS: Record<string, React.ReactNode> = {
  backup: <Database className="h-4 w-4" />,
  object_storage: <Cloud className="h-4 w-4" />,
  log_management: <FileWarning className="h-4 w-4" />,
  secure_connectivity: <Lock className="h-4 w-4" />,
  waf: <ShieldCheck className="h-4 w-4" />,
  payment_risk: <DollarSign className="h-4 w-4" />,
  compliance: <AlertTriangle className="h-4 w-4" />,
};

const RULE_LABELS: Record<string, string> = {
  backup: "Backup",
  object_storage: "Object Storage",
  log_management: "Log Management",
  secure_connectivity: "Connectivity",
  waf: "WAF",
  payment_risk: "Payment Risk",
  compliance: "Compliance",
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

export default function RecommendationsPage() {
  const companies = useQuery(api.companies.list, {});
  const consumption = useQuery(api.consumption.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const catalog = useQuery(api.serviceCatalog.list, {});

  const [companyFilter, setCompanyFilter] = useState("all");
  const [ruleFilter, setRuleFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  if (!companies || !consumption || !sectors || !catalog) {
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

  const recommendations = generateRecommendations(
    companies,
    consumption,
    sectors,
    catalog,
  );

  // Apply filters
  const filtered = recommendations.filter((r) => {
    if (companyFilter !== "all" && r.companyId !== companyFilter) return false;
    if (ruleFilter !== "all" && r.rule !== ruleFilter) return false;
    if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, pageCount);
  const pageStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filtered.length);
  const paginatedRecommendations = filtered.slice(pageStart - 1, pageEnd);

  // Summary stats
  const highCount = recommendations.filter((r) => r.priority === "high").length;
  const mediumCount = recommendations.filter(
    (r) => r.priority === "medium",
  ).length;
  const uniqueCompanies = new Set(recommendations.map((r) => r.companyId)).size;

  // Available rules for filter
  const availableRules = [...new Set(recommendations.map((r) => r.rule))];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          AI Recommendations
        </h1>
        <p className="text-muted-foreground mt-1">
          Cross-sell opportunities based on usage patterns and company profiles
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Recommendations
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
              Medium Priority
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {mediumCount}
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
                {RULE_LABELS[rule] || rule}
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
          {paginatedRecommendations.map((rec, idx) => (
            <Card key={`${rec.companyId}-${rec.rule}-${idx}`}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
                      {RULE_ICONS[rec.rule] || (
                        <Lightbulb className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          {rec.companyName}
                        </span>
                        <PriorityBadge priority={rec.priority} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {RULE_LABELS[rec.rule] || rec.rule}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 sm:ml-4">
                    <p className="text-sm text-foreground">
                      {rec.triggerReason}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Recommend:
                        </span>{" "}
                        {rec.recommendedService}
                      </span>
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Est. value:
                        </span>{" "}
                        {rec.estimatedValue}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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
