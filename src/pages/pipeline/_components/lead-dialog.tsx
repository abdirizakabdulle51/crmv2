import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { STAGES, STAGE_LABELS, type LeadStage } from "../_lib/constants.ts";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type LeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Doc<"leads"> | null;
  companies: Doc<"companies">[];
  users: Doc<"users">[];
};

export default function LeadDialog({
  open,
  onOpenChange,
  lead,
  companies,
  users,
}: LeadDialogProps) {
  const createLead = useMutation(api.leads.create);
  const updateLead = useMutation(api.leads.update);
  const removeLead = useMutation(api.leads.remove);
  const { isAdmin } = useCrm();

  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState<string>("none");
  const [accountManagerId, setAccountManagerId] = useState<string>("");
  const [stage, setStage] = useState<LeadStage>("new_lead");
  const [potentialValue, setPotentialValue] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [source, setSource] = useState("");
  const [serviceInterests, setServiceInterests] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (lead) {
      setTitle(lead.title);
      setCompanyId(lead.companyId ?? "none");
      setAccountManagerId(lead.accountManagerId || "");
      setStage(lead.stage);
      setPotentialValue(lead.potentialValue.toString());
      setExpectedCloseDate(lead.expectedCloseDate.split("T")[0]);
      setNextAction(lead.nextAction || "");
      setNextActionDate(lead.nextActionDate?.split("T")[0] || "");
      setContactName(lead.contactName || "");
      setContactEmail(lead.contactEmail || "");
      setSource(lead.source || "");
      setServiceInterests(lead.serviceInterests?.join(", ") || "");
      setNotes(lead.notes || "");
    } else {
      resetForm();
    }
  }, [lead, open]);

  const resetForm = () => {
    setTitle("");
    setCompanyId("none");
    setAccountManagerId("");
    setStage("new_lead");
    setPotentialValue("");
    setExpectedCloseDate("");
    setNextAction("");
    setNextActionDate("");
    setContactName("");
    setContactEmail("");
    setSource("");
    setServiceInterests("");
    setNotes("");
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Lead title is required");
      return;
    }
    if (!accountManagerId) {
      toast.error("Please assign an account manager");
      return;
    }
    if (
      !potentialValue ||
      !Number.isFinite(Number(potentialValue)) ||
      Number(potentialValue) <= 0
    ) {
      toast.error("Potential value must be greater than zero");
      return;
    }
    if (!expectedCloseDate) {
      toast.error("Please set an expected close date");
      return;
    }
    if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) {
      toast.error("Enter a valid contact email");
      return;
    }

    try {
      const data = {
        title: title.trim(),
        companyId:
          companyId && companyId !== "none"
            ? (companyId as Id<"companies">)
            : undefined,
        accountManagerId: accountManagerId as Id<"users">,
        stage,
        potentialValue: Number(potentialValue),
        expectedCloseDate: new Date(expectedCloseDate).toISOString(),
        nextAction: nextAction.trim() || undefined,
        nextActionDate: nextActionDate
          ? new Date(nextActionDate).toISOString()
          : undefined,
        contactName: contactName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        source: source.trim() || undefined,
        serviceInterests: serviceInterests
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        notes: notes.trim() || undefined,
      };

      if (lead) {
        await updateLead({ id: lead._id, ...data });
        toast.success("Lead updated");
      } else {
        await createLead(data);
        toast.success("Lead created");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save opportunity",
      );
    }
  };

  const handleDelete = async () => {
    if (!lead) return;
    setDeleting(true);
    try {
      await removeLead({ id: lead._id });
      toast.success("Lead deleted");
      setConfirmOpen(false);
      onOpenChange(false);
    } catch {
      toast.error("Failed to delete lead");
    } finally {
      setDeleting(false);
    }
  };

  const accountManagers = users.filter(
    (u) =>
      u.isDisabled !== true &&
      (u.role === "account_manager" ||
        u.role === "country_gm" ||
        u.role === "head_of_business" ||
        u.role === "ceo"),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {lead ? "Edit Opportunity" : "New Opportunity"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Opportunity Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Enterprise License Deal"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Primary Contact</Label>
              <Input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Contact name"
              />
            </div>
            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                placeholder="name@company.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Opportunity Source</Label>
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Referral, campaign, inbound..."
              />
            </div>
            <div className="space-y-2">
              <Label>Service Interests</Label>
              <Input
                value={serviceInterests}
                onChange={(event) => setServiceInterests(event.target.value)}
                placeholder="Compute, Storage"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="No company yet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company yet</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Account Manager *</Label>
              <Select
                value={accountManagerId}
                onValueChange={setAccountManagerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign AM" />
                </SelectTrigger>
                <SelectContent>
                  {accountManagers.map((u) => (
                    <SelectItem key={u._id} value={u._id}>
                      {u.name || u.email || "Unnamed"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Stage *</Label>
              <Select
                value={stage}
                onValueChange={(v) => setStage(v as LeadStage)}
                disabled={Boolean(lead)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.filter(
                    (candidate) =>
                      lead ||
                      candidate === "new_lead" ||
                      candidate === "qualified" ||
                      candidate === "discovery" ||
                      (candidate === "proposal" && companyId !== "none"),
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lead ? (
                <p className="text-xs text-muted-foreground">
                  Change stage from the opportunity workflow.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Potential Value (USD) *</Label>
              <Input
                type="number"
                value={potentialValue}
                onChange={(e) => setPotentialValue(e.target.value)}
                placeholder="50000"
                min="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Expected Close Date *</Label>
            <Input
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Next Action</Label>
            <Input
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="e.g. Schedule demo call"
            />
          </div>
          <div className="space-y-2">
            <Label>Next Action Date</Label>
            <Input
              type="date"
              value={nextActionDate}
              onChange={(event) => setNextActionDate(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this lead..."
              rows={3}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button className="flex-1" onClick={handleSave}>
              {lead ? "Update Opportunity" : "Create Opportunity"}
            </Button>
            {lead && isAdmin && (
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setConfirmOpen(true)}
                className="cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDelete}
        title="Delete this lead?"
        description="This action is irreversible. The lead and all associated data will be permanently removed."
        loading={deleting}
      />
    </Dialog>
  );
}
