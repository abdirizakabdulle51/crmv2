import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { toast } from "sonner";
import { Cloud, ShieldAlert } from "lucide-react";

function formatNumber(value: number | undefined) {
  return value == null ? "-" : value.toLocaleString();
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ManageOneTenantsPage() {
  const { isAdmin } = useCrm();
  const tenants = useQuery(
    api.manageOneTenants.listWithSuggestions,
    isAdmin ? {} : "skip",
  );
  const countries = useQuery(api.countries.list, isAdmin ? {} : "skip");
  const sectors = useQuery(api.sectors.list, isAdmin ? {} : "skip");
  const users = useQuery(api.users.listAll, isAdmin ? {} : "skip");
  const linkToCompany = useMutation(api.manageOneTenants.linkToCompany);
  const createCompanyFromTenant = useMutation(
    api.manageOneTenants.createCompanyFromTenant,
  );
  const [creatingTenant, setCreatingTenant] =
    useState<Doc<"manageOneTenants"> | null>(null);
  const [sectorId, setSectorId] = useState("");
  const [countryId, setCountryId] = useState("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [submittingTenantId, setSubmittingTenantId] = useState<string | null>(
    null,
  );

  if (!isAdmin) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Only CEO and Head of Business can view ManageOne tenants.
          </p>
        </div>
      </div>
    );
  }

  if (!tenants || !countries || !sectors || !users) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const sortedTenants = [...tenants].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const accountManagers = users.filter(
    (user) =>
      user.isDisabled !== true &&
      (user.role === "account_manager" ||
        user.role === "country_gm" ||
        user.role === "head_of_business" ||
        user.role === "ceo"),
  );

  const resetCreateDialog = () => {
    setCreatingTenant(null);
    setSectorId("");
    setCountryId("");
    setAccountManagerId("");
  };

  const handleConfirmLink = async (
    tenantId: Doc<"manageOneTenants">["_id"],
    companyId: Doc<"companies">["_id"],
  ) => {
    setSubmittingTenantId(tenantId);
    try {
      await linkToCompany({ tenantId, companyId });
      toast.success("Tenant linked to company");
    } catch (error) {
      toast.error("Failed to link tenant", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setSubmittingTenantId(null);
    }
  };

  const handleCreateCompany = async () => {
    if (!creatingTenant || !sectorId || !countryId || !accountManagerId) {
      toast.error("Sector, country, and account manager are required");
      return;
    }

    setSubmittingTenantId(creatingTenant._id);
    try {
      await createCompanyFromTenant({
        tenantId: creatingTenant._id,
        sectorId: sectorId as Doc<"sectors">["_id"],
        countryId: countryId as Doc<"countries">["_id"],
        accountManagerId: accountManagerId as Doc<"users">["_id"],
      });
      toast.success("Company created and linked");
      resetCreateDialog();
    } catch (error) {
      toast.error("Failed to create company", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setSubmittingTenantId(null);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          ManageOne Tenants
        </h1>
        <p className="text-muted-foreground mt-1">
          {sortedTenants.length}{" "}
          {sortedTenants.length === 1 ? "tenant" : "tenants"} synced from
          ManageOne
        </p>
      </div>

      {sortedTenants.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border py-16 gap-3">
          <Cloud className="h-10 w-10 text-muted-foreground" />
          <div className="text-lg font-semibold">No tenants synced yet</div>
          <p className="text-sm text-muted-foreground">
            Run the local ManageOne sync script to load tenant data.
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Region/Level</th>
                    <th className="text-left p-3 font-medium">
                      Manager Contact
                    </th>
                    <th className="text-left p-3 font-medium">Company</th>
                    <th className="text-right p-3 font-medium">ECS Used</th>
                    <th className="text-right p-3 font-medium">EVS Used</th>
                    <th className="text-right p-3 font-medium">Projects</th>
                    <th className="text-left p-3 font-medium">Last Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTenants.map((tenant) => (
                    <tr key={tenant._id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{tenant.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {tenant.vdcId}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            Level {tenant.level ?? "-"}
                          </Badge>
                          {tenant.enabled === false && (
                            <Badge variant="destructive">Disabled</Badge>
                          )}
                        </div>
                        {tenant.domainId && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Domain: {tenant.domainId}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div>{tenant.managerName || "-"}</div>
                        <div className="text-xs text-muted-foreground">
                          {tenant.managerEmail || tenant.managerPhone || "-"}
                        </div>
                      </td>
                      <td className="p-3 min-w-[220px]">
                        {tenant.linkedCompanyId ? (
                          <Link
                            className="font-medium text-primary hover:underline"
                            to={`/companies?search=${encodeURIComponent(
                              tenant.linkedCompanyName || "",
                            )}`}
                          >
                            {tenant.linkedCompanyName || "Linked company"}
                          </Link>
                        ) : tenant.suggestedCompanyId ? (
                          <div className="space-y-2">
                            <div className="text-sm">
                              Suggested:{" "}
                              <span className="font-medium">
                                {tenant.suggestedCompanyName}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                handleConfirmLink(
                                  tenant._id,
                                  tenant.suggestedCompanyId as Doc<"companies">["_id"],
                                )
                              }
                              disabled={submittingTenantId === tenant._id}
                            >
                              Confirm Link
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCreatingTenant(tenant)}
                          >
                            Create Company
                          </Button>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {formatNumber(tenant.ecsUsed)}
                      </td>
                      <td className="p-3 text-right">
                        {formatNumber(tenant.evsUsed)}
                      </td>
                      <td className="p-3 text-right">
                        {formatNumber(tenant.projectCount)}
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(tenant.lastSyncedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={creatingTenant !== null}
        onOpenChange={(open) => {
          if (!open) {
            resetCreateDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Company from Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tenant name</Label>
              <Input value={creatingTenant?.name ?? ""} readOnly />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>

            <div className="space-y-2">
              <Label>Account Manager</Label>
              <Select
                value={accountManagerId}
                onValueChange={setAccountManagerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Assign AM" />
                </SelectTrigger>
                <SelectContent>
                  {accountManagers.map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.name || user.email || "Unnamed"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={handleCreateCompany}
              disabled={submittingTenantId === creatingTenant?._id}
            >
              Create Company
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
