import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty.tsx";
import { Plus, Upload, BarChart3, Trash2, Sparkles } from "lucide-react";
import UsageEntryDialog from "./_components/usage-entry-dialog.tsx";
import UsageImportDialog from "./_components/usage-import-dialog.tsx";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { toast } from "sonner";
import { getCurrentMonth } from "./_lib/constants.ts";

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function UsagePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const consumption = useQuery(api.consumption.list, {});
  const removeEntry = useMutation(api.consumption.remove);
  const { isAdmin } = useCrm();

  const [entryOpen, setEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [companyFilter, setCompanyFilter] = useState(
    searchParams.get("company") ?? "all",
  );
  const [monthFilter, setMonthFilter] = useState(
    searchParams.get("month") ?? "all",
  );
  const [bulkMonth, setBulkMonth] = useState(
    searchParams.get("month") ?? getCurrentMonth(),
  );
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteId, setDeleteId] = useState<Id<"consumption"> | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!companies || !consumption) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Get unique months from data
  const allMonths = [...new Set(consumption.map((c) => c.month))]
    .sort()
    .reverse();

  // Filter consumption
  const filtered = consumption.filter((c) => {
    if (companyFilter !== "all" && c.companyId !== companyFilter) return false;
    if (monthFilter !== "all" && c.month !== monthFilter) return false;
    return true;
  });
  const sortedFiltered = [...filtered].sort((a, b) =>
    b.month.localeCompare(a.month),
  );
  const pageCount = Math.max(1, Math.ceil(sortedFiltered.length / pageSize));
  const safePage = Math.min(currentPage, pageCount);
  const pageStart =
    sortedFiltered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, sortedFiltered.length);
  const paginatedEntries = sortedFiltered.slice(pageStart - 1, pageEnd);

  // Group by company for summary
  const companyMap = new Map(companies.map((c) => [c._id, c]));
  const byCompany = new Map<string, number>();
  for (const entry of filtered) {
    const current = byCompany.get(entry.companyId) || 0;
    byCompany.set(entry.companyId, current + entry.amount);
  }

  // Summary stats
  const totalEntries = filtered.length;
  const totalAmount = filtered.reduce((s, c) => s + c.amount, 0);
  const uniqueCompanies = new Set(filtered.map((c) => c.companyId)).size;
  const usageCountByCompany = new Map<string, number>();
  for (const entry of consumption) {
    if (monthFilter !== "all" && entry.month !== monthFilter) {
      continue;
    }
    usageCountByCompany.set(
      entry.companyId,
      (usageCountByCompany.get(entry.companyId) ?? 0) + 1,
    );
  }
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usage Tracking</h1>
          <p className="text-muted-foreground mt-1">
            Monthly service consumption by tenant
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={() => setEntryOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Entries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEntries}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Consumption
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalAmount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Tenants with Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueCompanies}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select
          value={companyFilter}
          onValueChange={(value) => {
            setCompanyFilter(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{c.name}</span>
                  {(usageCountByCompany.get(c._id) ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      ✓ {usageCountByCompany.get(c._id)} entries
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={monthFilter}
          onValueChange={(value) => {
            setMonthFilter(value);
            setCurrentPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Months" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Months</SelectItem>
            {allMonths.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setCurrentPage(1);
          }}
        >
          <SelectTrigger
            className="w-[150px]"
            aria-label="Usage entries per page"
          >
            <SelectValue placeholder="Per page" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="month"
          value={bulkMonth}
          onChange={(event) => setBulkMonth(event.target.value)}
          className="w-[160px]"
        />
        <Button
          variant="outline"
          disabled={companyFilter === "all" || !bulkMonth}
          onClick={() => {
            navigate(
              `/usage/auto-fill?company=${companyFilter}&month=${bulkMonth}`,
            );
          }}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Auto-fill from ManageOne
        </Button>
      </div>

      {/* Data table */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 />
            </EmptyMedia>
            <EmptyTitle>
              {consumption.length === 0 ? "No usage data yet" : "No results"}
            </EmptyTitle>
            <EmptyDescription>
              {consumption.length === 0
                ? "Start by adding entries manually or importing a CSV"
                : "Adjust your filters to see data"}
            </EmptyDescription>
          </EmptyHeader>
          {consumption.length === 0 && (
            <EmptyContent>
              <Button size="sm" onClick={() => setEntryOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Entry
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="border-b p-3 text-sm text-muted-foreground">
              Showing {pageStart}-{pageEnd} of {sortedFiltered.length} entries
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Company</th>
                    <th className="text-left p-3 font-medium">Month</th>
                    <th className="text-left p-3 font-medium">Service</th>
                    <th className="text-right p-3 font-medium">Qty</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                    <th className="text-left p-3 font-medium">Source</th>
                    {isAdmin && <th className="p-3 w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {paginatedEntries.map((entry) => {
                    const company = companyMap.get(entry.companyId);
                    return (
                      <tr key={entry._id} className="border-b last:border-0">
                        <td className="p-3 font-medium">
                          {company?.name || "Unknown"}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {entry.month}
                        </td>
                        <td className="p-3">
                          <Badge variant="secondary" className="text-xs">
                            {entry.serviceType}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-muted-foreground">
                          {entry.quantity != null
                            ? entry.quantity.toLocaleString()
                            : "—"}
                        </td>
                        <td className="p-3 text-right">
                          {formatCurrency(entry.amount)}
                        </td>
                        <td className="p-3">
                          {entry.catalogItemId ? (
                            <Badge
                              variant={
                                entry.isManualOverride
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="text-[10px]"
                            >
                              {entry.isManualOverride
                                ? "adjusted"
                                : "calculated"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              manual
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="p-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer"
                              onClick={() => setDeleteId(entry._id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Showing {pageStart}-{pageEnd} of {sortedFiltered.length} entries
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === 1}
                  onClick={() =>
                    setCurrentPage((page) => Math.max(1, page - 1))
                  }
                >
                  Previous
                </Button>
                <span>
                  Page {safePage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === pageCount}
                  onClick={() =>
                    setCurrentPage((page) => Math.min(pageCount, page + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <UsageEntryDialog
        open={entryOpen}
        onOpenChange={setEntryOpen}
        companies={companies}
      />
      <UsageImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <ConfirmDeleteDialog
        open={!!deleteId}
        onOpenChange={(v) => {
          if (!v) setDeleteId(null);
        }}
        onConfirm={async () => {
          if (!deleteId) return;
          setDeleting(true);
          try {
            await removeEntry({ id: deleteId });
            toast.success("Usage entry deleted");
          } catch {
            toast.error("Failed to delete entry");
          } finally {
            setDeleting(false);
            setDeleteId(null);
          }
        }}
        title="Delete usage entry?"
        description="This action is irreversible. The usage entry will be permanently removed."
        loading={deleting}
      />
    </div>
  );
}
