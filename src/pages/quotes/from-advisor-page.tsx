import { useMutation, useQuery } from "convex/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { AlertTriangle, ArrowLeft, FileText } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

type AdvisorQuotePreview = {
  companyId: Id<"companies">;
  companyName: string;
  recommendationKey: string;
  recommendedService: string;
  sourceRule: string;
  triggerReason: string;
  estimateBasis?: string;
  estimatedMonthlyValue?: number;
  matchedCatalogItem?: {
    catalogItemId: Id<"serviceCatalog">;
    itemName: string;
    serviceCategory: string;
    billingUnit: string;
    monthlyUnitPrice: number;
  };
  lineItemPreview?: {
    catalogItemId: Id<"serviceCatalog">;
    itemName: string;
    serviceCategory: string;
    billingUnit: string;
    quantity: number;
    monthlyUnitPrice: number;
    monthlyTotal: number;
    yearlyTotal: number;
  };
  warnings: string[];
};

function buildAdvisorQuoteNotes(preview: AdvisorQuotePreview) {
  return [
    "Cloud Advisor recommendation",
    `Recommendation key: ${preview.recommendationKey}`,
    `Source rule: ${preview.sourceRule}`,
    `Recommended service: ${preview.recommendedService}`,
    `Trigger reason: ${preview.triggerReason}`,
    preview.estimateBasis ? `Evidence: ${preview.estimateBasis}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function QuoteFromAdvisorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const recommendationKey = searchParams.get("recommendationKey") ?? "";
  const createQuote = useMutation(api.quotes.create);
  const [creating, setCreating] = useState(false);
  const preview = useQuery(
    api.quotes.buildQuotePreviewFromAdvisor,
    recommendationKey ? { recommendationKey } : "skip",
  ) as AdvisorQuotePreview | undefined;

  const returnToAdvisor = () => {
    navigate("/recommendations");
  };

  const handleCreate = async () => {
    if (!preview?.lineItemPreview) {
      return;
    }
    setCreating(true);
    try {
      const quoteId = await createQuote({
        companyId: preview.companyId,
        lineItems: [
          {
            catalogItemId: preview.lineItemPreview.catalogItemId,
            itemName: preview.lineItemPreview.itemName,
            serviceCategory: preview.lineItemPreview.serviceCategory,
            billingUnit: preview.lineItemPreview.billingUnit,
            quantity: preview.lineItemPreview.quantity,
            monthlyUnitPrice: preview.lineItemPreview.monthlyUnitPrice,
          },
        ],
        notes: buildAdvisorQuoteNotes(preview),
      });
      toast.success("Draft quote created");
      navigate(quoteId ? `/quotes/${quoteId}` : "/quotes");
    } catch {
      toast.error("Failed to create quote");
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={returnToAdvisor}>
            <ArrowLeft className="h-4 w-4" />
            Back to Cloud Advisor
          </Button>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            Create Quote from Cloud Advisor
          </h1>
          <p className="mt-1 text-muted-foreground">
            Review the recommendation and catalog-backed quote preview before
            creating a draft quote.
          </p>
        </div>
      </div>

      {!recommendationKey ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Missing Cloud Advisor recommendation key.
          </CardContent>
        </Card>
      ) : !preview ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-primary/10 text-primary">
                  Cloud Advisor
                </Badge>
                <Badge variant="outline">{preview.sourceRule}</Badge>
              </div>
              <CardTitle className="text-xl">{preview.companyName}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Recommended Service
                </div>
                <p className="mt-1 text-foreground">
                  {preview.recommendedService}
                </p>
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Estimated Monthly Value
                </div>
                <p className="mt-1 text-foreground">
                  {typeof preview.estimatedMonthlyValue === "number"
                    ? formatCurrency(preview.estimatedMonthlyValue)
                    : "Not available"}
                </p>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Reason
                </div>
                <p className="mt-1 text-foreground">{preview.triggerReason}</p>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Evidence
                </div>
                <p className="mt-1 text-muted-foreground">
                  {preview.estimateBasis ?? "Rule-based usage signal"}
                </p>
              </div>
            </CardContent>
          </Card>

          {preview.warnings.length > 0 ? (
            <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                  <div>
                    <div className="font-medium text-amber-800 dark:text-amber-200">
                      Review needed
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Catalog Match</CardTitle>
            </CardHeader>
            <CardContent>
              {preview.matchedCatalogItem ? (
                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Item
                    </div>
                    <p className="mt-1">
                      {preview.matchedCatalogItem.itemName}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Category
                    </div>
                    <p className="mt-1">
                      {preview.matchedCatalogItem.serviceCategory}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Billing Unit
                    </div>
                    <p className="mt-1">
                      {preview.matchedCatalogItem.billingUnit}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Monthly Unit Price
                    </div>
                    <p className="mt-1">
                      {formatCurrency(
                        preview.matchedCatalogItem.monthlyUnitPrice,
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No unique service catalog item matched this recommendation.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quote Line Item Preview</CardTitle>
            </CardHeader>
            <CardContent>
              {preview.lineItemPreview ? (
                <div
                  className="overflow-x-auto"
                  data-testid="advisor-quote-preview"
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="p-3 text-left font-medium">Item</th>
                        <th className="p-3 text-left font-medium">Unit</th>
                        <th className="p-3 text-right font-medium">Quantity</th>
                        <th className="p-3 text-right font-medium">Monthly</th>
                        <th className="p-3 text-right font-medium">Yearly</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="p-3">
                          <div className="font-medium">
                            {preview.lineItemPreview.itemName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {preview.lineItemPreview.serviceCategory}
                          </div>
                        </td>
                        <td className="p-3">
                          {preview.lineItemPreview.billingUnit}
                        </td>
                        <td className="p-3 text-right">
                          {preview.lineItemPreview.quantity}
                        </td>
                        <td className="p-3 text-right">
                          {formatCurrency(preview.lineItemPreview.monthlyTotal)}
                        </td>
                        <td className="p-3 text-right">
                          {formatCurrency(preview.lineItemPreview.yearlyTotal)}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20 font-bold">
                        <td className="p-3" colSpan={3}>
                          Grand Total
                        </td>
                        <td className="p-3 text-right">
                          {formatCurrency(preview.lineItemPreview.monthlyTotal)}
                        </td>
                        <td className="p-3 text-right">
                          {formatCurrency(preview.lineItemPreview.yearlyTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  This recommendation needs manual catalog/quantity review
                  before creating a quote.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" onClick={returnToAdvisor}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!preview.lineItemPreview || creating}
            >
              <FileText className="h-4 w-4" />
              {creating ? "Creating..." : "Create Draft Quote"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
