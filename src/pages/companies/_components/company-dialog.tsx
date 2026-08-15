import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
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
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

function formatManageOneNumber(value: number | undefined) {
  return value == null ? "-" : value.toLocaleString();
}

function formatManageOneDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type ContractStatus = "active" | "pending" | "expired" | "terminated";
type PaymentStatus = "current" | "overdue" | "delinquent";
type PaymentTermValue = "default" | "7" | "15" | "30";
type ManageOneTenant = Doc<"manageOneTenants">;
type ManageOneResource = NonNullable<ManageOneTenant["resources"]>[number];

const KEY_RESOURCE_LABELS: Record<string, string> = {
  publicIp: "EIP",
  vpn: "VPN",
  loadbalancer: "Load Balancers",
  waf: "WAF",
  csbs: "Backup",
  backup: "Backup",
};

function formatResourceValue(resource: ManageOneResource) {
  const used = formatManageOneNumber(resource.used);
  if (resource.total == null) {
    return used;
  }
  return `${used} / ${formatManageOneNumber(resource.total)}`;
}

function getKeyResources(tenant: ManageOneTenant) {
  return (tenant.resources ?? [])
    .filter((resource) => resource.used > 0)
    .map((resource) => ({
      label: KEY_RESOURCE_LABELS[resource.resource],
      value: formatResourceValue(resource),
      resource,
    }))
    .filter((item) => item.label);
}

