import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Plus, Search, Building2, Upload } from "lucide-react";
import CompanyDialog from "./_components/company-dialog.tsx";
import ImportDialog from "./_components/import-dialog.tsx";
import { sortCompaniesByName } from "@/components/company-combobox.tsx";

type Company = Doc<"companies">;

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  expired: "Expired",
  terminated: "Terminated",
};

const STATUS_COLORS: Record<string, string> = {
  active:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  expired: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400",
  terminated: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export default function CompaniesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const users = useQuery(api.users.listAll, {});

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  if (!companies || !countries || !sectors || !users) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const countryMap = new Map(countries.map((c) => [c._id, c]));
  const sectorMap = new Map(sectors.map((s) => [s._id, s]));
  const userMap = new Map(users.map((u) => [u._id, u]));

  const filtered = sortCompaniesByName(
    companies.filter((c) => {
      if (search) {
        const term = search.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(term);
        const matchesContact = c.contactName?.toLowerCase().includes(term);
        if (!matchesName && !matchesContact) return false;
      }
      if (statusFilter !== "all" && c.contractStatus !== statusFilter)
        return false;
      if (sectorFilter !== "all" && c.sectorId !== sectorFilter) return false;
      if (countryFilter !== "all" && c.countryId !== countryFilter)
        return false;
      return true;
    }),
  );

  const handleEdit = (company: Company) => {
    navigate(`/companies/${company._id}`);
  };

  const handleCreate = () => {
    setDialogOpen(true);
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="text-muted-foreground mt-1">
            {filtered.length} {filtered.length === 1 ? "company" : "companies"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Company
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or contact..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="terminated">Terminated</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s._id} value={s._id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={countryFilter} onValueChange={setCountryFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            {countries.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Company List */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>
              {companies.length === 0 ? "No companies yet" : "No results"}
            </EmptyTitle>
            <EmptyDescription>
              {companies.length === 0
                ? "Add your first company to get started"
                : "Try adjusting your filters"}
            </EmptyDescription>
          </EmptyHeader>
          {companies.length === 0 && (
            <EmptyContent>
              <Button size="sm" onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-1" />
                Add Company
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="space-y-3">
          {filtered.map((company) => {
            const country = countryMap.get(company.countryId);
            const sector = sectorMap.get(company.sectorId);
            const am = company.accountManagerId
              ? userMap.get(company.accountManagerId)
              : undefined;

            return (
              <Card
                key={company._id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => handleEdit(company)}
              >
                <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{company.name}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                      {sector && <span>{sector.name}</span>}
                      {country && (
                        <span>
                          {country.name} ({country.region})
                        </span>
                      )}
                      {am && <span>AM: {am.name || "Unnamed"}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {company.contactName && (
                      <span className="text-xs text-muted-foreground hidden lg:block">
                        {company.contactName}
                      </span>
                    )}
                    <Badge
                      className={`text-xs ${STATUS_COLORS[company.contractStatus] || ""}`}
                      variant="secondary"
                    >
                      {STATUS_LABELS[company.contractStatus]}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CompanyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        company={null}
        countries={countries}
        sectors={sectors}
        users={users}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
