import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  Check,
  ChevronsUpDown,
  Download,
  FileSignature,
  FileText,
  Loader2,
  Pencil,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import ConfirmDeleteDialog from "@/components/confirm-delete-dialog.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
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
import { cn } from "@/lib/utils.ts";
import { ContractDialog, type ContractFormState } from "./contract-form.tsx";
import {
  FREQUENCY_LABELS,
  emptyContractForm,
  formFromContract,
  timestampFromDateInput,
} from "./contract-utils.ts";

type ContractLineItem = Doc<"customerContractLineItems">;
type ContractAmendment = Doc<"customerContractAmendments">;
type ServiceCatalogItem = Doc<"serviceCatalog">;
type AmendmentFormState = {
  type: ContractAmendment["type"];
  effectiveDate: string;
  summary: string;
  monthlyDelta: string;
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

const SIGNED_DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png";
const MAX_SIGNED_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_SIGNED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

function contractTotalLabel(
  billingFrequency: ContractFormState["billingFrequency"],
) {
  return `${FREQUENCY_LABELS[billingFrequency]} contract total`;
}

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

function emptyAmendmentForm(): AmendmentFormState {
  return {
    type: "upgrade",
    effectiveDate: monthInputValue(),
    summary: "",
    monthlyDelta: "",
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
    discountType: form.discountType === "none" ? undefined : form.discountType,
    discountValue,
    overageUnitPrice,
    billingUnit: form.billingUnit.trim(),
    notes: optionalText(form.notes),
  };
}

function buildAmendmentPayload(
  form: AmendmentFormState,
  contractId: Id<"customerContracts">,
) {
  if (!form.effectiveDate || !form.summary.trim()) {
    toast.error("Please fill the amendment effective date and summary");
    return null;
  }
  const monthlyDelta = optionalNumber(form.monthlyDelta);
  if (monthlyDelta !== undefined && !Number.isFinite(monthlyDelta)) {
    toast.error("Monthly delta must be a valid number");
    return null;
  }
  return {
    contractId,
    type: form.type,
    effectiveDate: timestampFromDateInput(form.effectiveDate),
    summary: form.summary.trim(),
    monthlyDelta,
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

function formatMonthLabel(month?: string) {
  if (!month) return "-";
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function formatFileSize(size?: number) {
  if (!size) return "-";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function monthInputValue(timestamp?: number) {
  const date = timestamp ? new Date(timestamp) : new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

function formatMoney(value: number | undefined, currency = "USD") {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

function getLineDiscountAmount(line: ContractLineItem, gross: number) {
  if (!line.discountType || line.discountValue === undefined) return 0;
  if (line.discountType === "percentage") {
    return Math.min(gross, gross * (line.discountValue / 100));
  }
  return Math.min(gross, line.discountValue);
}

function getContractLineAmount(line: ContractLineItem) {
  const gross = line.includedQuantity * line.contractUnitPrice;
  return Math.max(0, gross - getLineDiscountAmount(line, gross));
}

function validateSignedDocumentFile(file: File) {
  if (!ALLOWED_SIGNED_DOCUMENT_TYPES.has(file.type)) {
    toast.error("Upload a PDF, JPG, or PNG signed document");
    return false;
  }
  if (file.size > MAX_SIGNED_DOCUMENT_SIZE_BYTES) {
    toast.error("Signed document must be 20 MB or smaller");
    return false;
  }
  return true;
}

function CatalogItemCombobox({
  items,
  value,
  onValueChange,
}: {
  items: ServiceCatalogItem[];
  value: Id<"serviceCatalog"> | undefined;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedItem = items.find((item) => item._id === value);
  const selectedLabel = selectedItem?.itemName ?? "Custom service";
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) =>
        a.itemName.localeCompare(b.itemName, undefined, {
          sensitivity: "base",
        }),
      ),
    [items],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search catalog item..." />
          <CommandList>
            <CommandEmpty>No catalog item found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Custom service"
                onSelect={() => {
                  onValueChange("custom");
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value ? "opacity-0" : "opacity-100",
                  )}
                />
                Custom service
              </CommandItem>
              {sortedItems.map((item) => (
                <CommandItem
                  key={item._id}
                  value={[
                    item.itemName,
                    item.serviceCategory,
                    item.specs,
                    item.billingUnit,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onSelect={() => {
                    onValueChange(item._id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === item._id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{item.itemName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function CustomerContractDetailPage() {
  const navigate = useNavigate();
  const convex = useConvex();
  const { contractId } = useParams();
  const { currentUser } = useCrm();
  const canManage = isAdminRole(currentUser?.role);
  const parsedContractId = contractId as Id<"customerContracts"> | undefined;
  const contract = useQuery(
    api.customerContracts.get,
    parsedContractId ? { contractId: parsedContractId } : "skip",
  );
  const companies = useQuery(api.companies.list, {});
  const lineItems = useQuery(
    api.customerContracts.listLineItems,
    parsedContractId ? { contractId: parsedContractId } : "skip",
  );
  const amendments = useQuery(
    api.customerContracts.listAmendments,
    parsedContractId ? { contractId: parsedContractId } : "skip",
  );
  const invoiceSchedule = useQuery(
    api.customerContracts.invoiceSchedule,
    parsedContractId ? { contractId: parsedContractId } : "skip",
  );
  const serviceCatalog = useQuery(api.serviceCatalog.list, {});
  const createLineItem = useMutation(api.customerContracts.createLineItem);
  const updateLineItem = useMutation(api.customerContracts.updateLineItem);
  const removeLineItem = useMutation(api.customerContracts.removeLineItem);
  const updateContract = useMutation(api.customerContracts.update);
  const removeContract = useMutation(api.customerContracts.remove);
  const terminateContract = useMutation(api.customerContracts.terminate);
  const activateContract = useMutation(api.customerContracts.activate);
  const createAmendment = useMutation(api.customerContracts.createAmendment);
  const generateSignedDocumentUploadUrl = useMutation(
    api.customerContracts.generateSignedDocumentUploadUrl,
  );
  const saveSignedDocument = useMutation(
    api.customerContracts.saveSignedDocument,
  );
  const createDraftInvoice = useMutation(api.invoices.createDraftFromContract);
  const signedDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const [editingLine, setEditingLine] = useState<ContractLineItem | null>(null);
  const [form, setForm] = useState<LineItemFormState>(emptyLineItemForm);
  const [amendmentForm, setAmendmentForm] =
    useState<AmendmentFormState>(emptyAmendmentForm);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [contractForm, setContractForm] =
    useState<ContractFormState>(emptyContractForm);
  const [comparisonMonth, setComparisonMonth] = useState("");
  const [pending, setPending] = useState(false);
  const [contractPending, setContractPending] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
  const [terminatePending, setTerminatePending] = useState(false);
  const [invoicePending, setInvoicePending] = useState(false);
  const [activationPending, setActivationPending] = useState(false);
  const [amendmentPending, setAmendmentPending] = useState(false);
  const [signedDocumentPending, setSignedDocumentPending] = useState<
    "upload" | "download" | null
  >(null);
  const activeComparisonMonth =
    comparisonMonth ||
    invoiceSchedule?.currentMonth ||
    (contract ? monthInputValue(contract.startDate) : "");
  const usageComparison = useQuery(
    api.customerContracts.usageComparison,
    parsedContractId && activeComparisonMonth
      ? {
          contractId: parsedContractId,
          month: activeComparisonMonth,
        }
      : "skip",
  );

  const lineTotal = useMemo(
    () =>
      (lineItems ?? []).reduce(
        (total, line) => total + getContractLineAmount(line),
        0,
      ),
    [lineItems],
  );
  const sortedCompanies = useMemo(
    () => [...(companies ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );
  const contractIsDraft = contract?.status === "draft";
  const contractIsActive = contract?.status === "active";
  const contractIsLocked = !!contract && contract.status !== "draft";
  const canEditOriginal = canManage && contractIsDraft;
  const billableOverage = usageComparison?.totals.overage ?? 0;
  const canCreateInvoice =
    canManage &&
    contractIsActive &&
    (lineItems?.length ?? 0) > 0 &&
    usageComparison !== undefined &&
    billableOverage > 0;

  const resetLineForm = () => {
    setEditingLine(null);
    setForm(emptyLineItemForm());
  };

  const openContractEdit = (loadedContract: NonNullable<typeof contract>) => {
    setContractForm(formFromContract(loadedContract));
    setContractDialogOpen(true);
  };

  const handleContractSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsedContractId || !contractForm.companyId) {
      toast.error("Please select a customer");
      return;
    }
    if (
      !contractForm.contractNumber.trim() ||
      !contractForm.title.trim() ||
      !contractForm.startDate ||
      !contractForm.endDate ||
      !contractForm.currency.trim()
    ) {
      toast.error("Please fill all required contract fields");
      return;
    }
    const paymentTermDays = contractForm.paymentTermDays.trim()
      ? Number(contractForm.paymentTermDays)
      : undefined;
    if (
      paymentTermDays !== undefined &&
      (!Number.isFinite(paymentTermDays) || paymentTermDays < 0)
    ) {
      toast.error("Payment terms must be a valid number of days");
      return;
    }
    setContractPending(true);
    try {
      await updateContract({
        contractId: parsedContractId,
        companyId: contractForm.companyId,
        contractNumber: contractForm.contractNumber.trim(),
        title: contractForm.title.trim(),
        status: contractForm.status,
        startDate: timestampFromDateInput(contractForm.startDate),
        endDate: timestampFromDateInput(contractForm.endDate),
        signedDate: contractForm.signedDate
          ? timestampFromDateInput(contractForm.signedDate)
          : undefined,
        currency: contractForm.currency.trim().toUpperCase(),
        billingFrequency: contractForm.billingFrequency,
        paymentTermDays,
        signedDocumentUrl: optionalText(contractForm.signedDocumentUrl),
        notes: optionalText(contractForm.notes),
      });
      toast.success("Customer contract updated");
      setContractDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update contract",
      );
    } finally {
      setContractPending(false);
    }
  };

  const handleDeleteContract = async () => {
    if (!parsedContractId) return;
    setDeletePending(true);
    try {
      await removeContract({ contractId: parsedContractId });
      toast.success("Draft contract deleted");
      navigate("/finance/customer-contracts");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete contract",
      );
    } finally {
      setDeletePending(false);
    }
  };

  const handleTerminateContract = async () => {
    if (!parsedContractId) return;
    setTerminatePending(true);
    try {
      await terminateContract({ contractId: parsedContractId });
      toast.success("Contract terminated");
      setTerminateDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not terminate contract",
      );
    } finally {
      setTerminatePending(false);
    }
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

  const handleActivateContract = async () => {
    if (!parsedContractId) return;
    setActivationPending(true);
    try {
      await activateContract({ contractId: parsedContractId });
      toast.success("Contract activated and locked");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not activate contract",
      );
    } finally {
      setActivationPending(false);
    }
  };

  const handleAmendmentSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsedContractId) return;
    const payload = buildAmendmentPayload(amendmentForm, parsedContractId);
    if (!payload) return;
    setAmendmentPending(true);
    try {
      await createAmendment(payload);
      toast.success("Contract amendment recorded");
      setAmendmentForm(emptyAmendmentForm());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not record amendment",
      );
    } finally {
      setAmendmentPending(false);
    }
  };

  const handleSignedDocumentUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !parsedContractId) return;
    if (!validateSignedDocumentFile(file)) return;

    setSignedDocumentPending("upload");
    try {
      const uploadUrl = await generateSignedDocumentUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error("Signed document upload failed");
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await saveSignedDocument({
        contractId: parsedContractId,
        storageId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
      toast.success("Signed document attached");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not attach signed document",
      );
    } finally {
      setSignedDocumentPending(null);
    }
  };

  const handleSignedDocumentDownload = async () => {
    if (!parsedContractId) return;
    setSignedDocumentPending("download");
    try {
      const url = await convex.query(
        api.customerContracts.getSignedDocumentDownloadUrl,
        { contractId: parsedContractId },
      );
      if (!url) {
        toast.error("No uploaded signed document found");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not open signed document",
      );
    } finally {
      setSignedDocumentPending(null);
    }
  };

  const handleCreateDraftInvoice = async () => {
    if (!parsedContractId || !activeComparisonMonth) return;
    if (!contractIsActive) {
      toast.error("Activate the contract before creating invoices");
      return;
    }
    if (!lineItems || lineItems.length === 0) {
      toast.error("Add contract services before creating a draft invoice");
      return;
    }
    if (usageComparison !== undefined && billableOverage <= 0) {
      toast.info(
        `No billable contract overage for ${contract.contractNumber} in ${activeComparisonMonth}`,
      );
      return;
    }

    setInvoicePending(true);
    try {
      const invoiceId = await createDraftInvoice({
        contractId: parsedContractId,
        sourceMonth: activeComparisonMonth,
      });
      toast.success("Draft invoice created");
      navigate(`/invoices/${invoiceId}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create draft invoice",
      );
    } finally {
      setInvoicePending(false);
    }
  };

  if (
    contract === undefined ||
    companies === undefined ||
    lineItems === undefined ||
    amendments === undefined ||
    invoiceSchedule === undefined ||
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
        <Button
          variant="ghost"
          onClick={() => navigate("/finance/customer-contracts")}
        >
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
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="text-sm text-muted-foreground">
            Updated {formatDateTime(contract.updatedAt)}
          </div>
          {canManage ? (
            <div className="flex flex-wrap justify-end gap-2">
              {contractIsDraft ? (
                <Button
                  variant="outline"
                  disabled={activationPending || lineItems.length === 0}
                  onClick={() => void handleActivateContract()}
                >
                  {activationPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-4 w-4" />
                  )}
                  Activate & Lock
                </Button>
              ) : null}
              <Button
                disabled={invoicePending || !canCreateInvoice}
                onClick={() => void handleCreateDraftInvoice()}
              >
                {invoicePending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                {contractIsActive &&
                usageComparison !== undefined &&
                billableOverage <= 0
                  ? "No Billable Overage"
                  : "Create Draft Invoice"}
              </Button>
              {contractIsActive ? (
                <Button
                  variant="outline"
                  className="text-red-600 hover:text-red-700"
                  disabled={terminatePending}
                  onClick={() => setTerminateDialogOpen(true)}
                >
                  {terminatePending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Ban className="mr-2 h-4 w-4" />
                  )}
                  Terminate Contract
                </Button>
              ) : null}
              {canEditOriginal ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => openContractEdit(contract)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Contract
                  </Button>
                  <Button
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Contract
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {contractIsLocked ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
          This contract is locked. Record upgrades, downgrades, renewals, or
          price changes as amendments instead of editing the original terms.
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Draft contract setup only. Activate the contract when the signed terms
          are correct; activation locks the original contract and services, then
          enables contract invoicing.
        </div>
      )}

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
          label={contractTotalLabel(contract.billingFrequency)}
          value={formatMoney(lineTotal, contract.currency)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Signed date" value={formatDate(contract.signedDate)} />
        <InfoCard
          label="Payment terms"
          value={
            contract.paymentTermDays === undefined
              ? "-"
              : `${contract.paymentTermDays} days`
          }
        />
        <InfoCard
          label="Signed document"
          value={
            contract.signedDocumentFileName ??
            (contract.signedDocumentUrl ? "Linked" : "Not attached")
          }
        />
        <InfoCard label="Currency" value={contract.currency} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Signed Document</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Attach the approved customer PDF or signed image to this
                contract record.
              </p>
            </div>
            {canManage ? (
              <>
                <input
                  ref={signedDocumentInputRef}
                  type="file"
                  accept={SIGNED_DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(event) => void handleSignedDocumentUpload(event)}
                />
                <Button
                  variant="outline"
                  disabled={signedDocumentPending === "upload"}
                  onClick={() => signedDocumentInputRef.current?.click()}
                >
                  {signedDocumentPending === "upload" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {contract.signedDocumentStorageId ? "Replace" : "Upload"}
                </Button>
              </>
            ) : null}
          </CardHeader>
          <CardContent>
            {contract.signedDocumentStorageId ? (
              <div className="flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium">
                    {contract.signedDocumentFileName ?? "Signed document"}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {formatFileSize(contract.signedDocumentSize)}
                    {contract.signedDocumentUploadedAt
                      ? ` uploaded ${formatDateTime(contract.signedDocumentUploadedAt)}`
                      : ""}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  disabled={signedDocumentPending === "download"}
                  onClick={() => void handleSignedDocumentDownload()}
                >
                  {signedDocumentPending === "download" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download
                </Button>
              </div>
            ) : contract.signedDocumentUrl ? (
              <div className="flex flex-col gap-4 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium">External document link</div>
                  <div className="mt-1 break-all text-sm text-muted-foreground">
                    {contract.signedDocumentUrl}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(
                      contract.signedDocumentUrl,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  <Download className="mr-2 h-4 w-4" />
                  Open
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No signed document uploaded yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Schedule</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Shows the current billing month, last invoice, and next expected
              invoice timing.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <ScheduleItem
                label="Billing frequency"
                value={FREQUENCY_LABELS[invoiceSchedule.billingFrequency]}
              />
              <ScheduleItem
                label="Current month"
                value={formatMonthLabel(invoiceSchedule.currentMonth)}
                badge={
                  invoiceSchedule.currentMonthInvoiced
                    ? "Already invoiced"
                    : "Not invoiced"
                }
              />
              <ScheduleItem
                label="Next invoice month"
                value={formatMonthLabel(invoiceSchedule.nextSourceMonth)}
              />
              <ScheduleItem
                label="Next invoice date"
                value={formatDate(invoiceSchedule.nextInvoiceDate)}
              />
              <ScheduleItem
                label="Next due date"
                value={formatDate(invoiceSchedule.nextDueDate)}
              />
              <ScheduleItem
                label="Last invoice"
                value={
                  invoiceSchedule.lastInvoice
                    ? (invoiceSchedule.lastInvoice.invoiceNumber ??
                      `Draft for ${formatMonthLabel(invoiceSchedule.lastInvoice.sourceMonth)}`)
                    : "-"
                }
              />
            </div>
            {invoiceSchedule.lastInvoice ? (
              <Button
                variant="outline"
                onClick={() =>
                  navigate(`/invoices/${invoiceSchedule.lastInvoice?._id}`)
                }
              >
                <FileText className="mr-2 h-4 w-4" />
                Open Last Invoice
              </Button>
            ) : null}
            {!invoiceSchedule.nextInvoiceCovered ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                The next invoice month is outside this contract period. Renew or
                amend the contract before invoicing that month.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div
        className={
          canEditOriginal
            ? "grid gap-5 xl:grid-cols-[1.15fr_0.85fr]"
            : "grid gap-5"
        }
      >
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
                    Add agreed services, limits, contract prices, discounts, and
                    overage prices.
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
                      {canEditOriginal ? (
                        <th className="px-3 py-3">Actions</th>
                      ) : null}
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
                          {formatMoney(
                            line.catalogUnitPrice,
                            contract.currency,
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {formatMoney(
                            line.contractUnitPrice,
                            contract.currency,
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDiscount(line)}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatMoney(
                            line.overageUnitPrice,
                            contract.currency,
                          )}
                        </td>
                        <td className="px-3 py-3 font-medium">
                          {formatMoney(
                            getContractLineAmount(line),
                            contract.currency,
                          )}
                        </td>
                        {canEditOriginal ? (
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

        {canEditOriginal ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {editingLine ? "Edit Service" : "Add Service"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Field label="Catalog item">
                  <CatalogItemCombobox
                    items={serviceCatalog}
                    value={form.catalogItemId}
                    onValueChange={selectCatalogItem}
                  />
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
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetLineForm}
                    >
                      Clear
                    </Button>
                  ) : null}
                  <Button disabled={pending} type="submit">
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
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contract Amendments</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            {amendments.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No amendments recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-3">Amendment</th>
                      <th className="px-3 py-3">Type</th>
                      <th className="px-3 py-3">Effective</th>
                      <th className="px-3 py-3">Monthly Delta</th>
                      <th className="px-3 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amendments.map((amendment) => (
                      <tr
                        key={amendment._id}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium">
                            {amendment.amendmentNumber}
                          </div>
                          <div className="text-muted-foreground">
                            {amendment.summary}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {formatAmendmentType(amendment.type)}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {formatDate(amendment.effectiveDate)}
                        </td>
                        <td className="px-3 py-3">
                          {formatSignedMoney(
                            amendment.monthlyDelta,
                            contract.currency,
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="secondary">
                            {formatAmendmentStatus(amendment.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <form className="space-y-4" onSubmit={handleAmendmentSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Type">
                <Select
                  value={amendmentForm.type}
                  onValueChange={(value) =>
                    setAmendmentForm({
                      ...amendmentForm,
                      type: value as AmendmentFormState["type"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upgrade">Upgrade</SelectItem>
                    <SelectItem value="downgrade">Downgrade</SelectItem>
                    <SelectItem value="renewal">Renewal</SelectItem>
                    <SelectItem value="commercial_change">
                      Commercial change
                    </SelectItem>
                    <SelectItem value="correction">Correction</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Effective date">
                <Input
                  type="date"
                  value={amendmentForm.effectiveDate}
                  onChange={(event) =>
                    setAmendmentForm({
                      ...amendmentForm,
                      effectiveDate: event.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Summary">
              <Textarea
                value={amendmentForm.summary}
                onChange={(event) =>
                  setAmendmentForm({
                    ...amendmentForm,
                    summary: event.target.value,
                  })
                }
                placeholder="Describe the approved upgrade, downgrade, renewal, or price change"
              />
            </Field>
            <Field label="Monthly delta">
              <Input
                step="any"
                type="number"
                value={amendmentForm.monthlyDelta}
                onChange={(event) =>
                  setAmendmentForm({
                    ...amendmentForm,
                    monthlyDelta: event.target.value,
                  })
                }
                placeholder="Use negative value for downgrade"
              />
            </Field>
            <Button
              disabled={
                !canManage || contract.status === "draft" || amendmentPending
              }
              type="submit"
            >
              {amendmentPending ? "Saving..." : "Record Amendment"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Usage Comparison</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only contract math for this billing month. Overage shown here
              is included when a draft invoice is created.
            </p>
          </div>
          <div className="w-full md:w-48">
            <Label htmlFor="contract-usage-month" className="sr-only">
              Usage month
            </Label>
            <Input
              id="contract-usage-month"
              type="month"
              value={activeComparisonMonth}
              onChange={(event) => setComparisonMonth(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {usageComparison === undefined ? (
            <Skeleton className="h-36 w-full" />
          ) : usageComparison.rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Add contract services first, then this table will compare them to
              monthly usage.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <UsageSummaryCard
                  label="Contract credit"
                  value={formatMoney(
                    usageComparison.totals.contractMinimum,
                    contract.currency,
                  )}
                />
                <UsageSummaryCard
                  label="Overage"
                  value={formatMoney(
                    usageComparison.totals.overage,
                    contract.currency,
                  )}
                />
                <UsageSummaryCard
                  label="Billable extra"
                  value={formatMoney(
                    usageComparison.totals.projected,
                    contract.currency,
                  )}
                />
                <UsageSummaryCard
                  label="Usage entries matched"
                  value={`${usageComparison.totals.matchedEntries}/${usageComparison.totals.totalUsageEntries}`}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-3">Service</th>
                      <th className="px-3 py-3">Credit Qty</th>
                      <th className="px-3 py-3">Actual Qty</th>
                      <th className="px-3 py-3">Source</th>
                      <th className="px-3 py-3">Unit Price</th>
                      <th className="px-3 py-3">Credit Value</th>
                      <th className="px-3 py-3">Usage Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageComparison.rows.map((row) => (
                      <tr
                        key={row.lineItemId}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium">{row.itemName}</div>
                          <div className="text-muted-foreground">
                            {row.serviceCategory}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {formatQuantity(row.includedQuantity)} {row.unit}
                        </td>
                        <td className="px-3 py-3">
                          {formatQuantity(row.actualQuantity)} {row.unit}
                        </td>
                        <td className="px-3 py-3">
                          {row.pricingSource === "unpriced" ? (
                            <Badge variant="destructive">Missing price</Badge>
                          ) : row.pricingSource === "catalog" ? (
                            <Badge variant="outline">Catalog</Badge>
                          ) : (
                            <Badge variant="secondary">Contract</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {formatMoney(
                            row.contractUnitPrice,
                            contract.currency,
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {formatMoney(row.baseAmount, contract.currency)}
                        </td>
                        <td className="px-3 py-3 font-medium">
                          {formatMoney(row.usageAmount, contract.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Usage is valued from daily ManageOne snapshots. Contract lines
                use contract pricing, non-contract usage uses catalog pricing,
                and billable extra is calculated only after total usage exceeds
                the contract credit for the billing period.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

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
                      {event.type} by {formatActorName(event)}
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
      <ConfirmDeleteDialog
        open={terminateDialogOpen}
        onOpenChange={(open) => {
          if (!open && !terminatePending) setTerminateDialogOpen(false);
        }}
        onConfirm={() => void handleTerminateContract()}
        loading={terminatePending}
        title="Terminate active contract?"
        description={`This marks ${contract.contractNumber} as terminated. Existing invoices, services, amendments, and audit history will stay in the CRM.`}
        confirmLabel="Terminate"
      />
      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleteDialogOpen(false);
        }}
        onConfirm={() => void handleDeleteContract()}
        loading={deletePending}
        title="Delete draft contract?"
        description={`This permanently deletes ${contract.contractNumber}. Only draft contracts with no linked invoices can be deleted.`}
      />
      <ContractDialog
        canManage={canManage}
        companies={sortedCompanies}
        editing
        form={contractForm}
        open={contractDialogOpen}
        pending={contractPending}
        setForm={setContractForm}
        setOpen={setContractDialogOpen}
        onSubmit={handleContractSubmit}
      />
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

function UsageSummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ScheduleItem({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{value}</span>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
    </div>
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

function formatActorName(event: { actorEmail?: string; actorName?: string }) {
  return event.actorName?.trim() || event.actorEmail?.trim() || "Unknown user";
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAmendmentType(type: ContractAmendment["type"]) {
  const labels: Record<ContractAmendment["type"], string> = {
    upgrade: "Upgrade",
    downgrade: "Downgrade",
    renewal: "Renewal",
    commercial_change: "Commercial change",
    correction: "Correction",
    other: "Other",
  };
  return labels[type];
}

function formatAmendmentStatus(status: ContractAmendment["status"]) {
  const labels: Record<ContractAmendment["status"], string> = {
    draft: "Draft",
    approved: "Approved",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function formatSignedMoney(value: number | undefined, currency = "USD") {
  if (value === undefined) return "-";
  const formatted = formatMoney(Math.abs(value), currency);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