function ManageOneTenantStats({ tenant }: { tenant: ManageOneTenant }) {
  const keyResources = getKeyResources(tenant);

  return (
    <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
      <div>
        <div className="text-muted-foreground">ECS</div>
        <div className="font-medium">
          {formatManageOneNumber(tenant.ecsUsed)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground">EVS</div>
        <div className="font-medium">
          {formatManageOneNumber(tenant.evsUsed)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground">Projects</div>
        <div className="font-medium">
          {formatManageOneNumber(tenant.projectCount)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground">Last synced</div>
        <div className="font-medium">
          {formatManageOneDate(tenant.lastSyncedAt)}
        </div>
      </div>
      {keyResources.map(({ label, value, resource }) => (
        <div key={`${resource.serviceId}-${resource.resource}`}>
          <div className="text-muted-foreground">{label}</div>
          <div className="font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
}

type CompanyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Doc<"companies"> | null;
  countries: Doc<"countries">[];
  sectors: Doc<"sectors">[];
  users: Doc<"users">[];
};

type CompanyFormProps = {
  company: Doc<"companies"> | null;
  countries: Doc<"countries">[];
  sectors: Doc<"sectors">[];
  users: Doc<"users">[];
  onFinished: () => void;
  isActive?: boolean;
  showManageOneUsage?: boolean;
};

export function CompanyForm({
  company,
  countries,
  sectors,
  users,
  onFinished,
  isActive = true,
  showManageOneUsage = true,
}: CompanyFormProps) {
  const createCompany = useMutation(api.companies.create);
  const updateCompany = useMutation(api.companies.update);
  const removeCompany = useMutation(api.companies.remove);
  const manageOneTenants = useQuery(
    api.manageOneTenants.getByCompanyId,
    company && showManageOneUsage ? { companyId: company._id } : "skip",
  );
  const { isAdmin, currentUser } = useCrm();

  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState<string>("");
  const [countryId, setCountryId] = useState<string>("");
  const [accountManagerId, setAccountManagerId] = useState<string>("");
  const [contractStatus, setContractStatus] =
    useState<ContractStatus>("pending");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("current");
  const [paymentTermDays, setPaymentTermDays] =
    useState<PaymentTermValue>("default");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (company) {
      setName(company.name);
      setSectorId(company.sectorId);
      setCountryId(company.countryId);
      setAccountManagerId(company.accountManagerId || "");
      setContractStatus(company.contractStatus);
      setPaymentStatus((company.paymentStatus as PaymentStatus) || "current");
      setPaymentTermDays(
        company.paymentTermDays
          ? (String(company.paymentTermDays) as PaymentTermValue)
          : "default",
      );
      setNotes(company.notes || "");
      setWebsite(company.website || "");
      setContactName(company.contactName || "");
      setContactEmail(company.contactEmail || "");
    } else {
      resetForm();
    }
  }, [company, isActive]);

  useEffect(() => {
    if (!company && isActive && currentUser?.role === "account_manager") {
      setAccountManagerId(currentUser._id);
    }
  }, [company, currentUser?._id, currentUser?.role, isActive]);

  const resetForm = () => {
    setName("");
    setSectorId("");
    setCountryId("");
    setAccountManagerId("");
    setContractStatus("pending");
    setPaymentStatus("current");
    setPaymentTermDays("default");
    setNotes("");
    setWebsite("");
    setContactName("");
    setContactEmail("");
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Company name is required");
      return;
    }
    if (!sectorId) {
      toast.error("Please select a sector");
      return;
    }
    if (!countryId) {
      toast.error("Please select a country");
      return;
    }
    const effectiveAccountManagerId =
      currentUser?.role === "account_manager"
        ? currentUser._id
        : accountManagerId;

    if (!effectiveAccountManagerId) {
      toast.error("Please assign an account manager");
      return;
    }

    try {
      const data = {
        name: company ? company.name : name.trim(),
        sectorId: sectorId as Id<"sectors">,
        countryId: countryId as Id<"countries">,
        accountManagerId: effectiveAccountManagerId as Id<"users">,
        contractStatus,
        paymentStatus,
        paymentTermDays:
          paymentTermDays === "default"
            ? undefined
            : (Number(paymentTermDays) as 7 | 15 | 30),
        notes: notes.trim() || undefined,
        website: website.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
      };

      if (company) {
        await updateCompany({ id: company._id, ...data });
        toast.success("Company updated");
      } else {
        await createCompany(data);
        toast.success("Company created");
      }
      onFinished();
    } catch {
      toast.error("Failed to save company");
    }
  };

  const handleDelete = async () => {
    if (!company) return;
    setDeleting(true);
    try {
      await removeCompany({ id: company._id });
      toast.success("Company deleted");
      setConfirmOpen(false);
      onFinished();
    } catch {
      toast.error("Failed to delete company");
    } finally {
      setDeleting(false);
    }
  };

  // Only show users with the account_manager role (or any role for flexibility)
  const accountManagers = users.filter(
    (u) =>
      u.isDisabled !== true &&
      (u.role === "account_manager" ||
        u.role === "country_gm" ||
        u.role === "head_of_business" ||
        u.role === "ceo"),
  );

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Company Name *</Label>
          <Input
            value={name}
            onChange={(e) => {
              if (!company) {
                setName(e.target.value);
              }
            }}
            placeholder="e.g. Acme Corporation"
            readOnly={!!company}
            aria-readonly={!!company}
            className={company ? "bg-muted/40 text-muted-foreground" : undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Sector *</Label>
            <Select value={sectorId} onValueChange={setSectorId}>
              <SelectTrigger>
                <SelectValue placeholder="Select sector" />
              </SelectTrigger>
              <SelectContent>
                {sectors.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Country *</Label>
            <Select value={countryId} onValueChange={setCountryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Account Manager *</Label>
            <Select
              value={accountManagerId}
              onValueChange={setAccountManagerId}
              disabled={currentUser?.role === "account_manager"}
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

          <div className="space-y-2">
            <Label>Contract Status *</Label>
            <Select
              value={contractStatus}
              onValueChange={(v) => setContractStatus(v as ContractStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Payment Status</Label>
            <Select
              value={paymentStatus}
              onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="delinquent">Delinquent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Payment Terms</Label>
            <Select
              value={paymentTermDays}
              onValueChange={(v) => setPaymentTermDays(v as PaymentTermValue)}
            >
              <SelectTrigger aria-label="Payment Terms">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default (Net 7)</SelectItem>
                <SelectItem value="7">Net 7</SelectItem>
                <SelectItem value="15">Net 15</SelectItem>
                <SelectItem value="30">Net 30</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Website</Label>
          <Input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Contact Name</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="John Smith"
            />
          </div>
          <div className="space-y-2">
            <Label>Contact Email</Label>
            <Input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="john@example.com"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes about this company..."
            rows={3}
          />
        </div>

        {showManageOneUsage && (
          <ManageOneUsageCard manageOneTenants={manageOneTenants} />
        )}

        <div className="flex gap-2 pt-2">
          <Button className="flex-1" onClick={handleSave}>
            {company ? "Update Company" : "Create Company"}
          </Button>
          {company && isAdmin && (
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

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDelete}
        title="Delete this company?"
        description="This action is irreversible. The company and all associated records will be permanently removed."
        loading={deleting}
      />
    </>
  );
}

export function ManageOneUsageCard({
  manageOneTenants,
}: {
  manageOneTenants: ManageOneTenant[] | undefined;
}) {
  if (!manageOneTenants) {
    return (
      <Card className="max-w-5xl">
        <CardHeader>
          <CardTitle>Billing & Usage</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Loading ManageOne usage...
        </CardContent>
      </Card>
    );
  }

  if (manageOneTenants.length === 0) {
    return (
      <Card className="max-w-5xl">
        <CardHeader>
          <CardTitle>Billing & Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No linked ManageOne usage has been received for this company yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle>Billing & Usage</CardTitle>
      </CardHeader>
      <CardContent>
        {manageOneTenants.length === 1 ? (
          <ManageOneTenantStats tenant={manageOneTenants[0]} />
        ) : (
          <div className="space-y-3 text-sm">
            {manageOneTenants.map((tenant) => (
              <div key={tenant._id} className="rounded-md border px-3 py-2">
                <div className="font-medium">{tenant.name}</div>
                <ManageOneTenantStats tenant={tenant} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CompanyDialog({
  open,
  onOpenChange,
  company,
  countries,
  sectors,
  users,
}: CompanyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{company ? "Edit Company" : "Add Company"}</DialogTitle>
        </DialogHeader>

        <CompanyForm
          company={company}
          countries={countries}
          sectors={sectors}
          users={users}
          isActive={open}
          onFinished={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
