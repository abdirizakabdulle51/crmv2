import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
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
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/format.ts";
import { PRODUCT_GROUPS } from "@/lib/product-groups.ts";

type CatalogItem = Doc<"serviceCatalog">;

type LineItem = {
  catalogItemId: Id<"serviceCatalog">;
  itemName: string;
  serviceCategory: string;
  billingUnit: string;
  quantity: number;
  monthlyUnitPrice: number;
  serviceDiscountPercent?: number;
  monthlyTotal: number;
  yearlyTotal: number;
};

type QuoteCreateDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Doc<"companies">[];
  leads?: Doc<"leads">[];
};

export default function QuoteCreateDialog({
  open,
  onOpenChange,
  companies,
  leads = [],
}: QuoteCreateDialogProps) {
  const catalog = useQuery(api.serviceCatalog.list, {});
  const createQuote = useMutation(api.quotes.create);

  const [companyId, setCompanyId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [commercialModel, setCommercialModel] = useState<"payg" | "contracted">(
    "payg",
  );
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [pricingModel, setPricingModel] = useState<
    "flexible_total_commitment" | "monthly_minimum" | "discounted_usage"
  >("flexible_total_commitment");
  const [commitmentValue, setCommitmentValue] = useState("");
  const [groupDiscounts, setGroupDiscounts] = useState<Record<string, string>>(
    {},
  );
  const [notes, setNotes] = useState("");

  // Add line item state
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [serviceDiscount, setServiceDiscount] = useState("");

  const addLineItem = () => {
    if (!selectedCatalogId || !quantity) {
      toast.error("Select a catalog item and enter quantity");
      return;
    }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Please enter a valid quantity");
      return;
    }
    const catalogItem = catalog?.find((c) => c._id === selectedCatalogId);
    if (!catalogItem) return;

    const discount =
      commercialModel === "contracted"
        ? Number(
            serviceDiscount ||
              (catalogItem.productGroup
                ? groupDiscounts[catalogItem.productGroup]
                : "") ||
              0,
          )
        : 0;
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      toast.error("Discount must be between 0% and 100%");
      return;
    }
    const monthlyUnitPrice =
      catalogItem.monthlyPrice * ((100 - discount) / 100);
    const monthlyTotal = qty * monthlyUnitPrice;
    const yearlyTotal = catalogItem.yearlyPrice
      ? qty * catalogItem.yearlyPrice * ((100 - discount) / 100)
      : monthlyTotal * 12;

    const newItem: LineItem = {
      catalogItemId: catalogItem._id,
      itemName: catalogItem.itemName,
      serviceCategory: catalogItem.serviceCategory,
      billingUnit: catalogItem.billingUnit,
      quantity: qty,
      monthlyUnitPrice,
      serviceDiscountPercent:
        serviceDiscount === "" ? undefined : Number(serviceDiscount),
      monthlyTotal,
      yearlyTotal,
    };

    setLineItems([...lineItems, newItem]);
    setSelectedCatalogId("");
    setQuantity("");
    setServiceDiscount("");
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const monthlyGrandTotal = lineItems.reduce(
    (sum, li) => sum + li.monthlyTotal,
    0,
  );
  const yearlyGrandTotal = lineItems.reduce(
    (sum, li) => sum + li.yearlyTotal,
    0,
  );

  const handleCreate = async () => {
    if (!leadId) {
      toast.error("Please select an opportunity");
      return;
    }
    if (!companyId) {
      toast.error("Please select a company");
      return;
    }
    if (lineItems.length === 0) {
      toast.error("Add at least one line item");
      return;
    }

    try {
      await createQuote({
        companyId: companyId as Id<"companies">,
        leadId: leadId ? (leadId as Id<"leads">) : undefined,
        commercialModel,
        contractTerms:
          commercialModel === "contracted"
            ? {
                pricingModel,
                contractValue:
                  pricingModel === "flexible_total_commitment"
                    ? Number(commitmentValue)
                    : undefined,
                monthlyMinimum:
                  pricingModel === "monthly_minimum"
                    ? Number(commitmentValue)
                    : undefined,
                groupDiscounts: Object.entries(groupDiscounts)
                  .filter(([, value]) => value !== "")
                  .map(([productGroup, value]) => ({
                    productGroup,
                    discountPercent: Number(value),
                  })),
              }
            : undefined,
        lineItems: lineItems.map((line) => ({
          catalogItemId: line.catalogItemId,
          itemName: line.itemName,
          serviceCategory: line.serviceCategory,
          billingUnit: line.billingUnit,
          quantity: line.quantity,
          monthlyUnitPrice: line.monthlyUnitPrice,
          serviceDiscountPercent: line.serviceDiscountPercent,
        })),
        notes: notes.trim() || undefined,
      });
      toast.success("Quote created");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create quote",
      );
    }
  };

  const resetForm = () => {
    setCompanyId("");
    setLeadId("");
    setCommercialModel("payg");
    setPricingModel("flexible_total_commitment");
    setCommitmentValue("");
    setGroupDiscounts({});
    setLineItems([]);
    setNotes("");
    setSelectedCatalogId("");
    setQuantity("");
    setServiceDiscount("");
  };

  // Group catalog by category for easier selection
  const catalogByCategory = new Map<string, CatalogItem[]>();
  for (const item of catalog || []) {
    const arr = catalogByCategory.get(item.serviceCategory) || [];
    arr.push(item);
    catalogByCategory.set(item.serviceCategory, arr);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetForm();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Quote</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            Sequence: select an opportunity, prepare and send the quote, accept
            it, then mark the opportunity won to onboard the customer.
          </div>
          <div className="space-y-2">
            <Label>Opportunity *</Label>
            <Select
              value={leadId}
              onValueChange={(value) => {
                setLeadId(value);
                const lead = leads.find((row) => row._id === value);
                setCompanyId(lead?.companyId ?? "");
              }}
            >
              <SelectTrigger aria-label="Opportunity">
                <SelectValue placeholder="Select open opportunity" />
              </SelectTrigger>
              <SelectContent>
                {leads
                  .filter(
                    (lead) =>
                      lead.companyId &&
                      lead.stage !== "won" &&
                      lead.stage !== "lost",
                  )
                  .map((lead) => (
                    <SelectItem key={lead._id} value={lead._id}>
                      {lead.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Commercial outcome *</Label>
            <Select
              value={commercialModel}
              onValueChange={(value) =>
                setCommercialModel(value as "payg" | "contracted")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payg">
                  Pay As You Go — catalogue price
                </SelectItem>
                <SelectItem value="contracted">
                  Contract — configure discounts after acceptance
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {commercialModel === "contracted" ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Contract pricing model</Label>
                  <Select
                    value={pricingModel}
                    onValueChange={(value) =>
                      setPricingModel(value as typeof pricingModel)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flexible_total_commitment">
                        Total commitment
                      </SelectItem>
                      <SelectItem value="monthly_minimum">
                        Monthly minimum
                      </SelectItem>
                      <SelectItem value="discounted_usage">
                        Usage with discounts
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {pricingModel !== "discounted_usage" ? (
                  <div className="space-y-2">
                    <Label>
                      {pricingModel === "monthly_minimum"
                        ? "Monthly minimum"
                        : "Contract value"}
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={commitmentValue}
                      onChange={(event) =>
                        setCommitmentValue(event.target.value)
                      }
                    />
                  </div>
                ) : null}
              </div>
              <div>
                <Label>Product-group discounts</Label>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PRODUCT_GROUPS.map((group) => (
                    <div key={group.value} className="space-y-1">
                      <Label className="text-xs">{group.label} %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={groupDiscounts[group.value] ?? ""}
                        onChange={(event) =>
                          setGroupDiscounts({
                            ...groupDiscounts,
                            [group.value]: event.target.value,
                          })
                        }
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {/* Company selection */}
          <div className="space-y-2">
            <Label>Company *</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Add line item */}
          <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
            <h4 className="text-sm font-medium">Add Line Item</h4>
            <div
              className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_150px_150px]"
              data-testid="quote-line-item-grid"
            >
              <div className="min-w-0 space-y-2">
                <Label className="text-xs">Catalog Item</Label>
                <Select
                  value={selectedCatalogId}
                  onValueChange={setSelectedCatalogId}
                >
                  <SelectTrigger className="min-w-0" aria-label="Catalog item">
                    <SelectValue placeholder="Select from catalog" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...catalogByCategory.entries()]
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([category, items]) =>
                        items.map((item) => (
                          <SelectItem key={item._id} value={item._id}>
                            <span
                              className="block max-w-[min(70vw,520px)] truncate"
                              data-testid="quote-catalog-option-label"
                            >
                              [{category}] {item.itemName} — $
                              {item.monthlyPrice}/{item.billingUnit}
                            </span>
                          </SelectItem>
                        )),
                      )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Quantity</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                  />
                  <Button
                    type="button"
                    onClick={addLineItem}
                    size="sm"
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Service override %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  disabled={commercialModel === "payg"}
                  value={serviceDiscount}
                  onChange={(event) => setServiceDiscount(event.target.value)}
                  placeholder={
                    commercialModel === "payg" ? "No discount" : "Optional"
                  }
                />
              </div>
            </div>
          </div>

          {/* Line items table */}
          {lineItems.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-left p-2 font-medium">Unit</th>
                    <th className="text-right p-2 font-medium">Qty</th>
                    <th className="text-right p-2 font-medium">Monthly</th>
                    <th className="text-right p-2 font-medium">Yearly</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="p-2">
                        <div className="font-medium">{li.itemName}</div>
                        <div className="text-xs text-muted-foreground">
                          {li.serviceCategory}
                        </div>
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {li.billingUnit}
                      </td>
                      <td className="p-2 text-right">{li.quantity}</td>
                      <td className="p-2 text-right">
                        {formatCurrency(li.monthlyTotal)}
                      </td>
                      <td className="p-2 text-right">
                        {formatCurrency(li.yearlyTotal)}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLineItem(idx)}
                          className="cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20">
                  <tr>
                    <td colSpan={3} className="p-2 font-semibold text-right">
                      Grand Total
                    </td>
                    <td className="p-2 text-right font-bold">
                      {formatCurrency(monthlyGrandTotal)}
                    </td>
                    <td className="p-2 text-right font-bold">
                      {formatCurrency(yearlyGrandTotal)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>
              Notes{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional terms or notes for this quote..."
              rows={3}
            />
          </div>

          {/* Create button */}
          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={lineItems.length === 0}
          >
            Create Quote ({lineItems.length} item
            {lineItems.length !== 1 ? "s" : ""} · $
            {monthlyGrandTotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
            })}
            /mo)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
