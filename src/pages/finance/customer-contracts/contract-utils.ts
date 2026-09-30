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
  semiannual: "Semiannual",
  yearly: "Yearly",
};

export const MODEL_LABELS = {
  flexible_total_commitment: "Overall commitment",
  monthly_minimum: "Monthly minimum commitment",
  discounted_usage: "Discounted usage",
  legacy_service_lines: "Legacy service-line contract",
} as const;

export function contractModel(
  contract: Pick<Doc<"customerContracts">, "pricingModel" | "commitmentModel">,
) {
  if (contract.pricingModel) return contract.pricingModel;
  return contract.commitmentModel === "flexible_value"
    ? ("flexible_total_commitment" as const)
    : ("legacy_service_lines" as const);
}

export function contractModelLabel(
  contract: Pick<Doc<"customerContracts">, "pricingModel" | "commitmentModel">,
) {
  return MODEL_LABELS[contractModel(contract)];
}

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
    billingTiming: "postpaid",
    pricingBasis: "service_lines",
    contractValue: "",
    defaultDiscountType: "none",
    defaultDiscountValue: "",
    overagePricingPolicy: "current_catalog",
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
    billingTiming: contract.billingTiming ?? "postpaid",
    pricingBasis: contract.pricingBasis ?? "service_lines",
    contractValue: contract.contractValue?.toString() ?? "",
    defaultDiscountType: contract.defaultDiscountType ?? "none",
    defaultDiscountValue: contract.defaultDiscountValue?.toString() ?? "",
    overagePricingPolicy: contract.overagePricingPolicy ?? "current_catalog",
    paymentTermDays: contract.paymentTermDays?.toString() ?? "",
    signedDocumentUrl: contract.signedDocumentUrl ?? "",
    notes: contract.notes ?? "",
  };
}
