import type { FormEvent, ReactNode } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
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
import { FREQUENCY_LABELS, STATUS_LABELS } from "./contract-utils.ts";

export type BillingFrequency =
  | "monthly"
  | "quarterly"
  | "every_3_months"
  | "semiannual"
  | "yearly";
export type ContractStatus =
  | "draft"
  | "active"
  | "expired"
  | "terminated"
  | "renewed";

export type ContractFormState = {
  companyId?: Id<"companies">;
  contractNumber: string;
  title: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  signedDate: string;
  currency: string;
  billingFrequency: BillingFrequency;
  billingTiming: "prepaid" | "postpaid";
  pricingBasis: "service_lines" | "total_contract";
  contractValue: string;
  defaultDiscountType: "none" | "percentage" | "amount";
  defaultDiscountValue: string;
  overagePricingPolicy: "current_catalog" | "frozen_catalog" | "custom";
  paymentTermDays: string;
  signedDocumentUrl: string;
  notes: string;
};

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function ContractDialog({
  canManage,
  companies,
  editing,
  form,
  open,
  pending,
  setForm,
  setOpen,
  onSubmit,
}: {
  canManage: boolean;
  companies: Doc<"companies">[];
  editing: boolean;
  form: ContractFormState;
  open: boolean;
  pending: boolean;
  setForm: (form: ContractFormState) => void;
  setOpen: (open: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit Contract" : "New Contract"}
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
              <Input value={STATUS_LABELS[form.status]} disabled />
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
            <Field label="Billing timing">
              <Select
                value={form.billingTiming}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    billingTiming: value as "prepaid" | "postpaid",
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
            <Field label="Pricing basis">
              <Select
                value={form.pricingBasis}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    pricingBasis: value as "service_lines" | "total_contract",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service_lines">Service lines</SelectItem>
                  <SelectItem value="total_contract">
                    Total contract value
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.pricingBasis === "total_contract" && (
              <Field label="Total contract value">
                <Input
                  min={0}
                  step="0.01"
                  type="number"
                  value={form.contractValue}
                  onChange={(event) =>
                    setForm({ ...form, contractValue: event.target.value })
                  }
                />
              </Field>
            )}
            <Field label="Default service discount">
              <Select
                value={form.defaultDiscountType}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    defaultDiscountType:
                      value as ContractFormState["defaultDiscountType"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No default discount</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="amount">Fixed amount</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.defaultDiscountType !== "none" && (
              <Field label="Default discount value">
                <Input
                  min={0}
                  step="0.01"
                  type="number"
                  value={form.defaultDiscountValue}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      defaultDiscountValue: event.target.value,
                    })
                  }
                />
              </Field>
            )}
            <Field label="Overage pricing">
              <Select
                value={form.overagePricingPolicy}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    overagePricingPolicy:
                      value as ContractFormState["overagePricingPolicy"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current_catalog">
                    Current catalog price
                  </SelectItem>
                  <SelectItem value="frozen_catalog">
                    Catalog price at signing
                  </SelectItem>
                  <SelectItem value="custom">Custom line price</SelectItem>
                </SelectContent>
              </Select>
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
