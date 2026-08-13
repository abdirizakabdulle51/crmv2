import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileSignature, Pencil, Plus, Trash2 } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
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

type CustomerContract = Doc<"customerContracts"> & { companyName: string };
type ContractLineItem = Doc<"customerContractLineItems">;
type ServiceCatalogItem = Doc<"serviceCatalog">;
type BillingFrequency =
  | "monthly"
  | "quarterly"
  | "every_3_months"
  | "yearly";
type ContractStatus =
  | "draft"
  | "active"
  | "expired"
  | "terminated"
  | "renewed";

type FormState = {
  companyId?: Id<"companies">;
  contractNumber: string;
  title: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  signedDate: string;
  currency: string;
  billingFrequency: BillingFrequency;
  paymentTermDays: string;
  signedDocumentUrl: string;
  notes: string;
};
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

const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
  renewed: "Renewed",
};

const FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  every_3_months: "Every 3 months",
  yearly: "Yearly",
};

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function dateInputFromTimestamp(timestamp?: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function timestampFromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function emptyForm(): FormState {
  return {
    companyId: undefined,
    contractNumber: "",
    title: "",
    status: "draft",
    startDate: "",
    endDate: "",
    signedDate: "",
    currency: "USD",
    billingFrequency: "monthly",
    paymentTermDays: "30",
    signedDocumentUrl: "",
    notes: "",
  };
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

function formFromContract(contract: CustomerContract): FormState {
  return {
    companyId: contract.companyId,
    contractNumber: contract.contractNumber,
    title: contract.title,
    status: contract.status,
    startDate: dateInputFromTimestamp(contract.startDate),
    endDate: dateInputFromTimestamp(contract.endDate),
    signedDate: dateInputFromTimestamp(contract.signedDate),
    currency: contract.currency,
    billingFrequency: contract.billingFrequency,
    paymentTermDays: contract.paymentTermDays?.toString() ?? "",
    signedDocumentUrl: contract.signedDocumentUrl ?? "",
    notes: contract.notes ?? "",
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

function buildPayload(form: FormState) {
  if (!form.companyId) {
    toast.error("Please select a customer");
    return null;
  }
  if (
    !form.contractNumber.trim() ||
    !form.title.trim() ||
    !form.startDate ||
    !form.endDate ||
    !form.currency.trim()
  ) {
    toast.error("Please fill all required contract fields");
    return null;
  }
  const paymentTermDays = form.paymentTermDays.trim()
    ? Number(form.paymentTermDays)
    : undefined;
  if (
    paymentTermDays !== undefined &&
    (!Number.isFinite(paymentTermDays) || paymentTermDays < 0)
  ) {
    toast.error("Payment terms must be a valid number of days");
    return null;
  }

  return {
    companyId: form.companyId,
    contractNumber: form.contractNumber.trim(),
    title: form.title.trim(),
    status: form.status,
    startDate: timestampFromDateInput(form.startDate),
    endDate: timestampFromDateInput(form.endDate),
    signedDate: form.signedDate
      ? timestampFromDateInput(form.signedDate)
      : undefined,
    currency: form.currency.trim().toUpperCase(),
    billingFrequency: form.billingFrequency,
    paymentTermDays,
    signedDocumentUrl: optionalText(form.signedDocumentUrl),
    notes: optionalText(form.notes),
  };
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

export default function CustomerContractsPage() {
  const { currentUser } = useCrm();
  const canManage = isAdminRole(currentUser?.role);
  const contracts = useQuery(api.customerContracts.list, {});
  const companies = useQuery(api.companies.list, {});
  const serviceCatalog = useQuery(api.serviceCatalog.list, {});
  const createContract = useMutation(api.customerContracts.create);
  const updateContract = useMutation(api.customerContracts.update);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContract, setEditingContract] =
    useState<CustomerContract | null>(null);
  const [lineItemsContract, setLineItemsContract] =
    useState<CustomerContract | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, setPending] = useState(false);

  const sortedCompanies = useMemo(
    () => [...(companies ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const summary = useMemo(() => {
    const rows = contracts ?? [];
    return {
      total: rows.length,
      active: rows.filter((contract) => contract.status === "active").length,
      draft: rows.filter((contract) => contract.status === "draft").length,
      endingSoon: rows.filter((contract) => {
        const daysUntilEnd =
          (contract.endDate - Date.now()) / (1000 * 60 * 60 * 24);
        return daysUntilEnd >= 0 && daysUntilEnd <= 60;
      }).length,
    };
  }, [contracts]);

  const openCreate = () => {
    setEditingContract(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (contract: CustomerContract) => {
    setEditingContract(contract);
    setForm(formFromContract(contract));
    setDialogOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = buildPayload(form);
    if (!payload) return;
    setPending(true);
    try {
      if (editingContract) {
        await updateContract({
          contractId: editingContract._id,
          ...payload,
        });
        toast.success("Customer contract updated");
      } else {
        await createContract(payload);
        toast.success("Customer contract created");
      }
      setDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save contract",
      );
    } finally {
      setPending(false);
    }
  };

  if (
    contracts === undefined ||
    companies === undefined ||
    serviceCatalog === undefined ||
    currentUser === undefined
  ) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Customer Contracts
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage signed customer contract records before contract billing is
            enabled.
          </p>
        </div>
        {canManage ? (
          <Button
            className="bg-cyan-600 text-white hover:bg-cyan-700"
            onClick={openCreate}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Customer contract management is limited to CEO and Head of Business.
          You can view contracts in your customer scope.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Contracts" value={summary.total} />
        <SummaryCard label="Active" value={summary.active} />
        <SummaryCard label="Draft" value={summary.draft} />
        <SummaryCard label="Ending in 60 days" value={summary.endingSoon} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
        </CardHeader>
        <CardContent>
          {contracts.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSignature className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>No customer contracts yet.</EmptyTitle>
                <EmptyDescription>
                  Add signed contract records here. Contract line pricing and
                  invoice generation will be added in later phases.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Contract</th>
                    <th className="px-3 py-3">Customer</th>
                    <th className="px-3 py-3">Dates</th>
                    <th className="px-3 py-3">Billing</th>
                    <th className="px-3 py-3">Currency</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Updated</th>
                    <th className="px-3 py-3">Services</th>
                    {canManage ? <th className="px-3 py-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract) => (
                    <tr key={contract._id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          {contract.contractNumber}
                        </div>
                        <div className="text-muted-foreground">
                          {contract.title}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {contract.companyName}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDate(contract.startDate)} -{" "}
                        {formatDate(contract.endDate)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {FREQUENCY_LABELS[contract.billingFrequency]}
                      </td>
                      <td className="px-3 py-3">{contract.currency}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={contract.status} />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDate(contract.updatedAt)}
                      </td>
                      <td className="px-3 py-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLineItemsContract(contract)}
                        >
                          Services
                        </Button>
                      </td>
                      {canManage ? (
                        <td className="px-3 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(contract)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
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

      <ContractDialog
        canManage={canManage}
        companies={sortedCompanies}
        editingContract={editingContract}
        form={form}
        open={dialogOpen}
        pending={pending}
        setForm={setForm}
        setOpen={setDialogOpen}
        onSubmit={handleSubmit}
      />
      <LineItemsDialog
        canManage={canManage}
        contract={lineItemsContract}
        serviceCatalog={serviceCatalog}
        setContract={setLineItemsContract}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ContractStatus }) {
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
  return <Badge variant="outline">{STATUS_LABELS[status]}</Badge>;
}

function ContractDialog({
  canManage,
  companies,
  editingContract,
  form,
  open,
  pending,
  setForm,
  setOpen,
  onSubmit,
}: {
  canManage: boolean;
  companies: Doc<"companies">[];
  editingContract: CustomerContract | null;
  form: FormState;
  open: boolean;
  pending: boolean;
  setForm: (form: FormState) => void;
  setOpen: (open: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editingContract ? "Edit Contract" : "New Contract"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
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
                onChange={(event) =>
                  setForm({ ...form, contractNumber: event.target.value })
                }
                placeholder="HTG-2026-001"
              />
            </Field>
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder="Managed cloud services contract"
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm({ ...form, status: value as ContractStatus })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start date">
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) =>
                  setForm({ ...form, startDate: event.target.value })
                }
              />
            </Field>
            <Field label="End date">
              <Input
                type="date"
                value={form.endDate}
                onChange={(event) =>
                  setForm({ ...form, endDate: event.target.value })
                }
              />
            </Field>
            <Field label="Signed date">
              <Input
                type="date"
                value={form.signedDate}
                onChange={(event) =>
                  setForm({ ...form, signedDate: event.target.value })
                }
              />
            </Field>
            <Field label="Currency">
              <Input
                value={form.currency}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value })
                }
              />
            </Field>
            <Field label="Billing frequency">
              <Select
                value={form.billingFrequency}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    billingFrequency: value as BillingFrequency,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Payment terms">
              <Input
                min={0}
                type="number"
                value={form.paymentTermDays}
                onChange={(event) =>
                  setForm({ ...form, paymentTermDays: event.target.value })
                }
                placeholder="30"
              />
            </Field>
            <Field label="Signed document link">
              <Input
                value={form.signedDocumentUrl}
                onChange={(event) =>
                  setForm({ ...form, signedDocumentUrl: event.target.value })
                }
                placeholder="https://..."
              />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              placeholder="Internal contract notes"
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={!canManage || pending} type="submit">
              {pending ? "Saving..." : "Save Contract"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LineItemsDialog({
  canManage,
  contract,
  serviceCatalog,
  setContract,
}: {
  canManage: boolean;
  contract: CustomerContract | null;
  serviceCatalog: ServiceCatalogItem[];
  setContract: (contract: CustomerContract | null) => void;
}) {
  const lineItems = useQuery(
    api.customerContracts.listLineItems,
    contract ? { contractId: contract._id } : "skip",
  );
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
    const item = serviceCatalog.find((catalog) => catalog._id === value);
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
    if (!contract) return;
    const payload = buildLinePayload(form, contract._id);
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

  return (
    <Dialog
      open={!!contract}
      onOpenChange={(open) => {
        if (!open) {
          resetLineForm();
          setContract(null);
        }
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            {contract ? `${contract.contractNumber} Services` : "Services"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract Lines</CardTitle>
            </CardHeader>
            <CardContent>
              {lineItems === undefined ? (
                <Skeleton className="h-48" />
              ) : lineItems.length === 0 ? (
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
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-3">Service</th>
                        <th className="px-3 py-3">Included</th>
                        <th className="px-3 py-3">Catalog</th>
                        <th className="px-3 py-3">Contract</th>
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
                            {formatMoney(line.catalogUnitPrice)}
                          </td>
                          <td className="px-3 py-3">
                            {formatMoney(line.contractUnitPrice)}
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">
                            {formatMoney(line.overageUnitPrice)}
                          </td>
                          <td className="px-3 py-3 font-medium">
                            {formatMoney(
                              line.includedQuantity * line.contractUnitPrice,
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
              <div className="mt-4 flex justify-end border-t pt-4 text-sm">
                <span className="mr-3 text-muted-foreground">
                  Contract line total
                </span>
                <span className="font-semibold">{formatMoney(lineTotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editingLine ? "Edit Service" : "Add Service"}
              </CardTitle>
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
                          discountType: value as LineItemFormState["discountType"],
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
                <DialogFooter>
                  {editingLine ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetLineForm}
                    >
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
                </DialogFooter>
              </form>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatMoney(value: number | undefined) {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
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
