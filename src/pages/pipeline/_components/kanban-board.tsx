import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
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
import { toast } from "sonner";
import { CalendarDays, DollarSign } from "lucide-react";
import { format } from "date-fns";

type KanbanBoardProps = {
  leads: Doc<"leads">[];
  companies: Doc<"companies">[];
  users: Doc<"users">[];
  onEditLead: (lead: Doc<"leads">) => void;
};

export default function KanbanBoard({
  leads,
  companies,
  users: _users,
  onEditLead,
}: KanbanBoardProps) {
  const updateStage = useMutation(api.leads.updateStage);
  const companyMap = new Map(companies.map((c) => [c._id, c]));

  const handleStageChange = async (leadId: Doc<"leads">["_id"], newStage: LeadStage) => {
    try {
      await updateStage({ id: leadId, stage: newStage });
    } catch {
      toast.error("Failed to move lead");
    }
  };

  // Only show active pipeline stages in board (not won/lost by default)
  const boardStages = STAGES.filter((s) => s !== "won" && s !== "lost");

  const renderStageColumn = (stage: LeadStage) => {
    const stageLeads = leads.filter((l) => l.stage === stage);
    const stageValue = stageLeads.reduce(
      (sum, l) => sum + l.potentialValue,
      0,
    );

    return (
      <section
        key={stage}
        className="flex max-h-[calc(100vh-17rem)] min-h-[22rem] w-[18rem] shrink-0 flex-col overflow-hidden rounded-lg border bg-muted/20 sm:w-[20rem]"
      >
        <div
          className={`border-t-4 ${STAGE_BORDER_COLORS[stage]} bg-card p-3`}
        >
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
              No leads in this stage
            </div>
          ) : (
            stageLeads.map((lead) => {
              const company = companyMap.get(lead.companyId);
              return (
                <Card
                  key={lead._id}
                  className="cursor-pointer transition-colors hover:border-primary/30"
                  onClick={() => onEditLead(lead)}
                >
                  <CardContent className="space-y-2 p-3">
                    <div className="truncate text-sm font-medium">
                      {lead.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {company?.name || "Unknown"}
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
                      onValueChange={(v) =>
                        handleStageChange(lead._id, v as LeadStage)
                      }
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
            })
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto pb-3">
        <div className="flex min-w-max gap-4">
          {boardStages.map(renderStageColumn)}
        </div>
      </div>

      <div>
        <div className="mb-3 border-t pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Closed pipeline
        </div>
        <div className="overflow-x-auto pb-3">
          <div className="flex min-w-max gap-4">
            {(["won", "lost"] as LeadStage[]).map(renderStageColumn)}
          </div>
        </div>
      </div>
    </div>
  );
}
