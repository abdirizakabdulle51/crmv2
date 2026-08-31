import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { STAGE_LABELS, type LeadStage } from "../_lib/constants.ts";

type Props = {
  lead: Doc<"leads"> | null;
  targetStage: LeadStage | null;
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
  companies: Doc<"companies">[];
  countries: Doc<"countries">[];
  sectors: Doc<"sectors">[];
  onClose: () => void;
};

export default function OpportunityTransitionDialog({
  lead,
  targetStage,
  quotes,
  companies,
  countries,
  sectors,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const updateStage = useMutation(api.leads.updateStage);
  const prepareProposal = useMutation(api.leads.prepareProposal);
  const acceptQuoteAndWin = useMutation(api.leads.acceptQuoteAndWin);
  const sendQuoteAndNegotiate = useMutation(api.leads.sendQuoteAndNegotiate);
  const [pending, setPending] = useState(false);
  const [lossReason, setLossReason] = useState("");
  const [companyMode, setCompanyMode] = useState<"create" | "existing">(
    "create",
  );
  const [companyId, setCompanyId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [countryId, setCountryId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [acceptedByContact, setAcceptedByContact] = useState("");

  useEffect(() => {
    if (!lead) return;
    setLossReason("");
    setCompanyId("");
    setCompanyName("");
    setCountryId(lead.countryId ?? "");
    setSectorId("");
    setAcceptedByContact(lead.contactName ?? "");
  }, [lead, targetStage]);

  if (!lead || !targetStage) return null;
  const leadQuotes = quotes.filter((quote) => quote.leadId === lead._id);
  const newest = (status: "draft" | "sent" | "accepted") =>
    leadQuotes
      .filter((quote) => quote.status === status)
      .sort((a, b) =>
        status === "accepted"
          ? (b.acceptedAt ?? b._creationTime) -
            (a.acceptedAt ?? a._creationTime)
          : b._creationTime - a._creationTime,
      )[0];
  const acceptedQuote = newest("accepted");
  const sentQuote = newest("sent");
  const draftQuote = newest("draft");
  const existingQuote = draftQuote ?? sentQuote ?? acceptedQuote;
  const needsCompany = targetStage === "proposal" && !lead.companyId;
  const needsProposalQuote = targetStage === "proposal" && lead.companyId;
  const needsQuote =
    targetStage === "negotiation" && !sentQuote && !acceptedQuote;
  const needsAcceptance = targetStage === "won" && !acceptedQuote;
  const isReopening = lead.stage === "lost" || lead.stage === "won";
  const companyReady =
    companyMode === "existing"
      ? !!companyId
      : !!companyName.trim() && !!countryId && !!sectorId;

  const run = async (action: () => Promise<unknown>, success: string) => {
    setPending(true);
    try {
      await action();
      toast.success(success);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update opportunity",
      );
    } finally {
      setPending(false);
    }
  };

  const complete = () =>
    run(
      () =>
        targetStage === "won" && acceptedQuote
          ? acceptQuoteAndWin({
              leadId: lead._id,
              quoteId: acceptedQuote._id,
              acceptedByContact: acceptedByContact.trim() || undefined,
            })
          : updateStage({
              id: lead._id,
              stage: targetStage,
              lossReason:
                targetStage === "lost" ? lossReason.trim() : undefined,
            }),
      `Opportunity moved to ${STAGE_LABELS[targetStage]}`,
    );

  const connectCompany = () => {
    if (companyMode === "existing" && !companyId) {
      toast.error("Select a company");
      return;
    }
    if (
      companyMode === "create" &&
      (!companyName.trim() || !countryId || !sectorId)
    ) {
      toast.error("Complete the company name, country, and sector");
      return;
    }
    return run(async () => {
      if (companyMode === "existing") {
        await prepareProposal({
          leadId: lead._id,
          companyId: companyId as Id<"companies">,
        });
      } else {
        await prepareProposal({
          leadId: lead._id,
          newCompany: {
            name: companyName.trim(),
            countryId: countryId as Id<"countries">,
            sectorId: sectorId as Id<"sectors">,
          },
        });
      }
      navigate(`/quotes/new?opportunityId=${lead._id}`);
    }, "Company linked and opportunity moved to Proposal");
  };

  const openQuote = (quote?: { _id: Id<"quotes"> }) => {
    onClose();
    navigate(
      quote ? `/quotes/${quote._id}` : `/quotes/new?opportunityId=${lead._id}`,
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to {STAGE_LABELS[targetStage]}</DialogTitle>
          <DialogDescription>
            Complete the required step here before the opportunity moves.
          </DialogDescription>
        </DialogHeader>

        {needsCompany ? (
          <div className="space-y-4">
            <Select
              value={companyMode}
              onValueChange={(value) =>
                setCompanyMode(value as typeof companyMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create">
                  Create new prospect company
                </SelectItem>
                <SelectItem value="existing">
                  Select existing company
                </SelectItem>
              </SelectContent>
            </Select>
            {companyMode === "existing" ? (
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies
                      .filter((company) => company.lifecycleStatus !== "lost")
                      .map((company) => (
                        <SelectItem key={company._id} value={company._id}>
                          {company.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Company name</Label>
                  <Input
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Select value={countryId} onValueChange={setCountryId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map((country) => (
                          <SelectItem key={country._id} value={country._id}>
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Sector</Label>
                    <Select value={sectorId} onValueChange={setSectorId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select sector" />
                      </SelectTrigger>
                      <SelectContent>
                        {sectors.map((sector) => (
                          <SelectItem key={sector._id} value={sector._id}>
                            {sector.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Contact details from this opportunity will be copied
                  automatically.
                </p>
              </>
            )}
            <DialogFooter>
              <Button
                onClick={connectCompany}
                disabled={pending || !companyReady}
              >
                Create/link and continue
              </Button>
            </DialogFooter>
          </div>
        ) : needsProposalQuote ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {leadQuotes.length
                ? "Continue with the existing opportunity quote."
                : "The next step is preparing this opportunity's quote."}
            </p>
            <DialogFooter>
              <Button
                onClick={() =>
                  run(
                    async () => {
                      await updateStage({ id: lead._id, stage: "proposal" });
                      navigate(
                        existingQuote
                          ? `/quotes/${existingQuote._id}`
                          : `/quotes/new?opportunityId=${lead._id}`,
                      );
                    },
                    existingQuote
                      ? "Opportunity moved to Proposal"
                      : "Opportunity moved to Proposal; prepare the quote",
                  )
                }
                disabled={pending}
              >
                {existingQuote
                  ? "Move and open existing quote"
                  : "Move and create quote"}
              </Button>
            </DialogFooter>
          </div>
        ) : targetStage === "lost" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Loss reason *</Label>
              <Textarea
                value={lossReason}
                onChange={(event) => setLossReason(event.target.value)}
                placeholder="Why was this opportunity lost?"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={complete}
                disabled={pending || !lossReason.trim()}
              >
                Mark as Lost
              </Button>
            </DialogFooter>
          </div>
        ) : needsQuote ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Negotiation starts after a quote has been sent.
            </p>
            <DialogFooter>
              <Button
                onClick={() =>
                  draftQuote
                    ? run(
                        () =>
                          sendQuoteAndNegotiate({
                            leadId: lead._id,
                            quoteId: draftQuote._id,
                          }),
                        "Quote marked sent and opportunity moved to Negotiation",
                      )
                    : openQuote()
                }
                disabled={pending}
              >
                {draftQuote
                  ? "Mark draft quote as sent"
                  : "Create opportunity quote"}
              </Button>
            </DialogFooter>
          </div>
        ) : needsAcceptance ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A customer-approved quote is required before onboarding.
            </p>
            <DialogFooter>
              {sentQuote ? (
                <div className="w-full space-y-4">
                  <div className="space-y-2">
                    <Label>Accepted by</Label>
                    <Input
                      value={acceptedByContact}
                      onChange={(event) =>
                        setAcceptedByContact(event.target.value)
                      }
                      placeholder="Customer contact name"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={() =>
                        run(
                          () =>
                            acceptQuoteAndWin({
                              leadId: lead._id,
                              quoteId: sentQuote._id,
                              acceptedByContact:
                                acceptedByContact.trim() || undefined,
                            }),
                          "Quote accepted and opportunity marked Won",
                        )
                      }
                      disabled={pending}
                    >
                      Confirm acceptance and mark Won
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <Button onClick={() => openQuote(draftQuote)}>
                  {draftQuote ? "Open draft quote" : "Create quote"}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isReopening
                ? "This reopens a closed opportunity and updates the prospect lifecycle."
                : "The opportunity is ready for this stage."}
            </p>
            <DialogFooter>
              <Button onClick={complete} disabled={pending}>
                Confirm move
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
