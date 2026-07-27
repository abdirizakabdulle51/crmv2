import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
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
import { Lightbulb, AlertTriangle, ShieldCheck, Database, Cloud, Lock, FileWarning, DollarSign } from "lucide-react";
import { useState } from "react";
import { generateRecommendations, type Recommendation } from "./_lib/recommendation-engine.ts";

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
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">High</Badge>;
    case "medium":
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Medium</Badge>;
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

  const recommendations = generateRecommendations(companies, consumption, sectors, catalog);

  // Apply filters
  const filtered = recommendations.filter((r) => {
    if (companyFilter !== "all" && r.companyId !== companyFilter) return false;
    if (ruleFilter !== "all" && r.rule !== ruleFilter) return false;
    if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
    return true;
  });

  // Summary stats
  const highCount = recommendations.filter((r) => r.priority === "high").length;
  const mediumCount = recommendations.filter((r) => r.priority === "medium").length;
  const uniqueCompanies = new Set(recommendations.map((r) => r.companyId)).size;

  // Available rules for filter
  const availableRules = [...new Set(recommendations.map((r) => r.rule))];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Recommendations</h1>
        <p className="text-muted-foreground mt-1">
          Cross-sell opportunities based on usage patterns and company profiles
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recommendations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">High Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{highCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Medium Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{mediumCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Companies with Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueCompanies}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ruleFilter} onValueChange={setRuleFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Rules" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Rules</SelectItem>
            {availableRules.map((rule) => (
              <SelectItem key={rule} value={rule}>{RULE_LABELS[rule] || rule}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
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
      </div>

      {/* Recommendations list */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Lightbulb /></EmptyMedia>
            <EmptyTitle>
              {recommendations.length === 0 ? "No recommendations" : "No matching results"}
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
          {filtered.map((rec, idx) => (
            <Card key={`${rec.companyId}-${rec.rule}-${idx}`}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary">
                      {RULE_ICONS[rec.rule] || <Lightbulb className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{rec.companyName}</span>
                        <PriorityBadge priority={rec.priority} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {RULE_LABELS[rec.rule] || rec.rule}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 sm:ml-4">
                    <p className="text-sm text-foreground">{rec.triggerReason}</p>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">Recommend:</span> {rec.recommendedService}
                      </span>
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">Est. value:</span> {rec.estimatedValue}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
