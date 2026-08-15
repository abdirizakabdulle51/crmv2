import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty.tsx";
import {
  STAGE_LABELS,
  STAGE_COLORS,
  formatCurrency,
  type LeadStage,
} from "../_lib/constants.ts";
import { TrendingUp, CalendarDays } from "lucide-react";
import { format } from "date-fns";

type PipelineListProps = {
  leads: Doc<"leads">[];
  companies: Doc<"companies">[];
  users: Doc<"users">[];
  onEditLead: (lead: Doc<"leads">) => void;
};

export default function PipelineList({
  leads,
  companies,
  users,
  onEditLead,
}: PipelineListProps) {
  const companyMap = new Map(companies.map((c) => [c._id, c]));
  const userMap = new Map(users.map((u) => [u._id, u]));

  if (leads.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TrendingUp />
          </EmptyMedia>
          <EmptyTitle>No leads yet</EmptyTitle>
          <EmptyDescription>
            Add your first lead to start tracking your pipeline
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Sort: active leads first (by stage order), then won/lost
  const stageOrder: Record<LeadStage, number> = {
    new_lead: 0,
    qualified: 1,
    discovery: 2,
    proposal: 3,
    negotiation: 4,
    won: 5,
    lost: 6,
  };

  const sorted = [...leads].sort(
    (a, b) => stageOrder[a.stage] - stageOrder[b.stage],
  );

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <div className="col-span-3">Lead</div>
        <div className="col-span-2">Company</div>
        <div className="col-span-2">Stage</div>
        <div className="col-span-1">Value</div>
        <div className="col-span-2">Close Date</div>
        <div className="col-span-2">Account Manager</div>
      </div>

      {sorted.map((lead) => {
        const company = lead.companyId
          ? companyMap.get(lead.companyId)
          : undefined;
        const am = lead.accountManagerId
          ? userMap.get(lead.accountManagerId)
          : undefined;

        return (
          <Card
            key={lead._id}
            className="cursor-pointer hover:border-primary/30 transition-colors"
            onClick={() => onEditLead(lead)}
          >
            <CardContent className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-center py-3 px-4">
              <div className="col-span-3 min-w-0">
                <div className="font-medium text-sm truncate">{lead.title}</div>
                {lead.nextAction && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    Next: {lead.nextAction}
                  </div>
                )}
              </div>
              <div className="col-span-2 text-sm text-muted-foreground truncate">
                {company?.name || "New company lead"}
              </div>
              <div className="col-span-2">
                <Badge
                  className={`text-xs ${STAGE_COLORS[lead.stage]}`}
                  variant="secondary"
                >
                  {STAGE_LABELS[lead.stage]}
                </Badge>
              </div>
              <div className="col-span-1 text-sm font-medium">
                {formatCurrency(lead.potentialValue)}
              </div>
              <div className="col-span-2 flex items-center gap-1 text-sm text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {format(new Date(lead.expectedCloseDate), "MMM d, yyyy")}
              </div>
              <div className="col-span-2 text-sm text-muted-foreground truncate">
                {am?.name || "Unassigned"}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
