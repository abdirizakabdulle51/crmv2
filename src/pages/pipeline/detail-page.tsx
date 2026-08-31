import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Pencil,
  Plus,
  Send,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { STAGES, STAGE_LABELS, type LeadStage } from "./_lib/constants.ts";
import LeadDialog from "./_components/lead-dialog.tsx";

const ACTIVITY_LABELS: Record<string, string> = {
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  note: "Note",
  follow_up: "Follow-up",
  proposal_sent: "Proposal sent",
  quote_created: "Quote created",
  quote_sent: "Quote sent",
  quote_accepted: "Quote accepted",
  stage_changed: "Stage changed",
  won: "Opportunity won",
  lost: "Opportunity lost",
};

export default function OpportunityDetailPage() {
  const { id } = useParams();
  const opportunityId = id as Id<"leads">;
  const navigate = useNavigate();
  const opportunity = useQuery(api.leads.getById, { id: opportunityId });
  const quotes = useQuery(api.quotes.listByLead, { leadId: opportunityId });
  const activities = useQuery(api.activities.listByLead, {
    leadId: opportunityId,
  });
  const companies = useQuery(api.companies.list, {}) ?? [];
  const users = useQuery(api.users.listAll, {}) ?? [];
  const updateStage = useMutation(api.leads.updateStage);
  const createActivity = useMutation(api.activities.create);
  const [activityType, setActivityType] = useState<
    "call" | "meeting" | "email" | "note" | "follow_up"
  >("note");
  const [description, setDescription] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (!opportunity || !quotes || !activities) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const company = companies.find((row) => row._id === opportunity.companyId);
  const owner = users.find((row) => row._id === opportunity.accountManagerId);
  const hasAcceptedQuote = quotes.some((quote) => quote.status === "accepted");
  const stageGuidance =
    opportunity.stage === "proposal"
      ? quotes.length === 0
        ? "Create the opportunity quote to continue."
        : "Send the draft quote and record customer feedback."
      : opportunity.stage === "negotiation"
        ? hasAcceptedQuote
          ? "The quote is accepted. Mark this opportunity won to begin onboarding."
          : "Follow up, revise the quote if needed, and record the outcome."
        : opportunity.stage === "won"
          ? "Customer onboarding is ready for the contracted or PAYG path."
          : "Complete qualification details and move the opportunity toward proposal.";

  const changeStage = async (stage: LeadStage) => {
    if (stage === "lost" && !lossReason.trim()) {
      toast.error("Enter a loss reason first");
      return;
    }
    setPending(true);
    try {
      await updateStage({
        id: opportunityId,
        stage,
        lossReason: stage === "lost" ? lossReason.trim() : undefined,
      });
      toast.success(`Opportunity moved to ${STAGE_LABELS[stage]}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not change stage",
      );
    } finally {
      setPending(false);
    }
  };

  const logActivity = async () => {
    if (!description.trim()) return;
    setPending(true);
    try {
      await createActivity({
        leadId: opportunityId,
        type: activityType,
        description: description.trim(),
        date: new Date().toISOString(),
      });
      setDescription("");
      toast.success("Activity logged");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not log activity",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button
        variant="ghost"
        className="-ml-2"
        onClick={() => navigate("/pipeline")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Opportunities
      </Button>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm text-muted-foreground">
            {opportunity.opportunityNumber ?? "Opportunity"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {opportunity.title}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {company?.name ?? "Prospect organization pending"} · Owner:{" "}
            {owner?.name ?? owner?.email ?? "Unassigned"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit Details
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              navigate(`/quotes/new?opportunityId=${opportunityId}`)
            }
          >
            <FileText className="mr-2 h-4 w-4" />
            Create Opportunity Quote
          </Button>
          {opportunity.stage === "won" && (
            <Button
              onClick={() =>
                navigate(
                  hasAcceptedQuote &&
                    quotes[0]?.commercialModel === "contracted"
                    ? `/finance/customer-contracts/new?quoteId=${quotes.find((q) => q.status === "accepted")?._id}`
                    : `/companies/${opportunity.companyId}`,
                )
              }
            >
              Continue Onboarding
            </Button>
          )}
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Recommended next step</div>
            <div className="text-sm text-muted-foreground">{stageGuidance}</div>
          </div>
          {opportunity.stage === "proposal" && quotes.length === 0 && (
            <Button
              onClick={() =>
                navigate(`/quotes/new?opportunityId=${opportunityId}`)
              }
            >
              Create Quote
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Stage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge>{STAGE_LABELS[opportunity.stage]}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Expected value
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatCurrency(opportunity.potentialValue)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Expected close
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 font-medium">
            <CalendarDays className="h-4 w-4" />
            {new Date(opportunity.expectedCloseDate).toLocaleDateString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Quotes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {quotes.length}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.25fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Opportunity details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-muted-foreground">Primary contact</Label>
                <p className="mt-1">
                  {opportunity.contactName ??
                    company?.contactName ??
                    "Not recorded"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Email</Label>
                <p className="mt-1">
                  {opportunity.contactEmail ??
                    company?.contactEmail ??
                    "Not recorded"}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Source</Label>
                <p className="mt-1">{opportunity.source ?? "Not recorded"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Next action</Label>
                <p className="mt-1">
                  {opportunity.nextAction ?? "Not scheduled"}
                </p>
              </div>
              {opportunity.notes && (
                <div className="sm:col-span-2">
                  <Label className="text-muted-foreground">
                    Requirements and notes
                  </Label>
                  <p className="mt-1 whitespace-pre-wrap">
                    {opportunity.notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Stage control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={opportunity.stage}
                onValueChange={(value) => changeStage(value as LeadStage)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {STAGE_LABELS[stage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={lossReason}
                onChange={(event) => setLossReason(event.target.value)}
                placeholder="Loss reason required when closing as lost"
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Opportunity quotes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {quotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No quote yet. Create one when the opportunity reaches
                  proposal.
                </p>
              ) : (
                quotes.map((quote) => (
                  <button
                    key={quote._id}
                    className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/40"
                    onClick={() => navigate(`/quotes/${quote._id}`)}
                  >
                    <div>
                      <div className="font-medium">
                        {quote.quoteNumber ?? "Draft quote"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {quote.commercialModel === "contracted"
                          ? "Contracted"
                          : "PAYG"}{" "}
                        · {formatCurrency(quote.monthlyGrandTotal)}/month
                      </div>
                    </div>
                    <Badge variant="secondary">{quote.status}</Badge>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Activity timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
                <Select
                  value={activityType}
                  onValueChange={(value) =>
                    setActivityType(value as typeof activityType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Note</SelectItem>
                    <SelectItem value="call">Call</SelectItem>
                    <SelectItem value="meeting">Meeting</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="follow_up">Follow-up</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What happened and what is next?"
                  rows={2}
                />
                <Button
                  onClick={logActivity}
                  disabled={pending || !description.trim()}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Log
                </Button>
              </div>
              <div className="space-y-3">
                {activities.map((activity) => (
                  <div key={activity._id} className="flex gap-3 border-t pt-3">
                    <div className="mt-0.5 rounded-full bg-muted p-2">
                      <Send className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {ACTIVITY_LABELS[activity.type] ?? activity.type}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {activity.description ?? "No description"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {new Date(activity.date).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <LeadDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={opportunity}
        companies={companies}
        users={users}
      />
    </div>
  );
}
