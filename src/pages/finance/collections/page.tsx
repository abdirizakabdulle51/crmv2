import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Landmark, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
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

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function timestamp(value: string, end = false) {
  return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`).getTime();
}
function money(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount,
  );
}
function date(value: number) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    value,
  );
}

const emptyForm = {
  countryId: "",
  name: "",
  providerName: "",
  accountNumber: "",
  accountHolderName: "HTG CLOUDS LIMITED",
  type: "bank" as "bank" | "mobile_money" | "cash",
  usage: "both" as "incoming" | "outgoing" | "both",
  currency: "USD",
  location: "",
};

export default function CollectionsPage({
  accountsMode = false,
}: {
  accountsMode?: boolean;
}) {
  const { currentUser } = useCrm();
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [accountId, setAccountId] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAccountId, setEditAccountId] =
    useState<Id<"receivingAccounts"> | null>(null);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const accounts = useQuery(api.receivingAccounts.list, {
    includeInactive: accountsMode ? true : undefined,
    purpose: accountsMode ? undefined : "incoming",
  });
  const countries = useQuery(api.countries.list, {});
  const report = useQuery(api.receivingAccounts.collections, {
    startDate: timestamp(startDate),
    endDate: timestamp(endDate, true),
    accountId:
      accountId === "all" ? undefined : (accountId as Id<"receivingAccounts">),
  });
  const ledger = useQuery(
    api.receivingAccounts.ledger,
    accountsMode && accountId !== "all"
      ? {
          accountId: accountId as Id<"receivingAccounts">,
          startDate: timestamp(startDate),
          endDate: timestamp(endDate, true),
        }
      : "skip",
  );
  const createAccount = useMutation(api.receivingAccounts.create);
  const updateAccount = useMutation(api.receivingAccounts.update);
  const setActive = useMutation(api.receivingAccounts.setActive);
  const canManage =
    currentUser?.role === "ceo" || currentUser?.role === "head_of_business";

  async function saveAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!form.countryId) {
      toast.error("Country is required");
      return;
    }
    setPending(true);
    try {
      if (editAccountId) {
        await updateAccount({
          accountId: editAccountId,
          countryId: form.countryId as Id<"countries">,
          name: form.name,
          accountHolderName: form.accountHolderName,
          location: form.location || undefined,
          usage: form.usage,
        });
      } else {
        await createAccount({
          ...form,
          countryId: form.countryId as Id<"countries">,
        });
      }
      toast.success(
        editAccountId ? "Account updated" : "Finance account created",
      );
      setForm(emptyForm);
      setEditAccountId(null);
      setDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create account",
      );
    } finally {
      setPending(false);
    }
  }

  if (!accounts || !report || !countries)
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80" />
      </div>
    );

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {accountsMode ? "Accounts" : "Collections"}
          </h1>
          <p className="text-muted-foreground">
            {accountsMode
              ? "Maintain accounts used for customer collections and expense payments."
              : "Trace every customer payment to its invoice, account, and transaction ID."}
          </p>
        </div>
        {canManage && accountsMode ? (
          <Button
            onClick={() => {
              setEditAccountId(null);
              setForm(emptyForm);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add account
          </Button>
        ) : null}
      </div>

      {!accountsMode ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Collected in period
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {report.totalsByCurrency.length
                  ? report.totalsByCurrency
                      .map((total) => money(total.amount, total.currency))
                      .join(" · ")
                  : money(0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Transactions
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {report.rows.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Receiving accounts
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">
                {accounts.filter((a) => a.isActive).length}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
              <div>
                <Label>From</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label>To</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Account</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account._id} value={account._id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {report.byAccount.map((account) => (
              <Card key={`${account.accountName}-${account.currency}`}>
                <CardContent className="flex items-center gap-3 pt-6">
                  <div className="rounded-lg bg-muted p-2">
                    <Landmark className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">{account.accountName}</div>
                    <div className="text-sm text-muted-foreground">
                      {account.providerName} · {account.payments} payments
                    </div>
                    <div className="mt-1 text-lg font-bold">
                      {money(account.amount, account.currency)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Payment transactions</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-3 pr-4">Date</th>
                    <th className="pr-4">Account</th>
                    <th className="pr-4">Transaction ID</th>
                    <th className="pr-4">Invoice</th>
                    <th className="pr-4">Customer</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row._id} className="border-b last:border-0">
                      <td className="py-3 pr-4">{date(row.paidAt)}</td>
                      <td className="pr-4">
                        <div>{row.accountName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.providerName}
                        </div>
                      </td>
                      <td className="pr-4 font-mono text-xs">
                        {row.transactionId ?? "Missing"}
                      </td>
                      <td className="pr-4">
                        <Link
                          className="text-primary hover:underline"
                          to={`/invoices/${row.invoiceId}`}
                        >
                          {row.invoiceNumber}
                        </Link>
                      </td>
                      <td className="pr-4">{row.companyName}</td>
                      <td className="text-right font-medium">
                        {money(row.amount, row.currency)}
                      </td>
                    </tr>
                  ))}
                  {report.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No collections in this period.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {accountsMode && canManage && accounts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Finance accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account._id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <div className="font-medium">{account.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {account.providerName} · {account.accountNumber} ·{" "}
                    {account.currency} ·{" "}
                    {countries.find(
                      (country) => country._id === account.countryId,
                    )?.name ?? "Country missing"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAccountId(account._id)}
                  >
                    Ledger
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditAccountId(account._id);
                      setForm({
                        countryId: account.countryId ?? "",
                        name: account.name,
                        providerName: account.providerName,
                        accountNumber: account.accountNumber,
                        accountHolderName: account.accountHolderName,
                        type: account.type,
                        usage: account.usage ?? "both",
                        currency: account.currency,
                        location: account.location ?? "",
                      });
                      setDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void setActive({
                        accountId: account._id,
                        isActive: !account.isActive,
                      })
                    }
                  >
                    {account.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {accountsMode ? (
        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
            <div>
              <Label>Ledger from</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div>
              <Label>Ledger to</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div>
              <Label>Account ledger</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select account</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account._id} value={account._id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {accountsMode && ledger ? (
        <Card>
          <CardHeader>
            <CardTitle>{ledger.account.name} ledger</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 text-lg font-bold">
              Net movement: {money(ledger.netMovement, ledger.account.currency)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2">Date</th>
                    <th>Description</th>
                    <th>Reference</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row) => (
                    <tr key={row.key} className="border-b">
                      <td className="py-2">{date(row.date)}</td>
                      <td>{row.description}</td>
                      <td className="font-mono text-xs">{row.reference}</td>
                      <td
                        className={`text-right font-medium ${row.direction === "outgoing" ? "text-destructive" : "text-emerald-600"}`}
                      >
                        {money(row.amount, ledger.account.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editAccountId ? "Edit finance account" : "Add finance account"}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveAccount}>
            <div>
              <Label>Country</Label>
              <Select
                disabled={Boolean(editAccountId && form.countryId)}
                value={form.countryId}
                onValueChange={(countryId) => setForm({ ...form, countryId })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((country) => (
                    <SelectItem key={country._id} value={country._id}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Display name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Salaam Bank USD"
              />
            </div>
            <div>
              <Label>Bank or provider</Label>
              <Input
                disabled={Boolean(editAccountId)}
                value={form.providerName}
                onChange={(e) =>
                  setForm({ ...form, providerName: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Account number</Label>
              <Input
                disabled={Boolean(editAccountId)}
                value={form.accountNumber}
                onChange={(e) =>
                  setForm({ ...form, accountNumber: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Account holder</Label>
              <Input
                value={form.accountHolderName}
                onChange={(e) =>
                  setForm({ ...form, accountHolderName: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select
                  disabled={Boolean(editAccountId)}
                  value={form.type}
                  onValueChange={(type) =>
                    setForm({ ...form, type: type as typeof form.type })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="mobile_money">Mobile money</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Currency</Label>
                <Input
                  disabled={Boolean(editAccountId)}
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value.toUpperCase() })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Use account for</Label>
              <Select
                value={form.usage}
                onValueChange={(usage) =>
                  setForm({ ...form, usage: usage as typeof form.usage })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Collections and expenses</SelectItem>
                  <SelectItem value="incoming">Collections only</SelectItem>
                  <SelectItem value="outgoing">Expenses only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location (optional)</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button disabled={pending}>
                {pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
