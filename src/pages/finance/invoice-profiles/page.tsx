import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Landmark, Pencil, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
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
import { Switch } from "@/components/ui/switch.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type InvoiceProfile = Doc<"invoiceProfiles">;
type Country = Doc<"countries">;
type InvoiceProfileFormValues = {
  name: string;
  countryId?: Id<"countries">;
  region?: string;
  isDefault: boolean;
  isActive: boolean;
  legalName: string;
  logoPath?: string;
  slogan?: string;
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
  taxId?: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankLocation: string;
  currency?: string;
  currencyNote: string;
  paymentInstructions: string;
  footerText?: string;
};
type FormState = Omit<InvoiceProfileFormValues, "addressLines"> & {
  addressLinesText: string;
};

const NO_COUNTRY = "none";
const REQUIRED_FIELDS: Array<keyof FormState> = [
  "name",
  "legalName",
  "phone",
  "email",
  "website",
  "bankName",
  "bankAccountNumber",
  "bankAccountName",
  "bankLocation",
  "currencyNote",
  "paymentInstructions",
];

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function emptyForm(): FormState {
  return {
    name: "",
    countryId: undefined,
    region: "",
    isDefault: false,
    isActive: true,
    legalName: "",
    logoPath: "",
    slogan: "",
    addressLinesText: "",
    phone: "",
    email: "",
    website: "",
    taxId: "",
    bankName: "",
    bankAccountNumber: "",
    bankAccountName: "",
    bankLocation: "",
    currency: "USD",
    currencyNote: "All fees are listed in USD",
    paymentInstructions: "",
    footerText: "",
  };
}

