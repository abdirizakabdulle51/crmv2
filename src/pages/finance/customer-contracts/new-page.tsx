import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { PRODUCT_GROUPS, productGroupLabel } from "@/lib/product-groups.ts";
import { emptyContractForm, timestampFromDateInput } from "./contract-utils.ts";

type SelectedService = {
  catalogItemId: Id<"serviceCatalog">;
  includedQuantity: string;
  overageUnitPrice: string;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function NewCustomerContractPage() {
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {}) ?? [];
  const catalogResult = useQuery(api.serviceCatalog.list, {});
  const catalog = useMemo(() => catalogResult ?? [], [catalogResult]);
  const createContract = useMutation(api.customerContracts.createConfigured);
  const [form, setForm] = useState(emptyContractForm());
  const [groupDiscounts, setGroupDiscounts] = useState<Record<string, string>>({});
  const [serviceDiscounts, setServiceDiscounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SelectedService[]>([]);
  const [catalogGroup, setCatalogGroup] = useState("all");
  const [pending, setPending] = useState(false);

  const classifiedCatalog = useMemo(
    () => catalog.filter((item) => item.productGroup),
    [catalog],
  );
  const availableCatalog = classifiedCatalog.filter(
    (item) =>
      (catalogGroup === "all" || item.productGroup === catalogGroup) &&
      !selected.some((row) => row.catalogItemId === item._id),
  );
  const selectedRows = selected.flatMap((row) => {
    const item = catalog.find((candidate) => candidate._id === row.catalogItemId);
    return item ? [{ ...row, item }] : [];
  });
  const serviceCodes = [...new Set(selectedRows.map(({ item }) => item.serviceCode ?? item.serviceCategory))];
  const totals = selectedRows.reduce(
    (sum, row) => {
      const quantity = Number(row.includedQuantity) || 0;
      const gross = quantity * row.item.monthlyPrice;
      const serviceCode = row.item.serviceCode ?? row.item.serviceCategory;
      const serviceRule = serviceDiscounts[serviceCode];
      const groupRule = groupDiscounts[row.item.productGroup ?? ""];
      const discount = Number(serviceRule === "" || serviceRule === undefined ? groupRule || 0 : serviceRule);
      return { gross: sum.gross + gross, net: sum.net + gross * (1 - discount / 100) };
    },
    { gross: 0, net: 0 },
  );

  const save = async () => {
    if (!form.companyId || !form.contractNumber.trim() || !form.title.trim() || !form.startDate || !form.endDate) {
      toast.error("Complete the customer, agreement number, title, and dates");
      return;
    }
    if (selectedRows.length === 0) {
      toast.error("Select at least one classified catalogue service");
      return;
    }
    if (selectedRows.some((row) => !Number.isFinite(Number(row.includedQuantity)) || Number(row.includedQuantity) <= 0)) {
      toast.error("Every included service must have a quantity greater than zero");
      return;
    }
    if (form.overagePricingPolicy === "custom" && selectedRows.some((row) => !Number.isFinite(Number(row.overageUnitPrice)) || Number(row.overageUnitPrice) < 0)) {
      toast.error("Enter a valid custom overage price for every service");
      return;
    }
    const invalidDiscount = [...Object.values(groupDiscounts), ...Object.values(serviceDiscounts)]
      .filter((value) => value !== "")
      .some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100);
    if (invalidDiscount) {
      toast.error("Discounts must be between 0% and 100%");
      return;
    }
    setPending(true);
    try {
      const contractId = await createContract({
        companyId: form.companyId,
        contractNumber: form.contractNumber.trim(),
        title: form.title.trim(),
        status: "draft",
        startDate: timestampFromDateInput(form.startDate),
        endDate: timestampFromDateInput(form.endDate),
        signedDate: form.signedDate ? timestampFromDateInput(form.signedDate) : undefined,
        currency: "USD",
        billingFrequency: form.billingFrequency,
        billingTiming: form.billingTiming,
        pricingBasis: form.pricingBasis,
        contractValue: form.pricingBasis === "total_contract" ? Number(form.contractValue) : undefined,
        overagePricingPolicy: form.overagePricingPolicy,
        paymentTermDays: form.paymentTermDays ? Number(form.paymentTermDays) : undefined,
        signedDocumentUrl: form.signedDocumentUrl.trim() || undefined,
        notes: form.notes.trim() || undefined,
        groupDiscounts: Object.entries(groupDiscounts)
          .filter(([, value]) => value !== "")
          .map(([productGroup, value]) => ({ productGroup, discountPercent: Number(value) })),
        services: selectedRows.map((row) => {
          const code = row.item.serviceCode ?? row.item.serviceCategory;
          const override = serviceDiscounts[code];
          return {
            catalogItemId: row.item._id,
            includedQuantity: Number(row.includedQuantity),
            serviceDiscountPercent: override === "" || override === undefined ? undefined : Number(override),
            overageUnitPrice: form.overagePricingPolicy === "custom" ? Number(row.overageUnitPrice) : undefined,
          };
        }),
      });
      toast.success("Contract draft created");
      navigate(`/finance/customer-contracts/${contractId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create contract");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6 pb-24 md:p-8">
      <Button variant="ghost" className="px-0" onClick={() => navigate("/finance/customer-contracts")}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Contracts
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Customer Contract</h1>
        <p className="text-muted-foreground">Define the agreement, product-group discounts, service overrides, and included catalogue services.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Agreement and billing</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Customer"><Select value={form.companyId} onValueChange={(value) => setForm({ ...form, companyId: value as Id<"companies"> })}><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company._id} value={company._id}>{company.name}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Contract number"><Input value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} placeholder="HTG-2026-001" /></Field>
              <Field label="Contract title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Currency"><Input value="USD" disabled /></Field>
              <Field label="Start date"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="End date"><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
              <Field label="Billing cycle"><Select value={form.billingFrequency} onValueChange={(value) => setForm({ ...form, billingFrequency: value as typeof form.billingFrequency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="semiannual">Semiannual</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select></Field>
              <Field label="Billing timing"><Select value={form.billingTiming} onValueChange={(value) => setForm({ ...form, billingTiming: value as typeof form.billingTiming })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="prepaid">Prepaid</SelectItem><SelectItem value="postpaid">Postpaid</SelectItem></SelectContent></Select></Field>
              <Field label="Pricing basis"><Select value={form.pricingBasis} onValueChange={(value) => setForm({ ...form, pricingBasis: value as typeof form.pricingBasis })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="service_lines">Service commitment</SelectItem><SelectItem value="total_contract">Total contract value</SelectItem></SelectContent></Select></Field>
              {form.pricingBasis === "total_contract" && <Field label="Signed contract value"><Input type="number" min="0" step="0.01" value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} /></Field>}
              <Field label="Payment terms (days)"><Input type="number" min="0" value={form.paymentTermDays} onChange={(e) => setForm({ ...form, paymentTermDays: e.target.value })} /></Field>
              <Field label="Overage pricing"><Select value={form.overagePricingPolicy} onValueChange={(value) => setForm({ ...form, overagePricingPolicy: value as typeof form.overagePricingPolicy })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current_catalog">Current catalogue</SelectItem><SelectItem value="frozen_catalog">Catalogue at signing</SelectItem><SelectItem value="custom">Custom service price</SelectItem></SelectContent></Select></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>2. Product-group discounts</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUCT_GROUPS.map((group) => <Field key={group.value} label={group.label}><div className="relative"><Input type="number" min="0" max="100" step="0.01" value={groupDiscounts[group.value] ?? ""} onChange={(e) => setGroupDiscounts({ ...groupDiscounts, [group.value]: e.target.value })} placeholder="0" /><span className="absolute right-3 top-2 text-muted-foreground">%</span></div></Field>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>3. Included services</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Select value={catalogGroup} onValueChange={setCatalogGroup}><SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All product groups</SelectItem>{PRODUCT_GROUPS.map((group) => <SelectItem key={group.value} value={group.value}>{group.label}</SelectItem>)}</SelectContent></Select>
              <div className="grid gap-2 md:grid-cols-2">
                {availableCatalog.map((item) => <button type="button" key={item._id} className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50" onClick={() => setSelected([...selected, { catalogItemId: item._id, includedQuantity: "1", overageUnitPrice: String(item.monthlyPrice) }])}><span><span className="block font-medium">{item.itemName}</span><span className="text-xs text-muted-foreground">{productGroupLabel(item.productGroup)} · {item.serviceCode ?? item.serviceCategory} · {money(item.monthlyPrice)}/{item.billingUnit}</span></span><Plus className="h-4 w-4" /></button>)}
              </div>
              {catalog.some((item) => !item.productGroup) && <p className="text-sm text-amber-700">Unclassified catalogue items are hidden. Assign them a product group in Finance Settings before using them in a contract.</p>}
              {selectedRows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Service</th><th className="p-3">Group</th><th className="p-3">Quantity</th><th className="p-3">Catalogue</th>{form.overagePricingPolicy === "custom" && <th className="p-3">Custom overage</th>}<th className="p-3">Applied discount</th><th /></tr></thead><tbody>{selectedRows.map((row) => { const code = row.item.serviceCode ?? row.item.serviceCategory; const override = serviceDiscounts[code]; const inherited = groupDiscounts[row.item.productGroup ?? ""] || "0"; return <tr key={row.item._id} className="border-b"><td className="p-3"><div className="font-medium">{row.item.itemName}</div><div className="text-xs text-muted-foreground">{code}</div></td><td className="p-3">{productGroupLabel(row.item.productGroup)}</td><td className="p-3"><Input className="w-24" type="number" min="0.000001" step="0.000001" value={row.includedQuantity} onChange={(e) => setSelected(selected.map((item) => item.catalogItemId === row.catalogItemId ? { ...item, includedQuantity: e.target.value } : item))} /></td><td className="p-3">{money(row.item.monthlyPrice)}</td>{form.overagePricingPolicy === "custom" && <td className="p-3"><Input className="w-28" type="number" min="0" step="0.01" value={row.overageUnitPrice} onChange={(e) => setSelected(selected.map((item) => item.catalogItemId === row.catalogItemId ? { ...item, overageUnitPrice: e.target.value } : item))} /></td>}<td className="p-3">{override === "" || override === undefined ? `${inherited}% group` : `${override}% service`}</td><td className="p-3"><Button size="icon" variant="ghost" onClick={() => setSelected(selected.filter((item) => item.catalogItemId !== row.catalogItemId))}><Trash2 className="h-4 w-4" /></Button></td></tr>; })}</tbody></table></div>}
            </CardContent>
          </Card>

          {serviceCodes.length > 0 && <Card><CardHeader><CardTitle>4. Service-specific overrides</CardTitle></CardHeader><CardContent className="space-y-3">{serviceCodes.map((code) => <div key={code} className="grid items-center gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_220px]"><div><div className="font-medium">{code}</div><div className="text-sm text-muted-foreground">Leave blank to inherit its product-group discount. Enter 0% to explicitly remove the discount.</div></div><div className="relative"><Input type="number" min="0" max="100" step="0.01" value={serviceDiscounts[code] ?? ""} onChange={(e) => setServiceDiscounts({ ...serviceDiscounts, [code]: e.target.value })} placeholder="Inherit group" /><span className="absolute right-3 top-2 text-muted-foreground">%</span></div></div>)}</CardContent></Card>}

          <Card><CardHeader><CardTitle>5. Notes and document</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Field label="Signed date"><Input type="date" value={form.signedDate} onChange={(e) => setForm({ ...form, signedDate: e.target.value })} /></Field><Field label="Signed document link"><Input value={form.signedDocumentUrl} onChange={(e) => setForm({ ...form, signedDocumentUrl: e.target.value })} /></Field><div className="md:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div></CardContent></Card>
        </div>

        <div><Card className="sticky top-6"><CardHeader><CardTitle>Contract summary</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between"><span>Services</span><strong>{selectedRows.length}</strong></div><div className="flex justify-between"><span>Gross monthly value</span><strong>{money(totals.gross)}</strong></div><div className="flex justify-between"><span>Monthly discounts</span><strong>-{money(totals.gross - totals.net)}</strong></div><div className="flex justify-between border-t pt-3 text-base"><span>Net monthly commitment</span><strong>{money(totals.net)}</strong></div>{form.pricingBasis === "total_contract" && <div className="rounded-md bg-muted p-3"><div className="flex justify-between"><span>Signed value</span><strong>{money(Number(form.contractValue) || 0)}</strong></div><p className="mt-2 text-xs text-muted-foreground">Activation validates the complete term value against service pricing after discounts.</p></div>}<Button className="w-full" disabled={pending} onClick={() => void save()}>{pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Draft Contract</Button></CardContent></Card></div>
      </div>
    </div>
  );
}
