import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  FileSignature,
  FileText,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
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
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
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
type RenewalState = "expired" | "urgent" | "soon" | "healthy" | "closed";

const DAY_MS = 1000 * 60 * 60 * 24;

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

function currentMonthInputValue() {
  return new Date().toISOString().slice(0, 7);
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function daysUntil(timestamp: number) {
  return Math.ceil((startOfDay(timestamp) - startOfDay(Date.now())) / DAY_MS);
}

function getRenewalState(contract: CustomerContract): RenewalState {
  if (contract.status === "terminated" || contract.status === "renewed") {
    return "closed";
  }
  const daysLeft = daysUntil(contract.endDate);
  if (daysLeft < 0 || contract.status === "expired") return "expired";
  if (daysLeft <= 30) return "urgent";
  if (daysLeft <= 60) return "soon";
  return "healthy";
}

function renewalAction(state: RenewalState) {
  if (state === "expired") return "Review expired contract";
  if (state === "urgent") return "Start renewal now";
  if (state === "soon") return "Schedule renewal follow-up";
  if (state === "closed") return "No renewal action";
  return "On track";
}

function formatDaysRemaining(daysLeft: number) {
  if (daysLeft < 0) {
    return `${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} expired`;
  }
  if (daysLeft === 0) return "Ends today";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
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
  const contractValue = form.contractValue.trim()
    ? Number(form.contractValue)
    : undefined;
  const defaultDiscountValue = form.defaultDiscountValue.trim()
    ? Number(form.defaultDiscountValue)
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
    billingTiming: form.billingTiming,
    pricingBasis: form.pricingBasis,
    contractValue,
    defaultDiscountType:
      form.defaultDiscountType === "none"
        ? undefined
        : form.defaultDiscountType,
    defaultDiscountValue,
    overagePricingPolicy: form.overagePricingPolicy,
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
  const createBatchDrafts = useMutation(api.invoices.createDraftsFromContracts);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContract, setEditingContract] =
    useState<CustomerContract | null>(null);
  const [form, setForm] = useState<ContractFormState>(emptyContractForm);
  const [pending, setPending] = useState(false);
  const [batchMonth, setBatchMonth] = useState(currentMonthInputValue);
  const [batchPending, setBatchPending] = useState(false);
  const batchPreview = useQuery(
    api.invoices.previewContractInvoiceBatch,
    batchMonth ? { sourceMonth: batchMonth } : "skip",
  );

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
      expired: rows.filter(
        (contract) => getRenewalState(contract) === "expired",
      ).length,
      endingSoon: rows.filter((contract) => {
        const daysUntilEnd =
          (contract.endDate - Date.now()) / (1000 * 60 * 60 * 24);
        return daysUntilEnd >= 0 && daysUntilEnd <= 60;
      }).length,
    };
  }, [contracts]);
  const batchSummary = useMemo(() => {
    const rows = batchPreview ?? [];
    return {
      ready: rows.filter((row) => row.status === "ready").length,
      alreadyInvoiced: rows.filter((row) => row.status === "already_invoiced")
        .length,
      otherSkipped: rows.filter(
        (row) => row.status !== "ready" && row.status !== "already_invoiced",
      ).length,
    };
  }, [batchPreview]);
  const renewalRows = useMemo(
    () =>
      [...(contracts ?? [])]
        .map((contract) => {
          const daysLeft = daysUntil(contract.endDate);
          const state = getRenewalState(contract);
          return { contract, daysLeft, state };
        })
        .filter((row) => row.state !== "healthy" && row.state !== "closed")
        .sort((a, b) => a.daysLeft - b.daysLeft),
    [contracts],
  );
  const renewalSummary = useMemo(
    () => ({
      expired: renewalRows.filter((row) => row.state === "expired").length,
      urgent: renewalRows.filter((row) => row.state === "urgent").length,
      soon: renewalRows.filter((row) => row.state === "soon").length,
    }),
    [renewalRows],
  );

  const openCreate = () => {
    navigate("/finance/customer-contracts/new");
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

  const handleBatchCreate = async () => {
    if (!batchMonth) {
      toast.error("Please select an invoice month");
      return;
    }
    setBatchPending(true);
    try {
      const result = await createBatchDrafts({ sourceMonth: batchMonth });
      if (result.created.length === 0) {
        toast.info("No new draft invoices were created");
        return;
      }
      toast.success(
        `Created ${result.created.length} draft invoice${
          result.created.length === 1 ? "" : "s"
        }`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create batch draft invoices",
      );
    } finally {
      setBatchPending(false);
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
        <SummaryCard label="Expired" value={summary.expired} />
        <SummaryCard label="Ending in 60 days" value={summary.endingSoon} />
      </div>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>Renewal Tracking</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Contracts needing renewal follow-up based on their end date.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniStat label="Expired" value={renewalSummary.expired} />
            <MiniStat label="Due in 30 days" value={renewalSummary.urgent} />
            <MiniStat label="Due in 60 days" value={renewalSummary.soon} />
          </div>
        </CardHeader>
        <CardContent>
          {renewalRows.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <CalendarClock className="h-5 w-5" />
              No renewal follow-ups are due in the next 60 days.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Contract</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">End Date</th>
                    <th className="px-3 py-2">Time Left</th>
                    <th className="px-3 py-2">Renewal Status</th>
                    <th className="px-3 py-2">Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {renewalRows.map(({ contract, daysLeft, state }) => (
                    <tr key={contract._id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium hover:text-primary"
                          onClick={() =>
                            navigate(
                              `/finance/customer-contracts/${contract._id}`,
                            )
                          }
                        >
                          {contract.contractNumber}
                        </button>
                        <div className="text-muted-foreground">
                          {contract.title}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {contract.companyName}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(contract.endDate)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDaysRemaining(daysLeft)}
                      </td>
                      <td className="px-3 py-2">
                        <RenewalBadge state={state} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {renewalAction(state)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Batch Monthly Invoicing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[220px_1fr_auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="batch-invoice-month">Invoice month</Label>
                <Input
                  id="batch-invoice-month"
                  type="month"
                  value={batchMonth}
                  onChange={(event) => setBatchMonth(event.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniStat label="Ready" value={batchSummary.ready} />
                <MiniStat
                  label="Already invoiced"
                  value={batchSummary.alreadyInvoiced}
                />
                <MiniStat
                  label="Other skipped"
                  value={batchSummary.otherSkipped}
                />
              </div>
              <Button
                className="bg-cyan-600 text-white hover:bg-cyan-700"
                disabled={
                  batchPending ||
                  batchPreview === undefined ||
                  batchSummary.ready === 0
                }
                onClick={() => void handleBatchCreate()}
              >
                {batchPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Create Drafts
              </Button>
            </div>

            {batchPreview && batchPreview.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">Contract</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Services</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchPreview.map((row) => (
                      <tr
                        key={row.contractId}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">
                            {row.contractNumber}
                          </div>
                          <div className="text-muted-foreground">
                            {row.title}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.companyName}
                        </td>
                        <td className="px-3 py-2">{row.lineItemCount}</td>
                        <td className="px-3 py-2">
                          <BatchStatusBadge status={row.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
                            navigate(
                              `/finance/customer-contracts/${contract._id}`,
                            )
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

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
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

function RenewalBadge({ state }: { state: RenewalState }) {
  if (state === "expired") {
    return (
      <Badge variant="destructive">
        <AlertTriangle className="mr-1 h-3 w-3" />
        Expired
      </Badge>
    );
  }
  if (state === "urgent") {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        Due in 30 days
      </Badge>
    );
  }
  if (state === "soon") {
    return <Badge variant="outline">Due in 60 days</Badge>;
  }
  return <Badge variant="secondary">On track</Badge>;
}

function BatchStatusBadge({
  status,
}: {
  status:
    | "ready"
    | "already_invoiced"
    | "no_services"
    | "not_in_period"
    | "not_due"
    | "inactive";
}) {
  if (status === "ready") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
        Ready
      </Badge>
    );
  }
  if (status === "already_invoiced") {
    return <Badge variant="secondary">Already invoiced</Badge>;
  }
  return <Badge variant="outline">Skipped</Badge>;
}
