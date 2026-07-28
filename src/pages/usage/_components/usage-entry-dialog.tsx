import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
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
import { Badge } from "@/components/ui/badge.tsx";
import { toast } from "sonner";
import { SERVICE_TYPES, getCurrentMonth } from "../_lib/constants.ts";

const ALWAYS_MANUAL_SERVICE_TYPES = ["ECS-CCE", "NAT", "LTS"];

type UsageHint = {
  serviceCategory: string;
  quantity: number;
  pricing: "auto" | "manual";
  suggestedCatalogItemId?: Id<"serviceCatalog">;
};

type UsageEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Doc<"companies">[];
};

export default function UsageEntryDialog({
  open,
  onOpenChange,
  companies,
}: UsageEntryDialogProps) {
  const createConsumption = useMutation(api.consumption.create);
  const catalog = useQuery(api.serviceCatalog.list, {});

  const [companyId, setCompanyId] = useState<string>("");
  const [month, setMonth] = useState(getCurrentMonth());
  const [serviceType, setServiceType] = useState<string>("");
  const [catalogItemId, setCatalogItemId] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [calculatedAmount, setCalculatedAmount] = useState<number | null>(null);
  const [autoFilledFromManageOne, setAutoFilledFromManageOne] = useState(false);
  const usageHintsResult = useQuery(
    api.manageOneTenants.getUsageHintsForCompany,
    companyId ? { companyId: companyId as Id<"companies"> } : "skip",
  );

  const usageHints = usageHintsResult?.hints ?? [];
  const availableServiceTypes = companyId
    ? [
        ...SERVICE_TYPES.filter(
          (service) =>
            usageHints.some((hint) => hint.serviceCategory === service) ||
            ALWAYS_MANUAL_SERVICE_TYPES.includes(service),
        ),
        ...usageHints
          .map((hint) => hint.serviceCategory)
          .filter((service) => !SERVICE_TYPES.includes(service as never)),
      ]
    : SERVICE_TYPES;

  // Get catalog items filtered by the selected service type
  const filteredCatalogItems =
    catalog?.filter((item) => {
      if (!serviceType) {
        return true;
      }
      if (serviceType === "EIP (bandwidth)") {
        return (
          item.serviceCategory === "EIP" &&
          item.itemName.toLowerCase().includes("bandwidth")
        );
      }
      if (serviceType === "EIP") {
        return (
          item.serviceCategory === "EIP" &&
          !item.itemName.toLowerCase().includes("bandwidth")
        );
      }
      return item.serviceCategory === serviceType;
    }) || [];

  // Selected catalog item
  const selectedCatalogItem = catalog?.find(
    (item) => item._id === catalogItemId,
  );

  // Auto-calculate amount when quantity or catalog item changes
  const recalculate = useCallback(() => {
    if (selectedCatalogItem && quantity) {
      const qty = parseFloat(quantity);
      if (!isNaN(qty) && qty > 0) {
        const calculated = qty * selectedCatalogItem.monthlyPrice;
        setCalculatedAmount(calculated);
        if (!isManualOverride) {
          setAmount(calculated.toFixed(2));
        }
      }
    } else {
      setCalculatedAmount(null);
    }
  }, [selectedCatalogItem, quantity, isManualOverride]);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  // Detect manual override when user changes amount
  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (autoFilledFromManageOne) {
      setIsManualOverride(true);
      setAutoFilledFromManageOne(false);
      return;
    }
    setAutoFilledFromManageOne(false);
    if (calculatedAmount !== null) {
      const numVal = parseFloat(value);
      if (!isNaN(numVal) && Math.abs(numVal - calculatedAmount) > 0.001) {
        setIsManualOverride(true);
      } else {
        setIsManualOverride(false);
      }
    }
  };

  // When catalog item changes, reset override state
  const handleCatalogItemChange = (value: string) => {
    setCatalogItemId(value);
    setIsManualOverride(autoFilledFromManageOne);
    setAutoFilledFromManageOne(false);
  };

  const handleCompanyChange = (value: string) => {
    setCompanyId(value);
    setServiceType("");
    setCatalogItemId("");
    setQuantity("");
    setAmount("");
    setIsManualOverride(false);
    setCalculatedAmount(null);
    setAutoFilledFromManageOne(false);
  };

  const handleServiceTypeChange = (value: string) => {
    const hint = usageHints.find((item) => item.serviceCategory === value);

    setServiceType(value);
    setCatalogItemId("");
    setQuantity("");
    setAmount("");
    setIsManualOverride(false);
    setCalculatedAmount(null);
    setAutoFilledFromManageOne(false);

    if (!hint) {
      return;
    }

    setQuantity(String(hint.quantity));
    if (hint.pricing === "auto" && hint.suggestedCatalogItemId) {
      setCatalogItemId(hint.suggestedCatalogItemId);
      setAutoFilledFromManageOne(true);
    }
  };

  const handleSave = async () => {
    if (!companyId) {
      toast.error("Please select a company");
      return;
    }
    if (!month) {
      toast.error("Please enter a month");
      return;
    }
    if (!serviceType) {
      toast.error("Please select a service type");
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    const numQuantity = quantity ? parseFloat(quantity) : undefined;

    try {
      await createConsumption({
        companyId: companyId as Id<"companies">,
        month,
        serviceType,
        amount: numAmount,
        quantity: numQuantity && !isNaN(numQuantity) ? numQuantity : undefined,
        catalogItemId: catalogItemId
          ? (catalogItemId as Id<"serviceCatalog">)
          : undefined,
        isManualOverride: catalogItemId ? isManualOverride : undefined,
      });
      toast.success("Usage entry added");
      // Reset form (keep company and month for batch entry)
      setAmount("");
      setQuantity("");
      setServiceType("");
      setCatalogItemId("");
      setIsManualOverride(false);
      setCalculatedAmount(null);
      setAutoFilledFromManageOne(false);
    } catch {
      toast.error("Failed to add entry");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Usage Entry</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Company *</Label>
            <Select value={companyId} onValueChange={handleCompanyChange}>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Month *</Label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Service Type *</Label>
              <Select
                value={serviceType}
                onValueChange={handleServiceTypeChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent>
                  {availableServiceTypes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Catalog item selector */}
          <div className="space-y-2">
            <Label>
              Catalog Item{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Select
              value={catalogItemId}
              onValueChange={handleCatalogItemChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select catalog item for auto-pricing" />
              </SelectTrigger>
              <SelectContent>
                {filteredCatalogItems.map((item) => (
                  <SelectItem key={item._id} value={item._id}>
                    {item.itemName} — ${item.monthlyPrice}/{item.billingUnit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCatalogItem && (
              <p className="text-xs text-muted-foreground">
                {selectedCatalogItem.serviceCategory} ·{" "}
                {selectedCatalogItem.billingUnit} · $
                {selectedCatalogItem.monthlyPrice}/mo
                {selectedCatalogItem.specs && ` · ${selectedCatalogItem.specs}`}
              </p>
            )}
          </div>

          {/* Quantity + Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>
                Quantity
                {selectedCatalogItem && (
                  <span className="text-muted-foreground text-xs ml-1">
                    ({selectedCatalogItem.billingUnit})
                  </span>
                )}
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setIsManualOverride(autoFilledFromManageOne);
                  setAutoFilledFromManageOne(false);
                }}
                placeholder={
                  selectedCatalogItem
                    ? `# of ${selectedCatalogItem.billingUnit}s`
                    : "0"
                }
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Amount (USD) *</Label>
                {catalogItemId && calculatedAmount !== null && (
                  <Badge
                    variant={
                      isManualOverride
                        ? "destructive"
                        : autoFilledFromManageOne
                          ? "outline"
                          : "secondary"
                    }
                    className="text-[10px] px-1.5 py-0"
                  >
                    {isManualOverride
                      ? "manually adjusted"
                      : autoFilledFromManageOne
                        ? "From ManageOne"
                        : "calculated"}
                  </Badge>
                )}
              </div>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0.00"
              />
              {catalogItemId &&
                calculatedAmount !== null &&
                isManualOverride && (
                  <button
                    type="button"
                    className="text-xs text-primary cursor-pointer hover:underline"
                    onClick={() => {
                      setAmount(calculatedAmount.toFixed(2));
                      setIsManualOverride(false);
                    }}
                  >
                    Reset to calculated (${calculatedAmount.toFixed(2)})
                  </button>
                )}
            </div>
          </div>

          <Button className="w-full" onClick={handleSave}>
            Add Entry
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
