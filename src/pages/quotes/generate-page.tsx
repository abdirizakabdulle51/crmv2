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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { getCurrentMonth } from "@/pages/usage/_lib/constants.ts";
import { ArrowLeft, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function QuoteGenerateFromUsagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const createQuote = useMutation(api.quotes.create);
  const [companyId, setCompanyId] = useState(searchParams.get("company") ?? "");
  const [month, setMonth] = useState(
    searchParams.get("month") ?? getCurrentMonth(),
  );
  const [creating, setCreating] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [discountPercent, setDiscountPercent] = useState("");
  const preview = useQuery(
    api.quotes.buildQuotePreviewFromUsage,
    companyId && month
      ? { companyId: companyId as Id<"companies">, month }
      : "skip",
  );

  useEffect(() => {
    const next = new URLSearchParams();
    if (companyId) next.set("company", companyId);
    if (month) next.set("month", month);
    setSearchParams(next, { replace: true });
  }, [companyId, month, setSearchParams]);

  const returnToQuotes = () => {
    navigate("/quotes");
  };

  const discountValue = Math.min(
    100,
    Math.max(0, parseFloat(discountPercent) || 0),
  );
  const monthlySubtotal = preview?.monthlyGrandTotal ?? 0;
  const yearlySubtotal = preview?.yearlyGrandTotal ?? 0;
  const monthlyDiscountTotal = monthlySubtotal * (discountValue / 100);
  const yearlyDiscountTotal = yearlySubtotal * (discountValue / 100);
  const monthlyGrandTotal = monthlySubtotal - monthlyDiscountTotal;
  const yearlyGrandTotal = yearlySubtotal - yearlyDiscountTotal;

  const handleCreate = async () => {
    if (!preview || !companyId || preview.lineItems.length === 0) {
      return;
    }
    if (preview.existingQuote && !allowDuplicate) {
      toast.error(
        "Confirm that you want to create another quote for this month",
      );
      return;
    }
    setCreating(true);
    try {
      await createQuote({
        companyId: companyId as Id<"companies">,
        lineItems: preview.lineItems,
        monthlyGrandTotal,
        yearlyGrandTotal,
        discountPercent: discountValue,
        notes: `Generated from Usage Tracking for ${month}`,
        sourceMonth: month,
      });
      toast.success("Draft quote created");
      returnToQuotes();
    } catch {
      toast.error("Failed to create quote");
      setCreating(false);
    }
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
            onClick={returnToQuotes}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Quotes
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            Generate Quote from Usage
          </h1>
          <p className="text-muted-foreground mt-1">
            Review usage-backed line items before creating a draft quote.
          </p>
        </div>
        <Button
          disabled={
            !preview ||
            preview.lineItems.length === 0 ||
            creating ||
            (!!preview.existingQuote && !allowDuplicate)
          }
          onClick={handleCreate}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {preview?.existingQuote
            ? "Create Another Draft Quote"
            : "Create Draft Quote"}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label>Company</Label>
            <Select
              value={companyId}
              onValueChange={(value) => {
                setCompanyId(value);
                setAllowDuplicate(false);
              }}
            >
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
            <Label htmlFor="quote-generate-month">Month</Label>
            <Input
              id="quote-generate-month"
              type="month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setAllowDuplicate(false);
              }}
              className="w-[180px]"
            />
          </div>
          <Button variant="outline" onClick={returnToQuotes}>
            Cancel
          </Button>
        </CardContent>
      </Card>

      {!companyId ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Select a company to preview usage entries for a draft quote.
          </CardContent>
        </Card>
      ) : !preview ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {preview.existingQuote && (
            <Card className="border-amber-500/50 bg-amber-500/10">
              <CardContent className="p-4 text-sm">
                <div className="font-medium text-amber-700 dark:text-amber-300">
                  A quote already exists for this company and month.
                </div>
                <p className="mt-1 text-muted-foreground">
                  Created {preview.existingQuote.date}, status:{" "}
                  {preview.existingQuote.status}.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={returnToQuotes}
                  >
                    View Existing Quote
                  </Button>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowDuplicate}
                      onCheckedChange={(checked) =>
                        setAllowDuplicate(checked === true)
                      }
                    />
                    Create another quote anyway
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          {preview.lineItems.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                {preview.warnings.length === 0
                  ? "No usage entries were found for this company and month."
                  : "No usage entries with catalog items and quantities were found for this month."}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto" data-testid="quote-preview">
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
                          Discount %
                        </td>
                        <td colSpan={2} className="p-3 text-right">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={discountPercent}
                            onChange={(event) =>
                              setDiscountPercent(event.target.value)
                            }
                            placeholder="0"
                            className="ml-auto w-[140px] text-right"
                          />
                        </td>
                      </tr>
                      <tr>
                        <td
                          colSpan={3}
                          className="p-3 text-right font-semibold"
                        >
                          Subtotal
                        </td>
                        <td className="p-3 text-right font-bold">
                          $
                          {monthlySubtotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-3 text-right font-bold">
                          $
                          {yearlySubtotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                      {discountValue > 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="p-3 text-right font-semibold"
                          >
                            Discount ({discountValue}%)
                          </td>
                          <td className="p-3 text-right font-bold text-emerald-700">
                            -$
                            {monthlyDiscountTotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="p-3 text-right font-bold text-emerald-700">
                            -$
                            {yearlyDiscountTotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td
                          colSpan={3}
                          className="p-3 text-right font-semibold"
                        >
                          Grand Total
                        </td>
                        <td className="p-3 text-right font-bold">
                          $
                          {monthlyGrandTotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="p-3 text-right font-bold">
                          $
                          {yearlyGrandTotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {preview.warnings.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <h2 className="mb-2 text-sm font-medium">
                  Excluded usage entries
                </h2>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.serviceType}-${index}`}>
                      {warning.serviceType}: ${warning.amount.toLocaleString()}
                      {" - "}
                      {warning.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={returnToQuotes}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                preview.lineItems.length === 0 ||
                creating ||
                (!!preview.existingQuote && !allowDuplicate)
              }
            >
              {preview.existingQuote
                ? "Create Another Draft Quote"
                : "Create Draft Quote"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
