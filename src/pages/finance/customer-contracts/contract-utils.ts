import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import type {
  BillingFrequency,
  ContractFormState,
  ContractStatus,
} from "./contract-form.tsx";

export const STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
  renewed: "Renewed",
};

export const FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  every_3_months: "Every 3 months",
  yearly: "Yearly",
};

export function dateInputFromTimestamp(timestamp?: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function timestampFromDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

export function emptyContractForm(): ContractFormState {
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

export function formFromContract(
  contract: Doc<"customerContracts">,
): ContractFormState {
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
