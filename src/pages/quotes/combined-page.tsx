import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
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
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { getCurrentMonth } from "@/pages/usage/_lib/constants.ts";
import { formatCurrency } from "@/lib/format.ts";
import { cn } from "@/lib/utils.ts";
import {
  ArrowLeft,
  Building2,
  Calculator,
  FileCheck2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

type CombinedLine = {
  sourceCompanyId?: Id<"companies">;
  sourceCompanyName?: string;
  source: "usage" | "latest_accepted_quote" | "manual";
  product: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
  amount: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateLineAmount(line: CombinedLine) {
  const base = line.quantity * line.unitPrice;
  const discount = base * (line.discountPercent / 100);
  const taxable = base - discount;
  const tax = taxable * (line.taxRate / 100);
  return roundMoney(taxable + tax);
}

function numberFromInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function sourceLabel(source: CombinedLine["source"]) {
  if (source === "usage") return "Usage";
  if (source === "latest_accepted_quote") return "Accepted Quote";
  return "Manual";
}

export default function CombinedQuotePage() {
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const createCombinedQuote = useMutation(api.combinedQuotes.create);
  const [parentCompanyName, setParentCompanyName] = useState("");
  const [month, setMonth] = useState(getCurrentMonth());
  const [expirationDate, setExpirationDate] = useState(defaultExpirationDate);
  const [paymentTerms, setPaymentTerms] = useState("Immediate");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<
    Id<"companies">[]
  >([]);
  const [lines, setLines] = useState<CombinedLine[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const preview = useQuery(
    api.combinedQuotes.buildPreview,
    selectedCompanyIds.length > 0
      ? { companyIds: selectedCompanyIds, month }
      : "skip",
  );

  useEffect(() => {
    if (preview) {
      setLines(preview.lines as CombinedLine[]);
    }
  }, [preview]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const base = line.quantity * line.unitPrice;
        const discount = base * (line.discountPercent / 100);
        const taxable = base - discount;
        const tax = taxable * (line.taxRate / 100);

        return {
          subtotal: acc.subtotal + base,
          discountTotal: acc.discountTotal + discount,
          taxTotal: acc.taxTotal + tax,
          grandTotal: acc.grandTotal + line.amount,
        };
      },
      { subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0 },
    );
  }, [lines]);

  const selectedCompanies = useMemo(() => {
    if (!companies) return [];
    const selected = new Set(selectedCompanyIds);
    return companies.filter((company) => selected.has(company._id));
  }, [companies, selectedCompanyIds]);

  const setLine = (index: number, patch: Partial<CombinedLine>) => {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, ...patch };
        return { ...next, amount: calculateLineAmount(next) };
      }),
    );
  };

  const addManualLine = () => {
    setLines((current) => [
      ...current,
      {
        source: "manual",
        product: "Compute, Network and Storage Services",
        quantity: 12,
        unitPrice: 0,
        taxRate: 0,
        discountPercent: 0,
        amount: 0,
      },
    ]);
  };

  const removeLine = (index: number) => {
    setLines((current) =>
      current.filter((_, lineIndex) => lineIndex !== index),
    );
  };

  const saveDraft = async () => {
    if (!parentCompanyName.trim()) {
      toast.error("Type the parent company name");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one quote line");
      return;
    }

    setSaving(true);
    try {
      const quoteId = await createCombinedQuote({
        parentCompanyName,
        sourceMonth: month,
        expirationDate,
        paymentTerms,
        lineItems: lines.map((line) => ({
          sourceCompanyId: line.sourceCompanyId,
          sourceCompanyName: line.sourceCompanyName,
          source: line.source,
          product: line.product.trim(),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          discountPercent: line.discountPercent,
        })),
        notes,
      });
      toast.success("Combined quote draft saved");
      navigate(`/quotes/combined/${quoteId}`);
    } catch {
      toast.error("Failed to save combined quote");
      setSaving(false);
    }
  };

  if (!companies) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button
            variant="ghost"
            className="-ml-2 mb-3"
            onClick={() => navigate("/quotes")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Quotes
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Combined Quote</h1>
          <p className="mt-1 text-muted-foreground">
            Build one editable quote for a parent company using multiple CRM
            companies.
          </p>
        </div>
        <Button onClick={saveDraft} disabled={saving || lines.length === 0}>
          <Save className="mr-2 h-4 w-4" />
          Save Draft
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Quote Setup
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_180px_180px]">
            <div className="space-y-2">
              <Label htmlFor="parent-company">Parent / Main Company Name</Label>
              <Input
                id="parent-company"
                value={parentCompanyName}
                onChange={(event) => setParentCompanyName(event.target.value)}
                placeholder="Example: Safarifone Inc"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="combined-month">Usage Month</Label>
              <Input
                id="combined-month"
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiration-date">Expiration</Label>
              <Input
                id="expiration-date"
                type="date"
                value={expirationDate}
                onChange={(event) => setExpirationDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-terms">Payment Terms</Label>
              <Input
                id="payment-terms"
                value={paymentTerms}
                onChange={(event) => setPaymentTerms(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-primary" />
              Totals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly Total</span>
              <span className="font-medium">
                {formatCurrency(
                  lines.reduce((sum, line) => sum + line.unitPrice, 0),
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">
                {formatCurrency(totals.subtotal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="font-medium">
                {formatCurrency(totals.discountTotal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span className="font-medium">
                {formatCurrency(totals.taxTotal)}
              </span>
            </div>
            <div className="border-t pt-3">
              <div className="flex justify-between text-base">
                <span className="font-semibold">Grand Total</span>
                <span className="font-bold">
                  {formatCurrency(totals.grandTotal)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Included Companies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Command className="rounded-md border">
              <CommandInput placeholder="Search companies..." />
              <CommandList className="max-h-[360px]">
                <CommandEmpty>No companies found.</CommandEmpty>
                {companies
                  .slice()
                  .sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, {
                      sensitivity: "base",
                    }),
                  )
                  .map((company) => {
                    const checked = selectedCompanyIds.includes(company._id);
                    return (
                      <CommandItem
                        key={company._id}
                        value={company.name}
                        onSelect={() => {
                          setSelectedCompanyIds((current) =>
                            checked
                              ? current.filter((id) => id !== company._id)
                              : [...current, company._id],
                          );
                        }}
                      >
                        <Checkbox
                          className="mr-2 pointer-events-none"
                          checked={checked}
                        />
                        <span className="truncate">{company.name}</span>
                      </CommandItem>
                    );
                  })}
              </CommandList>
            </Command>

            {selectedCompanies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedCompanies.map((company) => (
                  <Badge key={company._id} variant="secondary">
                    {company.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select companies to pull their monthly usage total. You can
                still add manual lines.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Quote Lines</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Quantity defaults to 12 months. Every value can be edited before
                saving.
              </p>
            </div>
            <Button variant="outline" onClick={addManualLine}>
              <Plus className="mr-2 h-4 w-4" />
              Add Manual Line
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {selectedCompanyIds.length > 0 && !preview ? (
              <div className="space-y-3 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : lines.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Select companies or add a manual line to start the combined
                quote.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Product</TableHead>
                    <TableHead className="w-[100px] text-right">Qty</TableHead>
                    <TableHead className="w-[150px] text-right">
                      Unit Price
                    </TableHead>
                    <TableHead className="w-[100px] text-right">
                      Taxes
                    </TableHead>
                    <TableHead className="w-[100px] text-right">
                      Disc.%
                    </TableHead>
                    <TableHead className="w-[150px] text-right">
                      Amount
                    </TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow
                      key={`${line.sourceCompanyId ?? "manual"}-${index}`}
                    >
                      <TableCell className="min-w-[340px] whitespace-normal">
                        <Input
                          value={line.product}
                          onChange={(event) =>
                            setLine(index, { product: event.target.value })
                          }
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">
                            {sourceLabel(line.source)}
                          </Badge>
                          {line.sourceCompanyName
                            ? line.sourceCompanyName
                            : "Manual line"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={line.quantity}
                          onChange={(event) =>
                            setLine(index, {
                              quantity: numberFromInput(event.target.value),
                            })
                          }
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(event) =>
                            setLine(index, {
                              unitPrice: numberFromInput(event.target.value),
                            })
                          }
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.taxRate}
                          onChange={(event) =>
                            setLine(index, {
                              taxRate: numberFromInput(event.target.value),
                            })
                          }
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.discountPercent}
                          onChange={(event) =>
                            setLine(index, {
                              discountPercent: numberFromInput(
                                event.target.value,
                              ),
                            })
                          }
                          className="text-right"
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(line.amount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove line"
                          onClick={() => removeLine(index)}
                          className={cn(
                            "text-destructive hover:text-destructive",
                          )}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={5} className="text-right">
                      Grand Total
                    </TableCell>
                    <TableCell className="text-right text-base font-bold">
                      {formatCurrency(totals.grandTotal)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="h-4 w-4 text-primary" />
            Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Payment terms, special conditions, or internal notes..."
            rows={4}
          />
        </CardContent>
      </Card>
    </div>
  );
}
