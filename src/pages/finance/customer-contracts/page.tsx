import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { FileSignature, Pencil, Plus } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import {
  ContractDialog,
  type ContractFormState,
  type ContractStatus,
} from "./contract-form.tsx";
import {
  FREQUENCY_LABELS,
  STATUS_LABELS,
  emptyContractForm,
  formFromContract,
  timestampFromDateInput,
} from "./contract-utils.ts";

type CustomerContract = Doc<"customerContracts"> & { companyName: string };

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

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function buildPayload(form: ContractFormState) {
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

export default function CustomerContractsPage() {
  const navigate = useNavigate();
  const { currentUser } = useCrm();
  const canManage = isAdminRole(currentUser?.role);
  const contracts = useQuery(api.customerContracts.list, {});
  const companies = useQuery(api.companies.list, {});
  const createContract = useMutation(api.customerContracts.create);
  const updateContract = useMutation(api.customerContracts.update);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContract, setEditingContract] =
    useState<CustomerContract | null>(null);
  const [form, setForm] = useState<ContractFormState>(emptyContractForm);
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
    setForm(emptyContractForm());
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
                          onClick={() =>
                            navigate(`/finance/customer-contracts/${contract._id}`)
                          }
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
        editing={!!editingContract}
        form={form}
        open={dialogOpen}
        pending={pending}
        setForm={setForm}
        setOpen={setDialogOpen}
        onSubmit={handleSubmit}
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
