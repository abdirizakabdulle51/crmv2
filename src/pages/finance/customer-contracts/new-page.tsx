import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { PRODUCT_GROUPS, productGroupLabel } from "@/lib/product-groups.ts";
import {
  dateInputFromTimestamp,
  emptyContractForm,
  timestampFromDateInput,
} from "./contract-utils.ts";

type SelectedService = {
  catalogItemId: Id<"serviceCatalog">;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default function NewCustomerContractPage() {
  const navigate = useNavigate();
  const { contractId } = useParams();
  const editingId = contractId as Id<"customerContracts"> | undefined;
  const companies = useQuery(api.companies.list, {}) ?? [];
  const catalogResult = useQuery(api.serviceCatalog.list, {});
  const catalog = useMemo(() => catalogResult ?? [], [catalogResult]);
  const createContract = useMutation(api.customerContracts.createConfigured);
  const updateConfigured = useMutation(api.customerContracts.updateConfigured);
  const existing = useQuery(
    api.customerContracts.get,
    editingId ? { contractId: editingId } : "skip",
  );
  const existingGroups = useQuery(
    api.customerContracts.listGroupDiscounts,
    editingId ? { contractId: editingId } : "skip",
  );
  const existingLines = useQuery(
    api.customerContracts.listLineItems,
    editingId ? { contractId: editingId } : "skip",
  );
  const [form, setForm] = useState<ReturnType<typeof emptyContractForm>>(
    () => ({
      ...emptyContractForm(),
      pricingBasis: "total_contract" as const,
    }),
  );
  const [pricingModel, setPricingModel] = useState<
    "flexible_total_commitment" | "monthly_minimum" | "discounted_usage"
  >("flexible_total_commitment");
  const [monthlyMinimum, setMonthlyMinimum] = useState("");
  const [groupDiscounts, setGroupDiscounts] = useState<Record<string, string>>(
    {},
  );
  const [serviceDiscounts, setServiceDiscounts] = useState<
    Record<string, string>
  >({});
  const [selected, setSelected] = useState<SelectedService[]>([]);
  const [catalogGroup, setCatalogGroup] = useState("all");
  const [serviceSearch, setServiceSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [overridesOpen, setOverridesOpen] = useState(false);

  useEffect(() => {
    if (!editingId || !existing || !existingGroups || !existingLines) return;
    setForm({
      ...emptyContractForm(),
      companyId: existing.companyId,
      contractNumber: existing.contractNumber,
      title: existing.title,
      startDate: dateInputFromTimestamp(existing.startDate),
      endDate: dateInputFromTimestamp(existing.endDate),
      signedDate: dateInputFromTimestamp(existing.signedDate),
      billingFrequency: existing.billingFrequency,
      billingTiming: existing.billingTiming ?? "postpaid",
      contractValue: existing.contractValue?.toString() ?? "",
      paymentTermDays: existing.paymentTermDays?.toString() ?? "",
      signedDocumentUrl: existing.signedDocumentUrl ?? "",
      notes: existing.notes ?? "",
      pricingBasis: existing.pricingBasis ?? "service_lines",
    });
    setPricingModel(
      existing.pricingModel ??
        (existing.commitmentModel === "flexible_value"
          ? "flexible_total_commitment"
          : "discounted_usage"),
    );
    setMonthlyMinimum(existing.monthlyMinimum?.toString() ?? "");
    setGroupDiscounts(
      Object.fromEntries(
        existingGroups.map((row) => [
          row.productGroup,
          row.discountPercent.toString(),
        ]),
      ),
    );
    setSelected(
      existingLines.flatMap((line) =>
        line.catalogItemId ? [{ catalogItemId: line.catalogItemId }] : [],
      ),
    );
    setServiceDiscounts(
      Object.fromEntries(
        existingLines
          .filter((line) => line.discountValue !== undefined)
          .map((line) => [
            line.serviceCode ?? line.serviceCategory,
            line.discountValue!.toString(),
          ]),
      ),
    );
    setOverridesOpen(existingLines.length > 0);
  }, [editingId, existing, existingGroups, existingLines]);

  const classifiedCatalog = useMemo(
    () => catalog.filter((item) => item.productGroup),
    [catalog],
  );
  const availableCatalog = classifiedCatalog.filter(
    (item) =>
      (catalogGroup === "all" || item.productGroup === catalogGroup) &&
      `${item.itemName} ${item.serviceCode ?? item.serviceCategory}`
        .toLowerCase()
        .includes(serviceSearch.trim().toLowerCase()) &&
      !selected.some((row) => row.catalogItemId === item._id),
  );
  const selectedRows = selected.flatMap((row) => {
    const item = catalog.find(
      (candidate) => candidate._id === row.catalogItemId,
    );
    return item ? [{ ...row, item }] : [];
  });
  const serviceCodes = [
    ...new Set(
      selectedRows.map(({ item }) => item.serviceCode ?? item.serviceCategory),
    ),
  ];
  const contractValue = Number(form.contractValue) || 0;

  const save = async () => {
    if (
      !form.companyId ||
      !form.contractNumber.trim() ||
      !form.title.trim() ||
      !form.startDate ||
      !form.endDate
    ) {
      toast.error("Complete the customer, agreement number, title, and dates");
      return;
    }
    if (
      pricingModel === "flexible_total_commitment" &&
      (!Number.isFinite(contractValue) || contractValue <= 0)
    ) {
      toast.error("Contract value must be greater than zero");
      return;
    }
    if (
      pricingModel === "monthly_minimum" &&
      (!Number.isFinite(Number(monthlyMinimum)) || Number(monthlyMinimum) <= 0)
    ) {
      toast.error("Monthly minimum must be greater than zero");
      return;
    }
    const invalidDiscount = [
      ...Object.values(groupDiscounts),
      ...Object.values(serviceDiscounts),
    ]
      .filter((value) => value !== "")
      .some(
        (value) =>
          !Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > 100,
      );
    if (invalidDiscount) {
      toast.error("Discounts must be between 0% and 100%");
      return;
    }
    setPending(true);
    try {
      const payload = {
        companyId: form.companyId,
        contractNumber: form.contractNumber.trim(),
        title: form.title.trim(),
        status: "draft" as const,
        startDate: timestampFromDateInput(form.startDate),
        endDate: timestampFromDateInput(form.endDate),
        signedDate: form.signedDate
          ? timestampFromDateInput(form.signedDate)
          : undefined,
        currency: "USD",
        billingFrequency:
          pricingModel === "flexible_total_commitment"
            ? form.billingFrequency
            : "monthly",
        billingTiming:
          pricingModel === "flexible_total_commitment"
            ? form.billingTiming
            : "postpaid",
        pricingBasis: (pricingModel === "flexible_total_commitment"
          ? "total_contract"
          : "service_lines") as "total_contract" | "service_lines",
        pricingModel,
        commitmentModel:
          pricingModel === "flexible_total_commitment"
            ? ("flexible_value" as const)
            : undefined,
        contractValue:
          pricingModel === "flexible_total_commitment"
            ? contractValue
            : undefined,
        monthlyMinimum:
          pricingModel === "monthly_minimum"
            ? Number(monthlyMinimum)
            : undefined,
        overagePricingPolicy: "current_catalog" as const,
        paymentTermDays: form.paymentTermDays
          ? Number(form.paymentTermDays)
          : undefined,
        signedDocumentUrl: form.signedDocumentUrl.trim() || undefined,
        notes: form.notes.trim() || undefined,
        groupDiscounts: Object.entries(groupDiscounts)
          .filter(([, value]) => value !== "")
          .map(([productGroup, value]) => ({
            productGroup,
            discountPercent: Number(value),
          })),
      };
      const services = selectedRows
        .filter((row) => {
          const code = row.item.serviceCode ?? row.item.serviceCategory;
          return (
            serviceDiscounts[code] !== undefined &&
            serviceDiscounts[code] !== ""
          );
        })
        .map((row) => {
          const code = row.item.serviceCode ?? row.item.serviceCategory;
          const override = serviceDiscounts[code];
          return {
            catalogItemId: row.item._id,
            includedQuantity: 0,
            serviceDiscountPercent:
              override === "" || override === undefined
                ? undefined
                : Number(override),
          };
        });
      if (editingId) {
        await updateConfigured({
          contractId: editingId,
          ...payload,
          services: services.map((service) => ({
            catalogItemId: service.catalogItemId,
            serviceDiscountPercent: service.serviceDiscountPercent!,
          })),
        });
        toast.success("Contract draft updated");
        navigate(`/finance/customer-contracts/${editingId}`);
      } else {
        const createdId = await createContract({ ...payload, services });
        toast.success("Contract draft created");
        navigate(`/finance/customer-contracts/${createdId}`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create contract",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6 pb-24 md:p-8">
      <Button
        variant="ghost"
        className="px-0"
        onClick={() => navigate("/finance/customer-contracts")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Contracts
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {editingId ? "Edit Customer Contract" : "New Customer Contract"}
        </h1>
        <p className="text-muted-foreground">
          Define a shared commitment that the customer can use across any
          catalogue service.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Agreement and billing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Customer">
                <Select
                  value={form.companyId}
                  onValueChange={(value) =>
                    setForm({ ...form, companyId: value as Id<"companies"> })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company._id} value={company._id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Contract number">
                <Input
                  value={form.contractNumber}
                  onChange={(e) =>
                    setForm({ ...form, contractNumber: e.target.value })
                  }
                  placeholder="HTG-2026-001"
                />
              </Field>
              <Field label="Contract title">
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Field>
              <Field label="Currency">
                <Input value="USD" disabled />
              </Field>
              <Field label="Start date">
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </Field>
              <Field label="End date">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                />
              </Field>
              <Field label="How is this customer billed?">
                <Select
                  value={pricingModel}
                  onValueChange={(value) => {
                    const model = value as typeof pricingModel;
                    setPricingModel(model);
                    if (model !== "flexible_total_commitment")
                      setForm({
                        ...form,
                        billingFrequency: "monthly",
                        billingTiming: "postpaid",
                      });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flexible_total_commitment">
                      Total contract commitment
                    </SelectItem>
                    <SelectItem value="monthly_minimum">
                      Monthly minimum payment
                    </SelectItem>
                    <SelectItem value="discounted_usage">
                      Monthly discounted usage
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {pricingModel === "flexible_total_commitment" ? (
                <>
                  <Field label="Billing cycle">
                    <Select
                      value={form.billingFrequency}
                      onValueChange={(value) =>
                        setForm({
                          ...form,
                          billingFrequency:
                            value as typeof form.billingFrequency,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="semiannual">Semiannual</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Billing timing">
                    <Select
                      value={form.billingTiming}
                      onValueChange={(value) =>
                        setForm({
                          ...form,
                          billingTiming: value as typeof form.billingTiming,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prepaid">Prepaid</SelectItem>
                        <SelectItem value="postpaid">Postpaid</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Signed contract value">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.contractValue}
                      onChange={(e) =>
                        setForm({ ...form, contractValue: e.target.value })
                      }
                    />
                  </Field>
                </>
              ) : (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Monthly usage arrangements are billed postpaid after the month
                  closes.
                </div>
              )}
              {pricingModel === "monthly_minimum" && (
                <Field label="Minimum monthly payment">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={monthlyMinimum}
                    onChange={(e) => setMonthlyMinimum(e.target.value)}
                  />
                </Field>
              )}
              <Field label="Payment terms (days)">
                <Input
                  type="number"
                  min="0"
                  value={form.paymentTermDays}
                  onChange={(e) =>
                    setForm({ ...form, paymentTermDays: e.target.value })
                  }
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Product-group discounts</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUCT_GROUPS.map((group) => (
                <Field key={group.value} label={group.label}>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={groupDiscounts[group.value] ?? ""}
                      onChange={(e) =>
                        setGroupDiscounts({
                          ...groupDiscounts,
                          [group.value]: e.target.value,
                        })
                      }
                      placeholder="0"
                    />
                    <span className="absolute right-3 top-2 text-muted-foreground">
                      %
                    </span>
                  </div>
                </Field>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>3. Optional service-specific discounts</CardTitle>
              <Button
                variant="outline"
                onClick={() => setOverridesOpen(!overridesOpen)}
              >
                {overridesOpen ? "Hide" : "Add overrides"}
              </Button>
            </CardHeader>
            {overridesOpen ? (
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  All catalogue services are eligible automatically. Add a
                  service here only when it should override its product-group
                  discount.
                </p>
                <Select value={catalogGroup} onValueChange={setCatalogGroup}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All product groups</SelectItem>
                    {PRODUCT_GROUPS.map((group) => (
                      <SelectItem key={group.value} value={group.value}>
                        {group.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={serviceSearch}
                  onChange={(event) => setServiceSearch(event.target.value)}
                  placeholder="Search service name or code"
                  className="max-w-md"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  {availableCatalog.map((item) => (
                    <button
                      type="button"
                      key={item._id}
                      className="flex items-center justify-between rounded-lg border p-3 text-left hover:bg-muted/50"
                      onClick={() =>
                        setSelected([...selected, { catalogItemId: item._id }])
                      }
                    >
                      <span>
                        <span className="block font-medium">
                          {item.itemName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {productGroupLabel(item.productGroup)} ·{" "}
                          {item.serviceCode ?? item.serviceCategory} ·{" "}
                          {money(item.monthlyPrice)}/{item.billingUnit}
                        </span>
                      </span>
                      <Plus className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                {catalog.some((item) => !item.productGroup) && (
                  <p className="text-sm text-amber-700">
                    Unclassified catalogue items are hidden. Assign them a
                    product group in Finance Settings before using them in a
                    contract.
                  </p>
                )}
                {selectedRows.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="p-3">Service</th>
                          <th className="p-3">Group</th>
                          <th className="p-3">Catalogue</th>
                          <th className="p-3">Applied discount</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRows.map((row) => {
                          const code =
                            row.item.serviceCode ?? row.item.serviceCategory;
                          const override = serviceDiscounts[code];
                          const inherited =
                            groupDiscounts[row.item.productGroup ?? ""] || "0";
                          return (
                            <tr key={row.item._id} className="border-b">
                              <td className="p-3">
                                <div className="font-medium">
                                  {row.item.itemName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {code}
                                </div>
                              </td>
                              <td className="p-3">
                                {productGroupLabel(row.item.productGroup)}
                              </td>
                              <td className="p-3">
                                {money(row.item.monthlyPrice)}
                              </td>
                              <td className="p-3">
                                <div className="relative w-36">
                                  <Input
                                    aria-label={`${code} override`}
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={override ?? ""}
                                    onChange={(event) =>
                                      setServiceDiscounts({
                                        ...serviceDiscounts,
                                        [code]: event.target.value,
                                      })
                                    }
                                    placeholder={`${inherited}% group`}
                                  />
                                  <span className="absolute right-3 top-2 text-muted-foreground">
                                    %
                                  </span>
                                </div>
                              </td>
                              <td className="p-3">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    setSelected(
                                      selected.filter(
                                        (item) =>
                                          item.catalogItemId !==
                                          row.catalogItemId,
                                      ),
                                    )
                                  }
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Notes and document</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Signed date">
                <Input
                  type="date"
                  value={form.signedDate}
                  onChange={(e) =>
                    setForm({ ...form, signedDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Signed document link">
                <Input
                  value={form.signedDocumentUrl}
                  onChange={(e) =>
                    setForm({ ...form, signedDocumentUrl: e.target.value })
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <Textarea
                    value={form.notes}
                    onChange={(e) =>
                      setForm({ ...form, notes: e.target.value })
                    }
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Contract summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Eligible services</span>
                <strong>All catalogue</strong>
              </div>
              <div className="flex justify-between">
                <span>Group discount rules</span>
                <strong>
                  {Object.values(groupDiscounts).filter(Boolean).length}
                </strong>
              </div>
              <div className="flex justify-between">
                <span>Service overrides</span>
                <strong>{serviceCodes.length}</strong>
              </div>
              <div className="flex justify-between border-t pt-3 text-base">
                <span>
                  {pricingModel === "flexible_total_commitment"
                    ? "Total commitment"
                    : pricingModel === "monthly_minimum"
                      ? "Monthly minimum"
                      : "Billing basis"}
                </span>
                <strong>
                  {pricingModel === "flexible_total_commitment"
                    ? money(contractValue)
                    : pricingModel === "monthly_minimum"
                      ? money(Number(monthlyMinimum) || 0)
                      : "Discounted usage"}
                </strong>
              </div>
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">
                  {pricingModel === "flexible_total_commitment"
                    ? "Discounted usage consumes the shared contract balance. Usage beyond it is billed at catalogue price."
                    : pricingModel === "monthly_minimum"
                      ? "The customer pays the higher of discounted monthly usage or the agreed monthly minimum."
                      : "The customer pays actual monthly usage after the agreed discounts. There is no minimum or overage."}
                </p>
              </div>
              <Button
                className="w-full"
                disabled={pending}
                onClick={() => void save()}
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Draft Contract
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
