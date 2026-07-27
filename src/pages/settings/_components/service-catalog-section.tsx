import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Upload, Download, Package } from "lucide-react";
import Papa from "papaparse";

type CatalogItem = Doc<"serviceCatalog">;

export default function ServiceCatalogSection() {
  const catalog = useQuery(api.serviceCatalog.list, {});
  const createItem = useMutation(api.serviceCatalog.create);
  const updateItem = useMutation(api.serviceCatalog.update);
  const removeItem = useMutation(api.serviceCatalog.remove);
  const bulkCreate = useMutation(api.serviceCatalog.bulkCreate);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);

  // Form state
  const [serviceCategory, setServiceCategory] = useState("");
  const [itemName, setItemName] = useState("");
  const [specs, setSpecs] = useState("");
  const [billingUnit, setBillingUnit] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [yearlyPrice, setYearlyPrice] = useState("");
  const [hourlyPrice, setHourlyPrice] = useState("");

  const resetForm = () => {
    setEditingItem(null);
    setServiceCategory("");
    setItemName("");
    setSpecs("");
    setBillingUnit("");
    setMonthlyPrice("");
    setYearlyPrice("");
    setHourlyPrice("");
  };

  const openEdit = (item: CatalogItem) => {
    setEditingItem(item);
    setServiceCategory(item.serviceCategory);
    setItemName(item.itemName);
    setSpecs(item.specs || "");
    setBillingUnit(item.billingUnit);
    setMonthlyPrice(String(item.monthlyPrice));
    setYearlyPrice(item.yearlyPrice != null ? String(item.yearlyPrice) : "");
    setHourlyPrice(item.hourlyPrice != null ? String(item.hourlyPrice) : "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!serviceCategory.trim() || !itemName.trim() || !billingUnit.trim()) {
      toast.error("Category, name, and billing unit are required");
      return;
    }
    const mp = parseFloat(monthlyPrice);
    if (isNaN(mp) || mp < 0) {
      toast.error("Valid monthly price is required");
      return;
    }
    const yp = yearlyPrice.trim() ? parseFloat(yearlyPrice) : undefined;
    const hp = hourlyPrice.trim() ? parseFloat(hourlyPrice) : undefined;

    try {
      const data = {
        serviceCategory: serviceCategory.trim(),
        itemName: itemName.trim(),
        specs: specs.trim() || undefined,
        billingUnit: billingUnit.trim(),
        monthlyPrice: mp,
        yearlyPrice: yp,
        hourlyPrice: hp,
      };
      if (editingItem) {
        await updateItem({ id: editingItem._id, ...data });
        toast.success("Item updated");
      } else {
        await createItem(data);
        toast.success("Item added");
      }
      setDialogOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to save item");
    }
  };

  const handleDelete = async (id: Id<"serviceCatalog">) => {
    try {
      await removeItem({ id });
      toast.success("Item removed");
    } catch {
      toast.error("Failed to remove item");
    }
  };

  // Group by category
  const grouped = new Map<string, CatalogItem[]>();
  for (const item of catalog || []) {
    const arr = grouped.get(item.serviceCategory) || [];
    arr.push(item);
    grouped.set(item.serviceCategory, arr);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle>Service Catalog</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            <Button size="sm" onClick={() => { resetForm(); setDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!catalog || catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No catalog items yet. Add items manually or import via CSV.
            </p>
          ) : (
            <div className="space-y-4">
              {[...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, items]) => (
                <div key={category} className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                    {category}
                  </h4>
                  {items.map((item) => (
                    <div key={item._id} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{item.itemName}</span>
                          <Badge variant="secondary" className="text-xs">{item.billingUnit}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          ${item.monthlyPrice}/mo
                          {item.yearlyPrice != null && ` · $${item.yearlyPrice}/yr`}
                          {item.hourlyPrice != null && ` · $${item.hourlyPrice}/hr`}
                          {item.specs && ` · ${item.specs}`}
                        </div>
                      </div>
                      <div className="flex gap-1 ml-2">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(item._id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Catalog Item" : "Add Catalog Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Service Category *</Label>
                <Input value={serviceCategory} onChange={(e) => setServiceCategory(e.target.value)} placeholder="e.g. Compute" />
              </div>
              <div className="space-y-2">
                <Label>Item Name *</Label>
                <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. ECS s6.large" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Billing Unit *</Label>
                <Input value={billingUnit} onChange={(e) => setBillingUnit(e.target.value)} placeholder="e.g. instance, GB" />
              </div>
              <div className="space-y-2">
                <Label>Specs</Label>
                <Input value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder="e.g. 4vCPU 8GB" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Monthly Price *</Label>
                <Input type="number" min="0" step="0.01" value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Yearly Price</Label>
                <Input type="number" min="0" step="0.01" value={yearlyPrice} onChange={(e) => setYearlyPrice(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Hourly Price</Label>
                <Input type="number" min="0" step="0.01" value={hourlyPrice} onChange={(e) => setHourlyPrice(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <Button className="w-full" onClick={handleSave}>
              {editingItem ? "Update Item" : "Add Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <CatalogImportDialog open={importOpen} onOpenChange={setImportOpen} bulkCreate={bulkCreate} />
    </>
  );
}

type CsvRow = {
  service_category: string;
  item_name: string;
  specs: string;
  billing_unit: string;
  monthly_price: string;
  yearly_price: string;
  hourly_price: string;
};

type ValidatedCatalogRow = {
  serviceCategory: string;
  itemName: string;
  specs: string | undefined;
  billingUnit: string;
  monthlyPrice: number;
  yearlyPrice: number | undefined;
  hourlyPrice: number | undefined;
  errors: string[];
};

function CatalogImportDialog({
  open,
  onOpenChange,
  bulkCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bulkCreate: (args: { items: Array<{ serviceCategory: string; itemName: string; specs?: string; billingUnit: string; monthlyPrice: number; yearlyPrice?: number; hourlyPrice?: number }> }) => Promise<{ inserted: number }>;
}) {
  const [rows, setRows] = useState<ValidatedCatalogRow[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const validated = result.data.map(validateRow);
        setRows(validated);
      },
      error: () => toast.error("Failed to parse CSV"),
    });
  };

  const validateRow = (row: CsvRow): ValidatedCatalogRow => {
    const errors: string[] = [];
    const cat = (row.service_category || "").trim();
    const name = (row.item_name || "").trim();
    const unit = (row.billing_unit || "").trim();
    if (!cat) errors.push("Missing category");
    if (!name) errors.push("Missing item name");
    if (!unit) errors.push("Missing billing unit");

    const mp = parseFloat((row.monthly_price || "").replace(/[$,]/g, ""));
    if (isNaN(mp) || mp < 0) errors.push("Invalid monthly price");

    const ypRaw = (row.yearly_price || "").replace(/[$,]/g, "").trim();
    const yp = ypRaw ? parseFloat(ypRaw) : undefined;
    if (ypRaw && (isNaN(yp!) || yp! < 0)) errors.push("Invalid yearly price");

    const hpRaw = (row.hourly_price || "").replace(/[$,]/g, "").trim();
    const hp = hpRaw ? parseFloat(hpRaw) : undefined;
    if (hpRaw && (isNaN(hp!) || hp! < 0)) errors.push("Invalid hourly price");

    return {
      serviceCategory: cat,
      itemName: name,
      specs: (row.specs || "").trim() || undefined,
      billingUnit: unit,
      monthlyPrice: isNaN(mp) ? 0 : mp,
      yearlyPrice: yp,
      hourlyPrice: hp,
      errors,
    };
  };

  const validRows = rows.filter((r) => r.errors.length === 0);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      await bulkCreate({
        items: validRows.map((r) => ({
          serviceCategory: r.serviceCategory,
          itemName: r.itemName,
          specs: r.specs,
          billingUnit: r.billingUnit,
          monthlyPrice: r.monthlyPrice,
          yearlyPrice: r.yearlyPrice,
          hourlyPrice: r.hourlyPrice,
        })),
      });
      toast.success(`Imported ${validRows.length} catalog items`);
      setRows([]);
      onOpenChange(false);
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = Papa.unparse({
      fields: ["service_category", "item_name", "specs", "billing_unit", "monthly_price", "yearly_price", "hourly_price"],
      data: [
        ["Compute", "ECS s6.large", "4vCPU 8GB", "instance", "120.00", "1200.00", "0.17"],
        ["Storage", "OBS Standard", "Object storage", "GB", "0.012", "", ""],
      ],
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "service_catalog_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Service Catalog (CSV)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />
              Download Template
            </Button>
            <p className="text-xs text-muted-foreground">
              Columns: service_category, item_name, specs, billing_unit, monthly_price, yearly_price, hourly_price
            </p>
          </div>

          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-2">Choose a CSV file</p>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              Select File
            </Button>
          </div>

          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex gap-2 text-xs">
                <span className="text-emerald-600">{validRows.length} valid</span>
                {rows.length - validRows.length > 0 && (
                  <span className="text-destructive">{rows.length - validRows.length} errors</span>
                )}
              </div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Category</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Unit</th>
                      <th className="text-right p-2">Monthly</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 30).map((row, i) => (
                      <tr key={i} className={row.errors.length > 0 ? "bg-red-50 dark:bg-red-900/10" : ""}>
                        <td className="p-2">{row.serviceCategory}</td>
                        <td className="p-2">{row.itemName}</td>
                        <td className="p-2">{row.billingUnit}</td>
                        <td className="p-2 text-right">${row.monthlyPrice}</td>
                        <td className="p-2">
                          {row.errors.length > 0 ? (
                            <span className="text-destructive">{row.errors.join("; ")}</span>
                          ) : <span className="text-emerald-600">OK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button className="w-full" disabled={validRows.length === 0 || importing} onClick={handleImport}>
                {importing ? "Importing..." : `Import ${validRows.length} Items`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
