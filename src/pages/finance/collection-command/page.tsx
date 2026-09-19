import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useCrm } from "@/lib/crm-context.tsx";
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
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  AlertTriangle,
  ArrowRight,
  CircleDollarSign,
  FileText,
  Save,
  Target,
} from "lucide-react";
import { toast } from "sonner";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value: number) {
  return `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function TargetBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function PerformanceCard({
  title,
  icon,
  target,
  actual,
  achievement,
  gap,
  forecast,
  expected,
  currency,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  target: number;
  actual: number;
  achievement: number;
  gap: number;
  forecast: number;
  expected: number;
  currency: string;
  color: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{percent(achievement)}</div>
            <div className="text-xs text-muted-foreground">achieved</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <TargetBar value={achievement} color={color} />
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="font-semibold">{money(target, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Actual</p>
            <p className="font-semibold">{money(actual, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expected</p>
            <p className="font-semibold">{money(expected, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gap today</p>
            <p className="font-semibold text-amber-600">
              {money(gap, currency)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Forecast achievement</span>
          <span className="font-semibold">{percent(forecast)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamTargetRow({
  member,
  existing,
  countryTarget,
  currency,
  month,
}: {
  member: { id: Id<"users">; name: string; isDisabled: boolean };
  existing?: { billingTarget: number; collectionTarget: number };
  countryTarget: { billingTarget: number; collectionTarget: number };
  currency: string;
  month: string;
}) {
  const save = useMutation(api.monthlyPerformance.upsertTeamTarget);
  const [billing, setBilling] = useState(String(existing?.billingTarget ?? 0));
  const [collection, setCollection] = useState(
    String(existing?.collectionTarget ?? 0),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBilling(String(existing?.billingTarget ?? 0));
    setCollection(String(existing?.collectionTarget ?? 0));
  }, [existing?.billingTarget, existing?.collectionTarget, month]);

  async function submit() {
    setSaving(true);
    try {
      await save({
        teamMemberId: member.id,
        month,
        billingTarget: Number(billing),
        collectionTarget: Number(collection),
      });
      toast.success(`${member.name}'s monthly targets saved`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save team targets",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 border-b py-4 last:border-0 md:grid-cols-[1fr_180px_180px_auto] md:items-end">
      <div>
        <p className="font-medium">
          {member.name}
          {member.isDisabled && (
            <Badge variant="outline" className="ml-2">
              Inactive
            </Badge>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Account Manager · {currency}
          {member.isDisabled ? " · Clear targets to zero" : ""}
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Billing target</Label>
        <Input
          type="number"
          min="0"
          max={countryTarget.billingTarget}
          value={billing}
          onChange={(event) => setBilling(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Collection target</Label>
        <Input
          type="number"
          min="0"
          max={countryTarget.collectionTarget}
          value={collection}
          onChange={(event) => setCollection(event.target.value)}
        />
      </div>
      <Button size="sm" onClick={submit} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        Save
      </Button>
    </div>
  );
}

export default function CollectionCommandPage() {
  const { currentUser } = useCrm();
  const [month, setMonth] = useState(currentMonth());
  const [countryId, setCountryId] = useState<string>("");
  const [teamMemberId, setTeamMemberId] = useState<string>("all");
  const dashboard = useQuery(api.monthlyPerformance.dashboard, {
    month,
    countryId: countryId ? (countryId as Id<"countries">) : undefined,
    teamMemberId:
      teamMemberId !== "all" ? (teamMemberId as Id<"users">) : undefined,
  });
  const saveCountryTarget = useMutation(
    api.monthlyPerformance.upsertCountryTarget,
  );
  const [billingTarget, setBillingTarget] = useState("0");
  const [collectionTarget, setCollectionTarget] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [savingCountry, setSavingCountry] = useState(false);
  const leadership =
    currentUser?.role === "ceo" || currentUser?.role === "head_of_business";
  const countryManager = currentUser?.role === "country_gm";
  const dashboardCountryId =
    dashboard && !dashboard.needsCountry ? dashboard.country.id : undefined;
  const dashboardCurrency =
    dashboard && !dashboard.needsCountry ? dashboard.currency : undefined;
  const countryBillingTarget =
    dashboard && !dashboard.needsCountry
      ? dashboard.countryTarget?.billingTarget
      : undefined;
  const countryCollectionTarget =
    dashboard && !dashboard.needsCountry
      ? dashboard.countryTarget?.collectionTarget
      : undefined;

  useEffect(() => {
    if (!dashboardCountryId || !dashboardCurrency) return;
    setBillingTarget(String(countryBillingTarget ?? 0));
    setCollectionTarget(String(countryCollectionTarget ?? 0));
    setCurrency(dashboardCurrency);
  }, [
    countryBillingTarget,
    countryCollectionTarget,
    dashboardCountryId,
    dashboardCurrency,
    month,
  ]);

  async function submitCountryTarget() {
    if (!countryId) return;
    setSavingCountry(true);
    try {
      await saveCountryTarget({
        countryId: countryId as Id<"countries">,
        month,
        currency,
        billingTarget: Number(billingTarget),
        collectionTarget: Number(collectionTarget),
      });
      toast.success("Country monthly targets saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save country targets",
      );
    } finally {
      setSavingCountry(false);
    }
  }

  if (!dashboard || !currentUser) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const countries = dashboard.countries;
  if (dashboard.needsCountry) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Billing & Collection Command Center
          </h1>
          <p className="mt-1 text-muted-foreground">
            Select a country to set monthly targets and review performance.
          </p>
        </div>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Select country</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={countryId} onValueChange={setCountryId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country._id} value={country._id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedTeamTarget = dashboard.selectedTeamMemberId
    ? dashboard.teamTargets.find(
        (target) => target.teamMemberId === dashboard.selectedTeamMemberId,
      )
    : undefined;
  const isPersonal = currentUser.role === "account_manager";
  const allocatedBilling = dashboard.teamTargets.reduce(
    (sum, target) => sum + target.billingTarget,
    0,
  );
  const allocatedCollection = dashboard.teamTargets.reduce(
    (sum, target) => sum + target.collectionTarget,
    0,
  );

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isPersonal
              ? "My Billing & Collection Targets"
              : "Billing & Collection Command Center"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {isPersonal
              ? "Your assigned accounts, monthly targets, and actions in one place."
              : `${dashboard.country.name} · daily billing and collection position`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {leadership && (
            <Select
              value={dashboard.country.id}
              onValueChange={(value) => {
                setCountryId(value);
                setTeamMemberId("all");
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country._id} value={country._id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            aria-label="Target month"
            className="w-40"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          {!isPersonal && (
            <Select value={teamMemberId} onValueChange={setTeamMemberId}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Whole country</SelectItem>
                {dashboard.team.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!dashboard.target && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>
            {dashboard.selectedTeamMemberId
              ? "Your Country GM has not allocated this month's targets yet."
              : "Leadership has not set this country's monthly targets yet."}
          </span>
        </div>
      )}

      {(dashboard.dataQuality.currencyMismatchRecords > 0 ||
        dashboard.dataQuality.unreconciledCollectionAmount > 0) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Some financial records are excluded</p>
            <p className="mt-1 text-xs">
              {dashboard.dataQuality.currencyMismatchRecords > 0 &&
                `${dashboard.dataQuality.currencyMismatchRecords} billing or collection record(s) use a currency other than ${dashboard.currency}. `}
              {dashboard.dataQuality.unreconciledCollectionAmount > 0 &&
                `${money(dashboard.dataQuality.unreconciledCollectionAmount, dashboard.currency)} is marked paid without matching payment or advance records.`}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <PerformanceCard
          title="Billing performance"
          icon={<FileText className="h-5 w-5 text-blue-600" />}
          target={dashboard.target?.billingTarget ?? 0}
          actual={dashboard.summary.billingActual}
          achievement={dashboard.summary.billingAchievement}
          gap={dashboard.summary.billingGap}
          forecast={dashboard.summary.billingForecastAchievement}
          expected={dashboard.summary.expectedBills}
          currency={dashboard.currency}
          color="bg-blue-600"
        />
        <PerformanceCard
          title="Collection performance"
          icon={<CircleDollarSign className="h-5 w-5 text-emerald-600" />}
          target={dashboard.target?.collectionTarget ?? 0}
          actual={dashboard.summary.collectionActual}
          achievement={dashboard.summary.collectionAchievement}
          gap={dashboard.summary.collectionGap}
          forecast={dashboard.summary.collectionForecastAchievement}
          expected={dashboard.summary.expectedCollection}
          currency={dashboard.currency}
          color="bg-emerald-600"
        />
      </div>

      {leadership && !dashboard.selectedTeamMemberId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Set country monthly targets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4 md:items-end">
              <div className="space-y-1">
                <Label>Currency</Label>
                <Input
                  maxLength={3}
                  value={currency}
                  onChange={(event) =>
                    setCurrency(event.target.value.toUpperCase())
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Billing target</Label>
                <Input
                  type="number"
                  min="0"
                  value={billingTarget}
                  onChange={(event) => setBillingTarget(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Collection target</Label>
                <Input
                  type="number"
                  min="0"
                  value={collectionTarget}
                  onChange={(event) => setCollectionTarget(event.target.value)}
                />
              </div>
              <Button onClick={submitCountryTarget} disabled={savingCountry}>
                <Save className="mr-2 h-4 w-4" />
                Save country targets
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {countryManager && dashboard.countryTarget && (
        <Card>
          <CardHeader>
            <CardTitle>Allocate country targets to your team</CardTitle>
            <p className="text-sm text-muted-foreground">
              Country limits:{" "}
              {money(dashboard.countryTarget.billingTarget, dashboard.currency)}{" "}
              billing ·{" "}
              {money(
                dashboard.countryTarget.collectionTarget,
                dashboard.currency,
              )}{" "}
              collection
            </p>
            <p className="text-xs text-muted-foreground">
              Remaining to allocate:{" "}
              {money(
                Math.max(
                  0,
                  dashboard.countryTarget.billingTarget - allocatedBilling,
                ),
                dashboard.currency,
              )}{" "}
              billing ·{" "}
              {money(
                Math.max(
                  0,
                  dashboard.countryTarget.collectionTarget -
                    allocatedCollection,
                ),
                dashboard.currency,
              )}{" "}
              collection
            </p>
          </CardHeader>
          <CardContent>
            {dashboard.team.map((member) => (
              <TeamTargetRow
                key={member.id}
                member={member}
                existing={dashboard.teamTargets.find(
                  (target) => target.teamMemberId === member.id,
                )}
                countryTarget={dashboard.countryTarget!}
                currency={dashboard.currency}
                month={month}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>
                {isPersonal ? "My customer accounts" : "Customer action plan"}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Customers with the highest collectible amounts appear first.
              </p>
            </div>
            {dashboard.summary.atRiskAmount > 0 && (
              <Badge variant="destructive">
                {money(dashboard.summary.atRiskAmount, dashboard.currency)} at
                risk
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3">Customer</th>
                {!isPersonal && <th className="px-4 py-3">Owner</th>}
                <th className="px-4 py-3 text-right">Invoiced</th>
                <th className="px-4 py-3 text-right">Collected</th>
                <th className="px-4 py-3 text-right">Expected bill</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {dashboard.customers.map((customer) => (
                <tr key={customer.companyId} className="border-b last:border-0">
                  <td className="px-6 py-4 font-medium">
                    {customer.companyName}
                    {customer.expectedBill > 0 && (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Forecast:{" "}
                        {customer.forecastBasis === "contract"
                          ? "contract schedule"
                          : customer.forecastBasis === "draft_invoice"
                            ? "draft invoice"
                            : "recent billing history"}
                      </span>
                    )}
                  </td>
                  {!isPersonal && (
                    <td className="px-4 py-4 text-muted-foreground">
                      {customer.accountManagerName}
                    </td>
                  )}
                  <td className="px-4 py-4 text-right">
                    {money(customer.invoiced, dashboard.currency)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {money(customer.collected, dashboard.currency)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {money(customer.expectedBill, dashboard.currency)}
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      variant={
                        customer.status === "at_risk"
                          ? "destructive"
                          : customer.status === "collected"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {customer.status === "at_risk"
                        ? `${customer.overdueInvoices} overdue · At risk`
                        : customer.status === "not_invoiced"
                          ? "Billing expected"
                          : customer.status === "collected"
                            ? "Collected"
                            : "Expected"}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        to={
                          customer.status === "at_risk" &&
                          customer.overdueInvoiceIds[0]
                            ? `/invoices/${customer.overdueInvoiceIds[0]}`
                            : customer.status === "not_invoiced"
                              ? "/billing-queue"
                              : customer.invoiceIds[0]
                                ? `/invoices/${customer.invoiceIds[0]}`
                                : `/companies/${customer.companyId}`
                        }
                      >
                        {customer.status === "at_risk"
                          ? "Review invoices"
                          : customer.status === "not_invoiced"
                            ? "Open billing queue"
                            : "Open"}{" "}
                        <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {dashboard.customers.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No customer accounts are assigned in this scope.
            </div>
          )}
        </CardContent>
      </Card>
      {selectedTeamTarget && (
        <p className="text-xs text-muted-foreground">
          Showing the selected team member's allocated target and assigned
          customer accounts.
        </p>
      )}
    </div>
  );
}
