import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
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
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type FinanceSettings = {
  countryApprovalLimit: number;
  businessApprovalLimit: number;
  currency: string;
  updatedAt?: number;
};

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "Using default settings";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function FinanceSettingsPage() {
  const { currentUser } = useCrm();
  const settings = useQuery(api.expenses.getFinanceSettings, {});
  const updateSettings = useMutation(api.expenses.updateFinanceSettings);

  const canManage = isAdminRole(currentUser?.role);
  const [countryLimit, setCountryLimit] = useState("100");
  const [businessLimit, setBusinessLimit] = useState("500");
  const [currency, setCurrency] = useState("USD");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setCountryLimit(String(settings.countryApprovalLimit));
    setBusinessLimit(String(settings.businessApprovalLimit));
    setCurrency(settings.currency || "USD");
  }, [settings]);

  if (settings === undefined || currentUser === undefined) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const normalizedSettings = settings as FinanceSettings;
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedCountryLimit = Number(countryLimit);
    const parsedBusinessLimit = Number(businessLimit);
    if (!Number.isFinite(parsedCountryLimit) || parsedCountryLimit < 0) {
      toast.error("Country approval limit must be 0 or greater");
      return;
    }
    if (
      !Number.isFinite(parsedBusinessLimit) ||
      parsedBusinessLimit <= parsedCountryLimit
    ) {
      toast.error(
        "Business approval limit must be greater than country approval limit",
      );
      return;
    }

    setPending(true);
    try {
      await updateSettings({
        countryApprovalLimit: parsedCountryLimit,
        businessApprovalLimit: parsedBusinessLimit,
        currency,
      });
      toast.success("Finance settings saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save finance settings",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Finance Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Configure expense approval thresholds for operational finance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Button asChild variant="outline">
          <a href="/finance/invoice-profiles">Invoice profiles</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/finance/expense-categories">Expense categories</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/finance/accounts">Accounts</a>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ApprovalCard
          title="Country Approval"
          value={`Up to ${formatMoney(
            normalizedSettings.countryApprovalLimit,
            normalizedSettings.currency,
          )}`}
          description="Country GM can approve in-country expenses at this level. HOB and CEO can also approve."
        />
        <ApprovalCard
          title="Business Approval"
          value={`Above ${formatMoney(
            normalizedSettings.countryApprovalLimit,
            normalizedSettings.currency,
          )} up to ${formatMoney(
            normalizedSettings.businessApprovalLimit,
            normalizedSettings.currency,
          )}`}
          description="Requires Head of Business or CEO approval."
        />
        <ApprovalCard
          title="Executive Approval"
          value={`Above ${formatMoney(
            normalizedSettings.businessApprovalLimit,
            normalizedSettings.currency,
          )}`}
          description="Requires Head of Business or CEO approval for now."
        />
      </div>

      {!canManage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Finance settings are managed by CEO and Head of Business. You can view
          the active approval thresholds.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-cyan-600" />
            Approval Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="countryApprovalLimit">
                  Country approval limit
                </Label>
                <Input
                  id="countryApprovalLimit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={countryLimit}
                  onChange={(event) => setCountryLimit(event.target.value)}
                  disabled={!canManage || pending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessApprovalLimit">
                  Business approval limit
                </Label>
                <Input
                  id="businessApprovalLimit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={businessLimit}
                  onChange={(event) => setBusinessLimit(event.target.value)}
                  disabled={!canManage || pending}
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={currency}
                  onValueChange={setCurrency}
                  disabled={!canManage || pending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Last updated: {formatDateTime(normalizedSettings.updatedAt)}
              </p>
              {canManage ? (
                <Button
                  type="submit"
                  className="bg-cyan-600 text-white hover:bg-cyan-700"
                  disabled={pending}
                >
                  {pending ? "Saving..." : "Save Settings"}
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ApprovalCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Badge variant="secondary">Active</Badge>
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