function formFromProfile(profile: InvoiceProfile): FormState {
  return {
    name: profile.name,
    countryId: profile.countryId,
    region: profile.region ?? "",
    isDefault: profile.isDefault,
    isActive: profile.isActive,
    legalName: profile.legalName,
    logoPath: profile.logoPath ?? "",
    slogan: profile.slogan ?? "",
    addressLinesText: profile.addressLines.join("\n"),
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    taxId: profile.taxId ?? "",
    bankName: profile.bankName,
    bankAccountNumber: profile.bankAccountNumber,
    bankAccountName: profile.bankAccountName,
    bankLocation: profile.bankLocation,
    currency: profile.currency || "USD",
    currencyNote: profile.currencyNote,
    paymentInstructions: profile.paymentInstructions,
    footerText: profile.footerText ?? "",
  };
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildPayload(form: FormState): InvoiceProfileFormValues | null {
  for (const field of REQUIRED_FIELDS) {
    const value = form[field];
    if (typeof value === "string" && !value.trim()) {
      toast.error("Please fill all required invoice profile fields");
      return null;
    }
  }
  const addressLines = form.addressLinesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (addressLines.length === 0) {
    toast.error("At least one address line is required");
    return null;
  }

  return {
    name: form.name.trim(),
    countryId: form.countryId,
    region: optionalText(form.region),
    isDefault: form.isDefault,
    isActive: form.isActive,
    legalName: form.legalName.trim(),
    logoPath: optionalText(form.logoPath),
    slogan: optionalText(form.slogan),
    addressLines,
    phone: form.phone.trim(),
    email: form.email.trim(),
    website: form.website.trim(),
    taxId: optionalText(form.taxId),
    bankName: form.bankName.trim(),
    bankAccountNumber: form.bankAccountNumber.trim(),
    bankAccountName: form.bankAccountName.trim(),
    bankLocation: form.bankLocation.trim(),
    currency: form.currency?.trim() || "USD",
    currencyNote: form.currencyNote.trim(),
    paymentInstructions: form.paymentInstructions.trim(),
    footerText: optionalText(form.footerText),
  };
}

export default function InvoiceProfilesPage() {
  const { currentUser } = useCrm();
  const canManage = isAdminRole(currentUser?.role);
  const profiles = useQuery(api.invoiceProfiles.listInvoiceProfiles, {
    includeInactive: canManage ? true : undefined,
  });
  const countries = useQuery(api.countries.list, {});
  const createProfile = useMutation(api.invoiceProfiles.createInvoiceProfile);
  const updateProfile = useMutation(api.invoiceProfiles.updateInvoiceProfile);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<InvoiceProfile | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  const countryById = useMemo(() => {
    const map = new Map<string, string>();
    for (const country of countries ?? []) {
      map.set(country._id, country.name);
    }
    return map;
  }, [countries]);

  const sortedProfiles = useMemo(
    () =>
      [...(profiles ?? [])].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [profiles],
  );

  const summary = {
    active: sortedProfiles.filter((profile) => profile.isActive).length,
    inactive: sortedProfiles.filter((profile) => !profile.isActive).length,
    defaults: sortedProfiles.filter((profile) => profile.isDefault).length,
  };

  const openCreate = () => {
    setEditingProfile(null);
    setDialogOpen(true);
  };

  const openEdit = (profile: InvoiceProfile) => {
    setEditingProfile(profile);
    setDialogOpen(true);
  };

  if (profiles === undefined || countries === undefined || currentUser === undefined) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Invoice Profiles
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage country and region invoice business details for future use.
          </p>
        </div>
        {canManage ? (
          <Button
            className="bg-cyan-600 text-white hover:bg-cyan-700"
            onClick={openCreate}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Profile
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Invoice profile management is limited to CEO and Head of Business.
          You can view active profiles only.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Active" value={summary.active} />
        <SummaryCard label="Inactive" value={summary.inactive} />
        <SummaryCard label="Default" value={summary.defaults} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedProfiles.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Landmark className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>No invoice profiles yet.</EmptyTitle>
                <EmptyDescription>
                  CEO/HOB users can create profiles for country or regional
                  invoice details.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1060px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Country</th>
                    <th className="px-3 py-3">Region</th>
                    <th className="px-3 py-3">Default</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Legal name</th>
                    <th className="px-3 py-3">Currency</th>
                    <th className="px-3 py-3">Bank account</th>
                    <th className="px-3 py-3">Updated at</th>
                    {canManage ? <th className="px-3 py-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sortedProfiles.map((profile) => (
                    <tr key={profile._id} className="border-b last:border-0">
                      <td className="px-3 py-3 font-medium">
                        {profile.name}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {profile.countryId
                          ? countryById.get(profile.countryId) ?? "Unknown country"
                          : "All countries"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {profile.region || "-"}
                      </td>
                      <td className="px-3 py-3">
                        {profile.isDefault ? "Yes" : "No"}
                      </td>
                      <td className="px-3 py-3">
                        {profile.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">{profile.legalName}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {profile.currency}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          {profile.bankAccountNumber}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {profile.bankAccountName}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDateTime(profile.updatedAt)}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-3">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => openEdit(profile)}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <InvoiceProfileDialog
        open={dialogOpen}
        pending={pending}
        profile={editingProfile}
        countries={countries}
        onOpenChange={setDialogOpen}
        onSubmit={async (values) => {
          setPending(true);
          try {
            if (editingProfile) {
              await updateProfile({
                profileId: editingProfile._id,
                ...values,
              });
              toast.success("Invoice profile updated");
            } else {
              await createProfile(values);
              toast.success("Invoice profile created");
            }
            setDialogOpen(false);
            setEditingProfile(null);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to save invoice profile",
            );
          } finally {
            setPending(false);
          }
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function InvoiceProfileDialog({
  open,
  pending,
  profile,
  countries,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  profile: InvoiceProfile | null;
  countries: Country[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: InvoiceProfileFormValues) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => emptyForm());

  useEffect(() => {
    if (!open) return;
    setForm(profile ? formFromProfile(profile) : emptyForm());
  }, [profile, open]);

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = buildPayload(form);
    if (!payload) return;
    await onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {profile ? "Edit Invoice Profile" : "New Invoice Profile"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id="invoice-profile-name"
              label="Name"
              value={form.name}
              onChange={(value) => setField("name", value)}
              required
              placeholder="Somalia invoice profile"
            />
            <div className="space-y-2">
              <Label>Country</Label>
              <Select
                value={form.countryId ?? NO_COUNTRY}
                onValueChange={(value) =>
                  setField(
                    "countryId",
                    value === NO_COUNTRY
                      ? undefined
                      : (value as Id<"countries">),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COUNTRY}>All countries</SelectItem>
                  {countries.map((country) => (
                    <SelectItem key={country._id} value={country._id}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TextField
              id="invoice-profile-region"
              label="Region"
              value={form.region ?? ""}
              onChange={(value) => setField("region", value)}
              placeholder="East Africa"
            />
            <TextField
              id="invoice-profile-currency"
              label="Currency"
              value={form.currency ?? "USD"}
              onChange={(value) => setField("currency", value)}
              required
              placeholder="USD"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="invoice-profile-default">Default profile</Label>
              <Switch
                id="invoice-profile-default"
                checked={form.isDefault}
                onCheckedChange={(checked) => setField("isDefault", checked)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="invoice-profile-active">Active</Label>
              <Switch
                id="invoice-profile-active"
                checked={form.isActive}
                onCheckedChange={(checked) => setField("isActive", checked)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id="invoice-profile-legal-name"
              label="Legal name"
              value={form.legalName}
              onChange={(value) => setField("legalName", value)}
              required
              placeholder="HTG CLOUDS LIMITED"
            />
            <TextField
              id="invoice-profile-tax-id"
              label="Tax ID"
              value={form.taxId ?? ""}
              onChange={(value) => setField("taxId", value)}
              placeholder="Optional"
            />
            <TextField
              id="invoice-profile-phone"
              label="Phone"
              value={form.phone}
              onChange={(value) => setField("phone", value)}
              required
              placeholder="+252 61 5558484"
            />
            <TextField
              id="invoice-profile-email"
              label="Email"
              value={form.email}
              onChange={(value) => setField("email", value)}
              required
              placeholder="finance@htgclouds.com"
            />
            <TextField
              id="invoice-profile-website"
              label="Website"
              value={form.website}
              onChange={(value) => setField("website", value)}
              required
              placeholder="https://htgclouds.com/"
            />
            <TextField
              id="invoice-profile-logo-path"
              label="Logo path"
              value={form.logoPath ?? ""}
              onChange={(value) => setField("logoPath", value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-profile-slogan">Slogan</Label>
            <Input
              id="invoice-profile-slogan"
              value={form.slogan ?? ""}
              onChange={(event) => setField("slogan", event.target.value)}
              placeholder="Built for us, Ready for the World."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-profile-address">Address lines</Label>
            <Textarea
              id="invoice-profile-address"
              value={form.addressLinesText}
              onChange={(event) =>
                setField("addressLinesText", event.target.value)
              }
              placeholder={"HTG Clouds\nAirport road\nMogadishu"}
              rows={4}
              required
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id="invoice-profile-bank-name"
              label="Bank name"
              value={form.bankName}
              onChange={(value) => setField("bankName", value)}
              required
              placeholder="Salaam Somali Bank"
            />
            <TextField
              id="invoice-profile-bank-account-number"
              label="Bank account number"
              value={form.bankAccountNumber}
              onChange={(value) => setField("bankAccountNumber", value)}
              required
              placeholder="33111777"
            />
            <TextField
              id="invoice-profile-bank-account-name"
              label="Bank account name"
              value={form.bankAccountName}
              onChange={(value) => setField("bankAccountName", value)}
              required
              placeholder="HTG CLOUDS LIMITED"
            />
            <TextField
              id="invoice-profile-bank-location"
              label="Bank location"
              value={form.bankLocation}
              onChange={(value) => setField("bankLocation", value)}
              required
              placeholder="MOGADISHU - SOMALIA"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-profile-currency-note">Currency note</Label>
            <Input
              id="invoice-profile-currency-note"
              value={form.currencyNote}
              onChange={(event) => setField("currencyNote", event.target.value)}
              required
              placeholder="All fees are listed in USD"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-profile-payment-instructions">
              Payment instructions
            </Label>
            <Textarea
              id="invoice-profile-payment-instructions"
              value={form.paymentInstructions}
              onChange={(event) =>
                setField("paymentInstructions", event.target.value)
              }
              placeholder="Please pay bills on due date..."
              rows={3}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-profile-footer-text">Footer text</Label>
            <Input
              id="invoice-profile-footer-text"
              value={form.footerText ?? ""}
              onChange={(event) => setField("footerText", event.target.value)}
              placeholder="Optional footer note"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-cyan-600 text-white hover:bg-cyan-700"
              disabled={pending}
            >
              {pending ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}
