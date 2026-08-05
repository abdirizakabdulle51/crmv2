import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { ArrowLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { getCurrentMonth } from "./_lib/constants.ts";
import { formatCurrency } from "@/lib/format.ts";

type BulkPreviewRow = {
  serviceType: string;
  catalogItemId: Id<"serviceCatalog">;
  catalogItemName: string;
  quantity: number;
  amount: number;
  alreadyLogged: boolean;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

const rowKey = (row: BulkPreviewRow) =>
  `${row.serviceType}:${row.catalogItemId}:${
    row.regionId ?? row.regionName ?? row.dataCenterName ?? ""
  }`;

export default function UsageAutoFillPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const bulkCreateFromManageOne = useMutation(
    api.consumption.bulkCreateFromManageOne,
  );
  const [companyId, setCompanyId] = useState(searchParams.get("company") ?? "");
  const [month, setMonth] = useState(
    searchParams.get("month") ?? getCurrentMonth(),
  );
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());
  const [bulkCreating, setBulkCreating] = useState(false);
  const bulkPreview = useQuery(
    api.manageOneTenants.getBulkUsagePreview,
    companyId && month
      ? {
          companyId: companyId as Id<"companies">,
          month,
        }
      : "skip",
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (companyId) next.set("company", companyId);
    if (month) next.set("month", month);
    setSearchParams(next, { replace: true });
  }, [companyId, month, setSearchParams]);

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

  const checkedPreviewRows =
    bulkPreview?.rows.filter((row) => checkedRows.has(rowKey(row))) ?? [];

  const returnToUsage = () => {
    const params = new URLSearchParams();
    if (companyId) params.set("company", companyId);
    if (month) params.set("month", month);
    navigate(`/usage${params.toString() ? `?${params.toString()}` : ""}`);
  };

  if (!companies) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button
            variant="ghost"
            className="mb-3 -ml-2"
            onClick={returnToUsage}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Usage
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            Auto-fill from ManageOne
          </h1>
          <p className="text-muted-foreground mt-1">
            Review detected ManageOne usage before creating entries.
          </p>
        </div>
        <Button
          disabled={
            !bulkPreview ||
            checkedPreviewRows.length === 0 ||
            !companyId ||
            bulkCreating
          }
          onClick={async () => {
            if (!bulkPreview || !companyId) {
              return;
            }
            setBulkCreating(true);
            try {
              const result = await bulkCreateFromManageOne({
                companyId: companyId as Id<"companies">,
                month,
                rows: checkedPreviewRows.map((row) => ({
                  serviceType: row.serviceType,
                  catalogItemId: row.catalogItemId,
                  quantity: row.quantity,
                  amount: row.amount,
                  regionId: row.regionId,
                  regionName: row.regionName,
                  dataCenterName: row.dataCenterName,
                })),
              });
              toast.success(`Created ${result.inserted} usage entries`);
              returnToUsage();
            } catch {
              toast.error("Failed to auto-fill usage");
            } finally {
              setBulkCreating(false);
            }
          }}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Create {checkedPreviewRows.length} Entries
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((company) => (
                  <SelectItem key={company._id} value={company._id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="auto-fill-month">Month</Label>
            <Input
              id="auto-fill-month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="w-[180px]"
            />
          </div>
          <Button variant="outline" onClick={returnToUsage}>
            Cancel
          </Button>
        </CardContent>
      </Card>

      {!companyId ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Select a company to preview ManageOne usage.
          </CardContent>
        </Card>
      ) : !bulkPreview ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <div
                className="overflow-x-auto"
                data-testid="bulk-preview-line-items"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
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
                              {formatCurrency(row.amount)}
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
            </CardContent>
          </Card>

          {bulkPreview.needsManualEntry.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h2 className="text-sm font-medium mb-2">Needs manual entry</h2>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {bulkPreview.needsManualEntry.map((item, index) => (
                    <li key={`${item.serviceType}-${item.label}-${index}`}>
                      {item.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={returnToUsage}>
              Cancel
            </Button>
            <Button
              disabled={checkedPreviewRows.length === 0 || bulkCreating}
              onClick={async () => {
                if (!companyId) {
                  return;
                }
                setBulkCreating(true);
                try {
                  const result = await bulkCreateFromManageOne({
                    companyId: companyId as Id<"companies">,
                    month,
                    rows: checkedPreviewRows.map((row) => ({
                      serviceType: row.serviceType,
                      catalogItemId: row.catalogItemId,
                      quantity: row.quantity,
                      amount: row.amount,
                      regionId: row.regionId,
                      regionName: row.regionName,
                      dataCenterName: row.dataCenterName,
                    })),
                  });
                  toast.success(`Created ${result.inserted} usage entries`);
                  returnToUsage();
                } catch {
                  toast.error("Failed to auto-fill usage");
                } finally {
                  setBulkCreating(false);
                }
              }}
            >
              Create {checkedPreviewRows.length} Entries
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
