import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileSignature, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
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
import { Textarea } from "@/components/ui/textarea.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type ContractLineItem = Doc<"customerContractLineItems">;
type ServiceCatalogItem = Doc<"serviceCatalog">;
type LineItemFormState = {
  catalogItemId?: Id<"serviceCatalog">;
  itemName: string;
  serviceCategory: string;
  description: string;
  includedQuantity: string;
  unit: string;
  catalogUnitPrice: string;
  contractUnitPrice: string;
  discountType: "none" | "percentage" | "amount";
  discountValue: string;
  overageUnitPrice: string;
  billingUnit: string;
  notes: string;
};

const FREQUENCY_LABELS = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  every_3_months: "Every 3 months",
  yearly: "Yearly",
} as const;

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function emptyLineItemForm(): LineItemFormState {
  return {
    catalogItemId: undefined,
    itemName: "",
    serviceCategory: "",
    description: "",
    includedQuantity: "1",
    unit: "",
    catalogUnitPrice: "",
    contractUnitPrice: "",
    discountType: "none",
    discountValue: "",
    overageUnitPrice: "",
    billingUnit: "",
    notes: "",
  };
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : undefined;
}

function buildLinePayload(
  form: LineItemFormState,
  contractId: Id<"customerContracts">,
) {
  const includedQuantity = Number(form.includedQuantity);
  const contractUnitPrice = Number(form.contractUnitPrice);
  const catalogUnitPrice = optionalNumber(form.catalogUnitPrice);
  const discountValue = optionalNumber(form.discountValue);
  const overageUnitPrice = optionalNumber(form.overageUnitPrice);

  if (
    !form.itemName.trim() ||
    !form.serviceCategory.trim() ||
    !form.unit.trim() ||
    !form.billingUnit.trim()
  ) {
    toast.error("Please fill all required service line fields");
    return null;
  }
  if (
    !Number.isFinite(includedQuantity) ||
    includedQuantity < 0 ||
    !Number.isFinite(contractUnitPrice) ||
    contractUnitPrice < 0
  ) {
    toast.error("Included quantity and contract price must be valid numbers");
    return null;
  }
  for (const value of [catalogUnitPrice, discountValue, overageUnitPrice]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      toast.error("Optional price and discount values must be valid numbers");
      return null;
    }
  }

  return {
    contractId,
    catalogItemId: form.catalogItemId,
    itemName: form.itemName.trim(),
    serviceCategory: form.serviceCategory.trim(),
    description: optionalText(form.description),
    includedQuantity,
    unit: form.unit.trim(),
    catalogUnitPrice,
    contractUnitPrice,
    discountType:
      form.discountType === "none" ? undefined : form.discountType,
    discountValue,
    overageUnitPrice,
    billingUnit: form.billingUnit.trim(),
    notes: optionalText(form.notes),
  };
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatMoney(value: number | undefined, currency = "USD") {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

export default function CustomerContractDetailPage() {
  const navigate = useNavigate();
  const { contractId } = useParams();
  const { currentUser } = useCrm();
  const canManage = isAdminRole(currentUser?.role);
  const parsedContractId = contractId as Id<"customerContracts"> | undefined;
  const contract = useQuery(
    api.customerContracts.get,
    parsedContractId ? { contractId: parsedContractId } : "skip",
  );
  const lineItems = useQuery(
    api.customerContracts.listLineItems,
    parsedContractId ? { contractId: parsedContractId } : "skip",
  );
  const serviceCatalog = useQuery(api.serviceCatalog.list, {});
  const createLineItem = useMutation(api.customerContracts.createLineItem);
  const updateLineItem = useMutation(api.customerContracts.updateLineItem);
  const removeLineItem = useMutation(api.customerContracts.removeLineItem);
  const [editingLine, setEditingLine] = useState<ContractLineItem | null>(null);
  const [form, setForm] = useState<LineItemFormState>(emptyLineItemForm);
  const [pending, setPending] = useState(false);

  const lineTotal = useMemo(
    () =>
      (lineItems ?? []).reduce(
        (total, line) =>
          total + line.includedQuantity * line.contractUnitPrice,
        0,
      ),
    [lineItems],
  );

  const resetLineForm = () => {
    setEditingLine(null);
    setForm(emptyLineItemForm());
  };

  const selectCatalogItem = (value: string) => {
    if (value === "custom") {
      setForm({
        ...form,
        catalogItemId: undefined,
        catalogUnitPrice: "",
      });
      return;
    }
    const item = serviceCatalog?.find(
      (catalog: ServiceCatalogItem) => catalog._id === value,
    );
    if (!item) return;
    setForm({
      ...form,
      catalogItemId: item._id,
      itemName: item.itemName,
      serviceCategory: item.serviceCategory,
      description: item.specs ?? "",
      unit: item.billingUnit,
      billingUnit: item.billingUnit,
      catalogUnitPrice: item.monthlyPrice.toString(),
      contractUnitPrice: item.monthlyPrice.toString(),
    });
  };

  const editLine = (line: ContractLineItem) => {
    setEditingLine(line);
    setForm({
      catalogItemId: line.catalogItemId,
      itemName: line.itemName,
      serviceCategory: line.serviceCategory,
      description: line.description ?? "",
      includedQuantity: line.includedQuantity.toString(),
      unit: line.unit,
      catalogUnitPrice: line.catalogUnitPrice?.toString() ?? "",
      contractUnitPrice: line.contractUnitPrice.toString(),
      discountType: line.discountType ?? "none",
      discountValue: line.discountValue?.toString() ?? "",
      overageUnitPrice: line.overageUnitPrice?.toString() ?? "",
      billingUnit: line.billingUnit,
      notes: line.notes ?? "",
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsedContractId) return;
    const payload = buildLinePayload(form, parsedContractId);
    if (!payload) return;
    setPending(true);
    try {
      if (editingLine) {
        await updateLineItem({ lineItemId: editingLine._id, ...payload });
        toast.success("Contract service updated");
      } else {
        await createLineItem(payload);
        toast.success("Contract service added");
      }
      resetLineForm();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save contract service",
      );
    } finally {
      setPending(false);
    }
  };

  const handleRemove = async (line: ContractLineItem) => {
    setPending(true);
    try {
      await removeLineItem({ lineItemId: line._id });
      toast.success("Contract service removed");
      if (editingLine?._id === line._id) resetLineForm();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove contract service",
      );
    } finally {
      setPending(false);
    }
  };

  if (
    contract === undefined ||
    lineItems === undefined ||
    serviceCatalog === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="p-6 md:p-8">
        <Button variant="ghost" onClick={() => navigate("/finance/customer-contracts")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Customer Contracts
        </Button>
        <Empty className="mt-12">
          <EmptyHeader>
            <EmptyTitle>Customer contract not found</EmptyTitle>
            <EmptyDescription>
              This contract does not exist or is not available to your role.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button
        variant="ghost"
        className="-ml-2"
        onClick={() => navigate("/finance/customer-contracts")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Customer Contracts
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {contract.contractNumber}
            </h1>
            <StatusBadge status={contract.status} />
          </div>
          <p className="mt-1 text-muted-foreground">{contract.title}</p>
        </div>
        <div className="text-sm text-muted-foreground">
          Updated {formatDateTime(contract.updatedAt)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Customer" value={contract.companyName} />
        <InfoCard
          label="Contract dates"
          value={`${formatDate(contract.startDate)} - ${formatDate(contract.endDate)}`}
        />
        <InfoCard
          label="Billing"
          value={FREQUENCY_LABELS[contract.billingFrequency]}
        />
        <InfoCard
          label="Line total"
          value={formatMoney(lineTotal, contract.currency)}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Contract Services</CardTitle>
          </CardHeader>
          <CardContent>
            {lineItems.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileSignature className="h-6 w-6" />
                  </EmptyMedia>
                  <EmptyTitle>No services added yet.</EmptyTitle>
                  <EmptyDescription>
                    Add agreed services, limits, contract prices, discounts,
                    and overage prices.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-3">Service</th>
                      <th className="px-3 py-3">Included</th>
                      <th className="px-3 py-3">Catalog</th>
                      <th className="px-3 py-3">Contract</th>
                      <th className="px-3 py-3">Discount</th>
                      <th className="px-3 py-3">Overage</th>
                      <th className="px-3 py-3">Amount</th>
                      {canManage ? <th className="px-3 py-3">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((line) => (
                      <tr key={line._id} className="border-b last:border-0">
                        <td className="px-3 py-3">
                          <div className="font-medium">{line.itemName}</div>
                          <div className="text-muted-foreground">
                            {line.serviceCategory}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {line.includedQuantity} {line.unit}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatMoney(line.catalogUnitPrice, contract.currency)}
                        </td>
                        <td className="px-3 py-3">
                          {formatMoney(line.contractUnitPrice, contract.currency)}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDiscount(line)}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatMoney(line.overageUnitPrice, contract.currency)}
                        </td>
                        <td className="px-3 py-3 font-medium">
                          {formatMoney(
                            line.includedQuantity * line.contractUnitPrice,
                            contract.currency,
                          )}
                        </td>
                        {canManage ? (
                          <td className="px-3 py-3">
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => editLine(line)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleRemove(line)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingLine ? "Edit Service" : "Add Service"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Field label="Catalog item">
                <Select
                  value={form.catalogItemId ?? "custom"}
                  onValueChange={selectCatalogItem}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom service</SelectItem>
                    {serviceCatalog.map((item) => (
                      <SelectItem key={item._id} value={item._id}>
                        {item.itemName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Service name">
                  <Input
                    value={form.itemName}
                    onChange={(event) =>
                      setForm({ ...form, itemName: event.target.value })
                    }
                  />
                </Field>
                <Field label="Category">
                  <Input
                    value={form.serviceCategory}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        serviceCategory: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Included quantity">
                  <Input
                    min={0}
                    step="any"
                    type="number"
                    value={form.includedQuantity}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        includedQuantity: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Unit">
                  <Input
                    value={form.unit}
                    onChange={(event) =>
                      setForm({ ...form, unit: event.target.value })
                    }
                  />
                </Field>
                <Field label="Catalog price">
                  <Input
                    min={0}
                    step="any"
                    type="number"
                    value={form.catalogUnitPrice}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        catalogUnitPrice: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Contract price">
                  <Input
                    min={0}
                    step="any"
                    type="number"
                    value={form.contractUnitPrice}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        contractUnitPrice: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Discount type">
                  <Select
                    value={form.discountType}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        discountType:
                          value as LineItemFormState["discountType"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No discount</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="amount">Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Discount value">
                  <Input
                    min={0}
                    step="any"
                    type="number"
                    value={form.discountValue}
                    onChange={(event) =>
                      setForm({ ...form, discountValue: event.target.value })
                    }
                  />
                </Field>
                <Field label="Overage price">
                  <Input
                    min={0}
                    step="any"
                    type="number"
                    value={form.overageUnitPrice}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        overageUnitPrice: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Billing unit">
                  <Input
                    value={form.billingUnit}
                    onChange={(event) =>
                      setForm({ ...form, billingUnit: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Description">
                <Textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                />
              </Field>
              <div className="flex justify-end gap-2">
                {editingLine ? (
                  <Button type="button" variant="outline" onClick={resetLineForm}>
                    Clear
                  </Button>
                ) : null}
                <Button disabled={!canManage || pending} type="submit">
                  {pending
                    ? "Saving..."
                    : editingLine
                      ? "Save Service"
                      : "Add Service"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Audit History</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.events.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No audit events yet.
            </div>
          ) : (
            <div className="space-y-3">
              {contract.events.map((event) => (
                <div
                  key={event._id}
                  className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium">{event.message}</div>
                    <div className="text-sm text-muted-foreground">
                      {event.type}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-base font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
}: {
  status: Doc<"customerContracts">["status"];
}) {
  if (status === "active") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
        Active
      </Badge>
    );
  }
  if (status === "draft") {
    return <Badge variant="secondary">Draft</Badge>;
  }
  if (status === "terminated") {
    return <Badge variant="destructive">Terminated</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function formatDiscount(line: ContractLineItem) {
  if (!line.discountType || line.discountValue === undefined) return "-";
  if (line.discountType === "percentage") return `${line.discountValue}%`;
  return formatMoney(line.discountValue);
}
