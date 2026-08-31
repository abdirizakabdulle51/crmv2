import { useRef, useState } from "react";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  STAGES,
  STAGE_LABELS,
  STAGE_BORDER_COLORS,
  formatCurrency,
  type LeadStage,
} from "../_lib/constants.ts";
import { CalendarDays, DollarSign } from "lucide-react";
import { format } from "date-fns";
import OpportunityTransitionDialog from "./opportunity-transition-dialog.tsx";

type KanbanBoardProps = {
  leads: Doc<"leads">[];
  companies: Doc<"companies">[];
  users: Doc<"users">[];
  quotes: Array<
    Pick<
      Doc<"quotes">,
      | "_id"
      | "_creationTime"
      | "leadId"
      | "quoteNumber"
      | "status"
      | "commercialModel"
      | "acceptedAt"
    >
  >;
  countries: Doc<"countries">[];
  sectors: Doc<"sectors">[];
  onEditLead: (lead: Doc<"leads">) => void;
};

export default function KanbanBoard({
  leads,
  companies,
  users,
  quotes,
  countries,
  sectors,
  onEditLead,
}: KanbanBoardProps) {
  const [transition, setTransition] = useState<{
    lead: Doc<"leads">;
    stage: LeadStage;
  } | null>(null);
  const dragging = useRef(false);
  const companyMap = new Map(companies.map((c) => [c._id, c]));
  const userMap = new Map(users.map((user) => [user._id, user]));

  const handleStageChange = (
    leadId: Doc<"leads">["_id"],
    newStage: LeadStage,
  ) => {
    const lead = leads.find((item) => item._id === leadId);
    if (!lead || lead.stage === newStage) return;
    setTransition({ lead, stage: newStage });
  };

  // Only show active pipeline stages in board (not won/lost by default)
  const boardStages = STAGES.filter((s) => s !== "won" && s !== "lost");

  const renderLeadCard = (lead: Doc<"leads">, compact = false) => {
    const company = lead.companyId ? companyMap.get(lead.companyId) : undefined;
    const owner = lead.accountManagerId
      ? userMap.get(lead.accountManagerId)
      : undefined;

    if (compact) {
      return (
        <Card
          key={lead._id}
          draggable
          onDragStart={(event) => (
            (dragging.current = true),
            event.dataTransfer.setData("text/opportunity-id", lead._id)
          )}
          onDragEnd={() =>
            window.setTimeout(() => (dragging.current = false), 0)
          }
          className="cursor-pointer transition-colors hover:border-primary/30"
          onClick={() => !dragging.current && onEditLead(lead)}
          role="link"
          tabIndex={0}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              onEditLead(lead);
            }
          }}
        >
          <CardContent className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{lead.title}</div>
              <div className="truncate text-xs text-muted-foreground">
                {company?.name || "New company lead"}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-medium">
                {formatCurrency(lead.potentialValue)}
              </div>
              <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                {format(new Date(lead.expectedCloseDate), "MMM d")}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card
        key={lead._id}
        draggable
        onDragStart={(event) => (
          (dragging.current = true),
          event.dataTransfer.setData("text/opportunity-id", lead._id)
        )}
        onDragEnd={() => window.setTimeout(() => (dragging.current = false), 0)}
        className="cursor-pointer transition-colors hover:border-primary/30"
        onClick={() => !dragging.current && onEditLead(lead)}
        role="link"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onEditLead(lead);
          }
        }}
      >
        <CardContent className="space-y-2 p-3">
          <div className="text-[11px] text-muted-foreground">
            {lead.opportunityNumber ?? "Opportunity"}
          </div>
          <div className="truncate text-sm font-medium">{lead.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {company?.name || "New company lead"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            Owner: {owner?.name ?? owner?.email ?? "Unassigned"}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {formatCurrency(lead.potentialValue)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {format(new Date(lead.expectedCloseDate), "MMM d")}
            </div>
          </div>
          {lead.nextAction && (
            <div className="truncate rounded bg-primary/5 px-2 py-1 text-xs text-primary/80">
              {lead.nextAction}
            </div>
          )}
          <Select
            value={lead.stage}
            onValueChange={(v) => handleStageChange(lead._id, v as LeadStage)}
          >
            <SelectTrigger
              className="h-8 w-full text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    );
  };

  const renderStageColumn = (stage: LeadStage, compactCards = false) => {
    const stageLeads = leads.filter((l) => l.stage === stage);
    const stageValue = stageLeads.reduce((sum, l) => sum + l.potentialValue, 0);

    return (
      <section
        key={stage}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const leadId = event.dataTransfer.getData("text/opportunity-id");
          if (leadId) handleStageChange(leadId as Doc<"leads">["_id"], stage);
        }}
        className="flex max-h-[calc(100vh-17rem)] min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-lg border bg-muted/20"
      >
        <div className={`border-t-4 ${STAGE_BORDER_COLORS[stage]} bg-card p-3`}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="min-w-0 truncate text-sm font-semibold">
              {STAGE_LABELS[stage]}
            </h3>
            <Badge variant="secondary" className="shrink-0 text-xs">
              {stageLeads.length}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCurrency(stageValue)}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {stageLeads.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-md border border-dashed bg-background/50 px-3 text-center text-xs text-muted-foreground">
              Drop an opportunity here
            </div>
          ) : (
            stageLeads.map((lead) => renderLeadCard(lead, compactCards))
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {boardStages.map((stage) => renderStageColumn(stage))}
      </div>

      <div>
        <div className="mb-3 border-t pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Closed pipeline
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(["won", "lost"] as LeadStage[]).map((stage) =>
            renderStageColumn(stage, true),
          )}
        </div>
      </div>
      <OpportunityTransitionDialog
        lead={transition?.lead ?? null}
        targetStage={transition?.stage ?? null}
        quotes={quotes}
        companies={companies}
        countries={countries}
        sectors={sectors}
        onClose={() => setTransition(null)}
      />
    </div>
  );
}
