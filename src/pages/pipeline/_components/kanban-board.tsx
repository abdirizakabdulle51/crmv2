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
  users,
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

  return (
    <div className="space-y-4">
      {/* Board columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {boardStages.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage === stage);
          const stageValue = stageLeads.reduce(
            (sum, l) => sum + l.potentialValue,
            0,
          );

          return (
            <div key={stage} className="space-y-3">
              <div
                className={`rounded-lg border border-t-4 ${STAGE_BORDER_COLORS[stage]} bg-card p-3`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">
                    {STAGE_LABELS[stage]}
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {stageLeads.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(stageValue)}
                </p>
              </div>

              <div className="space-y-2 min-h-[100px]">
                {stageLeads.map((lead) => {
                  const company = companyMap.get(lead.companyId);
                  return (
                    <Card
                      key={lead._id}
                      className="cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => onEditLead(lead)}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="font-medium text-sm truncate">
                          {lead.title}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {company?.name || "Unknown"}
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <DollarSign className="h-3 w-3" />
                            {formatCurrency(lead.potentialValue)}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            {format(new Date(lead.expectedCloseDate), "MMM d")}
                          </div>
                        </div>
                        {lead.nextAction && (
                          <div className="text-xs text-primary/80 bg-primary/5 rounded px-2 py-1 truncate">
                            {lead.nextAction}
                          </div>
                        )}
                        {/* Quick stage move */}
                        <Select
                          value={lead.stage}
                          onValueChange={(v) =>
                            handleStageChange(lead._id, v as LeadStage)
                          }
                        >
                          <SelectTrigger
                            className="h-7 text-xs"
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
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Won/Lost section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
        {(["won", "lost"] as LeadStage[]).map((stage) => {
          const stageLeads = leads.filter((l) => l.stage === stage);
          return (
            <div key={stage}>
              <div className={`rounded-lg border border-t-4 ${STAGE_BORDER_COLORS[stage]} bg-card p-3 mb-3`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">{STAGE_LABELS[stage]}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {stageLeads.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(
                    stageLeads.reduce((sum, l) => sum + l.potentialValue, 0),
                  )}
                </p>
              </div>
              <div className="space-y-2">
                {stageLeads.slice(0, 3).map((lead) => {
                  const company = companyMap.get(lead.companyId);
                  return (
                    <Card
                      key={lead._id}
                      className="cursor-pointer hover:border-primary/30 transition-colors"
                      onClick={() => onEditLead(lead)}
                    >
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {lead.title}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {company?.name}
                          </div>
                        </div>
                        <span className="text-sm font-medium">
                          {formatCurrency(lead.potentialValue)}
                        </span>
                      </CardContent>
                    </Card>
                  );
                })}
                {stageLeads.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center py-1">
                    +{stageLeads.length - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
