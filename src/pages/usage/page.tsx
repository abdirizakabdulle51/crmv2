import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { toast } from "sonner";
import { getCurrentMonth } from "./_lib/constants.ts";

type BulkPreviewRow = {
  serviceType: string;
  catalogItemId: Id<"serviceCatalog">;
  catalogItemName: string;
  quantity: number;
  amount: number;
  alreadyLogged: boolean;
};

export default function UsagePage() {
  const companies = useQuery(api.companies.list, {});
  const consumption = useQuery(api.consumption.list, {});
  const removeEntry = useMutation(api.consumption.remove);
  const bulkCreateFromManageOne = useMutation(
    api.consumption.bulkCreateFromManageOne,
  );
  const { isAdmin } = useCrm();

  const [entryOpen, setEntryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkPreviewOpen, setBulkPreviewOpen] = useState(false);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [bulkMonth, setBulkMonth] = useState(getCurrentMonth());
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());
  const [bulkCreating, setBulkCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<Id<"consumption"> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bulkPreview = useQuery(
    api.manageOneTenants.getBulkUsagePreview,
    bulkPreviewOpen && companyFilter !== "all" && bulkMonth
      ? {
          companyId: companyFilter as Id<"companies">,
          month: bulkMonth,
        }
      : "skip",
  );

  const rowKey = (row: BulkPreviewRow) =>
    `${row.serviceType}:${row.catalogItemId}`;

  useEffect(() => {
    if (!bulkPreview) {
      return;
    }
    setCheckedRows(
      new Set(
        bulkPreview.rows
          .filter((row) => !row.alreadyLogged)
          .map((row) => rowKey(row)),
      ),
    );
  }, [bulkPreview]);

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
  const checkedPreviewRows =
    bulkPreview?.rows.filter((row) => checkedRows.has(rowKey(row))) ?? [];

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
              $
              {totalAmount.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
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
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
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
        <Select value={monthFilter} onValueChange={setMonthFilter}>
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
        <Input
          type="month"
          value={bulkMonth}
          onChange={(event) => setBulkMonth(event.target.value)}
          className="w-[160px]"
        />
        <Button
          variant="outline"
          disabled={companyFilter === "all" || !bulkMonth}
          onClick={() => setBulkPreviewOpen(true)}
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
                  {filtered
                    .sort((a, b) => b.month.localeCompare(a.month))
                    .slice(0, 100)
                    .map((entry) => {
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
                            $
                            {entry.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
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
            {filtered.length > 100 && (
              <p className="text-xs text-muted-foreground p-3 border-t">
                Showing first 100 of {filtered.length} entries
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <UsageEntryDialog
        open={entryOpen}
        onOpenChange={setEntryOpen}
        companies={companies}
      />
      <UsageImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <Dialog open={bulkPreviewOpen} onOpenChange={setBulkPreviewOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Auto-fill from ManageOne</DialogTitle>
          </DialogHeader>
          {!bulkPreview ? (
            <div className="min-h-0 flex-1 space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div
                className="min-h-0 flex-1 overflow-y-auto rounded-md border"
                data-testid="bulk-preview-line-items"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 border-b bg-muted/30">
                      <th className="w-10 p-3"></th>
                      <th className="text-left p-3 font-medium">Service</th>
                      <th className="text-left p-3 font-medium">
                        Catalog Item
                      </th>
                      <th className="text-right p-3 font-medium">Qty</th>
                      <th className="text-right p-3 font-medium">Amount</th>
                      <th className="text-left p-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreview.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-6 text-center text-muted-foreground"
                        >
                          No auto-priceable ManageOne usage was detected.
                        </td>
                      </tr>
                    ) : (
                      bulkPreview.rows.map((row) => {
                        const key = rowKey(row);
                        return (
                          <tr
                            key={key}
                            className={
                              row.alreadyLogged
                                ? "border-b opacity-60"
                                : "border-b"
                            }
                          >
                            <td className="p-3">
                              <Checkbox
                                checked={checkedRows.has(key)}
                                disabled={row.alreadyLogged}
                                onCheckedChange={(checked) => {
                                  setCheckedRows((current) => {
                                    const next = new Set(current);
                                    if (checked) {
                                      next.add(key);
                                    } else {
                                      next.delete(key);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="p-3">
                              <Badge variant="secondary" className="text-xs">
                                {row.serviceType}
                              </Badge>
                            </td>
                            <td className="p-3">{row.catalogItemName}</td>
                            <td className="p-3 text-right">
                              {row.quantity.toLocaleString()}
                            </td>
                            <td className="p-3 text-right">
                              $
                              {row.amount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="p-3">
                              {row.alreadyLogged ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  Already logged this month
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  From ManageOne
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {bulkPreview.needsManualEntry.length > 0 && (
                <div className="rounded-md border p-3">
                  <h3 className="text-sm font-medium mb-2">
                    Needs manual entry
                  </h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {bulkPreview.needsManualEntry.map((item, index) => (
                      <li key={`${item.serviceType}-${item.label}-${index}`}>
                        {item.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="shrink-0">
            <Button
              variant="outline"
              onClick={() => setBulkPreviewOpen(false)}
              disabled={bulkCreating}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !bulkPreview ||
                checkedPreviewRows.length === 0 ||
                companyFilter === "all" ||
                bulkCreating
              }
              onClick={async () => {
                if (!bulkPreview || companyFilter === "all") {
                  return;
                }
                setBulkCreating(true);
                try {
                  const result = await bulkCreateFromManageOne({
                    companyId: companyFilter as Id<"companies">,
                    month: bulkMonth,
                    rows: checkedPreviewRows.map((row) => ({
                      serviceType: row.serviceType,
                      catalogItemId: row.catalogItemId,
                      quantity: row.quantity,
                      amount: row.amount,
                    })),
                  });
                  toast.success(`Created ${result.inserted} usage entries`);
                  setBulkPreviewOpen(false);
                } catch {
                  toast.error("Failed to auto-fill usage");
                } finally {
                  setBulkCreating(false);
                }
              }}
            >
              Create {checkedPreviewRows.length} Entries
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
