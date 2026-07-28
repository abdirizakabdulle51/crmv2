import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
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
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getCurrentMonth } from "@/pages/usage/_lib/constants.ts";
import { toast } from "sonner";

type QuoteGenerateFromUsageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Doc<"companies">[];
};

export default function QuoteGenerateFromUsageDialog({
  open,
  onOpenChange,
  companies,
}: QuoteGenerateFromUsageDialogProps) {
  const createQuote = useMutation(api.quotes.create);
  const [companyId, setCompanyId] = useState("");
  const [month, setMonth] = useState(getCurrentMonth());
  const [creating, setCreating] = useState(false);
  const preview = useQuery(
    api.quotes.buildQuotePreviewFromUsage,
    open && companyId && month
      ? { companyId: companyId as Id<"companies">, month }
      : "skip",
  );

  const reset = () => {
    setCompanyId("");
    setMonth(getCurrentMonth());
    setCreating(false);
  };

  const handleCreate = async () => {
    if (!preview || !companyId || preview.lineItems.length === 0) {
      return;
    }
    setCreating(true);
    try {
      await createQuote({
        companyId: companyId as Id<"companies">,
        lineItems: preview.lineItems,
        monthlyGrandTotal: preview.monthlyGrandTotal,
        yearlyGrandTotal: preview.yearlyGrandTotal,
        notes: `Generated from Usage Tracking for ${month}`,
      });
      toast.success("Draft quote created");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to create quote");
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) {
          reset();
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Generate Quote from Usage</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="min-w-0 space-y-2">
              <Label>Company *</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
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
              <Label>Month *</Label>
              <Input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>
          </div>

          {companyId && month && !preview && (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              {preview.lineItems.length === 0 ? (
                <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
                  {preview.warnings.length === 0
                    ? "No usage entries were found for this company and month."
                    : "No usage entries with catalog items and quantities were found for this month."}
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium">Service</th>
                        <th className="p-3 text-left font-medium">
                          Catalog Item
                        </th>
                        <th className="p-3 text-right font-medium">Quantity</th>
                        <th className="p-3 text-right font-medium">Monthly</th>
                        <th className="p-3 text-right font-medium">Yearly</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lineItems.map((item, index) => (
                        <tr
                          key={`${item.catalogItemId}-${index}`}
                          className="border-b last:border-0"
                        >
                          <td className="p-3">
                            <Badge variant="secondary" className="text-xs">
                              {item.serviceCategory}
                            </Badge>
                          </td>
                          <td className="p-3">
                            <div className="font-medium">{item.itemName}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.billingUnit} at $
                              {item.monthlyUnitPrice.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 4,
                              })}
                              /mo
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {item.quantity.toLocaleString()}
                          </td>
                          <td className="p-3 text-right">
                            $
                            {item.monthlyTotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-3 text-right">
                            $
                            {item.yearlyTotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/20">
                      <tr>
                        <td
                          colSpan={3}
                          className="p-3 text-right font-semibold"
                        >
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-bold">
                          $
                          {preview.monthlyGrandTotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-3 text-right font-bold">
                          $
                          {preview.yearlyGrandTotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="rounded-md border p-3">
                  <h3 className="mb-2 text-sm font-medium">
                    Excluded usage entries
                  </h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {preview.warnings.map((warning, index) => (
                      <li key={`${warning.serviceType}-${index}`}>
                        {warning.serviceType}: $
                        {warning.amount.toLocaleString()}
                        {" - "}
                        {warning.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!preview || preview.lineItems.length === 0 || creating}
          >
            Create Draft Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
