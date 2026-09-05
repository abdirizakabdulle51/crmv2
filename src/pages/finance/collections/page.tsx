import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Building2, Landmark, Loader2, Plus, Search } from "lucide-react";
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
  institutionId: "",
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
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [bankOpen, setBankOpen] = useState(false);
  const [inflowOpen, setInflowOpen] = useState(false);
  const [inflowForm, setInflowForm] = useState({
    accountId: "",
    type: "capital_contribution" as "opening_balance" | "capital_contribution" | "other_non_invoice_inflow",
    amount: "",
    transactionDate: today(),
    transactionId: "",
    source: "",
    description: "",
  });
  const [editInstitutionId, setEditInstitutionId] =
    useState<Id<"financialInstitutions"> | null>(null);
  const [bankForm, setBankForm] = useState({
    countryId: "",
    name: "",
    code: "",
    swiftCode: "",
    type: "bank" as "bank" | "mobile_money",
  });
  const [form, setForm] = useState(emptyForm);
  const operationalAccounts = useQuery(
    api.receivingAccounts.list,
    accountsMode ? "skip" : { purpose: "incoming" },
  );
  const accountPage = usePaginatedQuery(
    api.receivingAccounts.listPage,
    accountsMode
      ? {
          countryId:
            countryFilter === "all"
              ? undefined
              : (countryFilter as Id<"countries">),
          search: search.trim() || undefined,
        }
      : "skip",
    { initialNumItems: 15 },
  );
  const accounts = accountsMode ? accountPage.results : operationalAccounts;
  const countries = useQuery(api.countries.list, {});
  const institutions = useQuery(api.financialInstitutions.list, {
    includeInactive: true,
  });
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
  const createInstitution = useMutation(api.financialInstitutions.create);
  const updateInstitution = useMutation(api.financialInstitutions.update);
  const setInstitutionActive = useMutation(api.financialInstitutions.setActive);
  const migrateLegacy = useMutation(
    api.receivingAccounts.migrateLegacyInstitutions,
  );
  const recordNonInvoiceInflow = useMutation(
    api.receivingAccounts.recordNonInvoiceInflow,
  );
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
          institutionId: form.institutionId
            ? (form.institutionId as Id<"financialInstitutions">)
            : undefined,
          countryId: form.countryId as Id<"countries">,
          name: form.name,
          accountHolderName: form.accountHolderName,
          location: form.location || undefined,
          usage: form.usage,
        });
      } else {
        await createAccount({
          ...form,
          institutionId:
            form.type === "cash"
              ? undefined
              : (form.institutionId as Id<"financialInstitutions">),
          providerName: form.type === "cash" ? "Cash" : undefined,
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

  async function saveInflow(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(inflowForm.amount);
    if (!inflowForm.accountId || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Select an account and enter a positive amount");
      return;
    }
    setPending(true);
    try {
      await recordNonInvoiceInflow({
        accountId: inflowForm.accountId as Id<"receivingAccounts">,
        type: inflowForm.type,
        amount,
        transactionDate: timestamp(inflowForm.transactionDate),
        transactionId: inflowForm.transactionId,
        source: inflowForm.source || undefined,
        description: inflowForm.description,
      });
      toast.success("Account inflow recorded");
      setInflowOpen(false);
      setInflowForm({ accountId: "", type: "capital_contribution", amount: "", transactionDate: today(), transactionId: "", source: "", description: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record inflow");
    } finally {
      setPending(false);
    }
  }

  if (!accounts || !report || !countries || !institutions)
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setInflowOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />Record account inflow
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const result = await migrateLegacy({});
                  toast.success(
                    `Created ${result.created} institutions; linked ${result.linked}; unresolved ${result.unresolved}; conflicts ${result.conflicts}`,
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Migration failed",
                  );
                }
              }}
            >
              Reconcile legacy accounts
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditInstitutionId(null);
                setBankForm({
                  countryId: "",
                  name: "",
                  code: "",
                  swiftCode: "",
                  type: "bank",
                });
                setBankOpen(true);
              }}
            >
              <Building2 className="mr-2 h-4 w-4" />
              Register bank
            </Button>
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
          </div>
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
          <CardContent>
            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                  placeholder="Search account, bank, or number"
                />
              </div>
              <Select
                value={countryFilter}
                onValueChange={(value) => {
                  setCountryFilter(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All countries</SelectItem>
                  {countries.map((country) => (
                    <SelectItem key={country._id} value={country._id}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3">Account</th>
                    <th>Bank / provider</th>
                    <th>Number</th>
                    <th>Country</th>
                    <th>Currency</th>
                    <th>Purpose</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account._id} className="border-b">
                      <td className="p-3 font-medium">{account.name}</td>
                      <td>{account.providerName}</td>
                      <td className="font-mono">
                        ••••{account.accountNumber.slice(-4)}
                      </td>
                      <td>
                        {countries.find(
                          (country) => country._id === account.countryId,
                        )?.name ?? "Missing"}
                      </td>
                      <td>{account.currency}</td>
                      <td className="capitalize">
                        {(account.usage ?? "both").replace(
                          "both",
                          "Collections & expenses",
                        )}
                      </td>
                      <td>{account.isActive ? "Active" : "Inactive"}</td>
                      <td>
                        <div className="flex justify-end gap-2">
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
                                institutionId: account.institutionId ?? "",
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {accountPage.status !== "Exhausted" ? (
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={accountPage.status === "LoadingMore"}
                  onClick={() => accountPage.loadMore(15)}
                >
                  {accountPage.status === "LoadingMore"
                    ? "Loading..."
                    : "Load more"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {accountsMode && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Registered banks and providers</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-3">Institution</th>
                  <th>Country</th>
                  <th>Type</th>
                  <th>Code / SWIFT</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {institutions.map((institution) => (
                  <tr key={institution._id} className="border-b">
                    <td className="p-3 font-medium">{institution.name}</td>
                    <td>
                      {countries.find(
                        (country) => country._id === institution.countryId,
                      )?.name ?? "Missing"}
                    </td>
                    <td className="capitalize">
                      {institution.type.replace("_", " ")}
                    </td>
                    <td>
                      {[institution.code, institution.swiftCode]
                        .filter(Boolean)
                        .join(" · ") || "-"}
                    </td>
                    <td>{institution.isActive ? "Active" : "Inactive"}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditInstitutionId(institution._id);
                            setBankForm({
                              countryId: institution.countryId,
                              name: institution.name,
                              code: institution.code ?? "",
                              swiftCode: institution.swiftCode ?? "",
                              type: institution.type,
                            });
                            setBankOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await setInstitutionActive({
                                institutionId: institution._id,
                                isActive: !institution.isActive,
                              });
                              toast.success(
                                institution.isActive
                                  ? "Institution deactivated"
                                  : "Institution activated",
                              );
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not update institution",
                              );
                            }
                          }}
                        >
                          {institution.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {institutions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-muted-foreground"
                    >
                      Register a bank or provider before adding a non-cash
                      account.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
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
            <div className="mb-4 flex flex-wrap gap-6 text-lg font-bold">
              <span>Account balance: {money(ledger.accountBalance, ledger.account.currency)}</span>
              <span>Period movement: {money(ledger.netMovement, ledger.account.currency)}</span>
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
                onValueChange={(countryId) =>
                  setForm({ ...form, countryId, institutionId: "" })
                }
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
            {form.type !== "cash" ? (
              <div>
                <Label>Registered bank or provider</Label>
                <Select
                  disabled={
                    Boolean(editAccountId && form.institutionId) ||
                    !form.countryId
                  }
                  value={form.institutionId}
                  onValueChange={(institutionId) =>
                    setForm({ ...form, institutionId })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select registered institution" />
                  </SelectTrigger>
                  <SelectContent>
                    {institutions
                      .filter(
                        (item) =>
                          item.countryId === form.countryId &&
                          item.type === form.type &&
                          item.isActive,
                      )
                      .map((item) => (
                        <SelectItem key={item._id} value={item._id}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
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
                    setForm({
                      ...form,
                      type: type as typeof form.type,
                      institutionId: "",
                    })
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
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
              </div>
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

      <Dialog open={inflowOpen} onOpenChange={setInflowOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Non-Invoice Inflow</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={saveInflow}>
            <div><Label>Receiving account</Label><Select value={inflowForm.accountId} onValueChange={(accountId) => setInflowForm({ ...inflowForm, accountId })}><SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger><SelectContent>{accounts.filter((account) => account.isActive && account.usage !== "outgoing").map((account) => <SelectItem key={account._id} value={account._id}>{account.name} · {account.currency}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Transaction type</Label><Select value={inflowForm.type} onValueChange={(type) => setInflowForm({ ...inflowForm, type: type as typeof inflowForm.type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="opening_balance">Opening balance</SelectItem><SelectItem value="capital_contribution">Capital contribution / investment</SelectItem><SelectItem value="other_non_invoice_inflow">Other non-invoice inflow</SelectItem></SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={inflowForm.amount} onChange={(event) => setInflowForm({ ...inflowForm, amount: event.target.value })} required /></div><div><Label>Transaction date</Label><Input type="date" max={today()} value={inflowForm.transactionDate} onChange={(event) => setInflowForm({ ...inflowForm, transactionDate: event.target.value })} required /></div></div>
            <div><Label>Transaction ID</Label><Input value={inflowForm.transactionId} onChange={(event) => setInflowForm({ ...inflowForm, transactionId: event.target.value })} required /></div>
            <div><Label>Source / investor</Label><Input value={inflowForm.source} onChange={(event) => setInflowForm({ ...inflowForm, source: event.target.value })} /></div>
            <div><Label>Description</Label><Input value={inflowForm.description} onChange={(event) => setInflowForm({ ...inflowForm, description: event.target.value })} required /></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setInflowOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Record inflow"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={bankOpen}
        onOpenChange={(open) => {
          setBankOpen(open);
          if (!open) setEditInstitutionId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editInstitutionId
                ? "Edit bank or provider"
                : "Register bank or provider"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              try {
                if (editInstitutionId)
                  await updateInstitution({
                    institutionId: editInstitutionId,
                    name: bankForm.name,
                    code: bankForm.code || undefined,
                    swiftCode: bankForm.swiftCode || undefined,
                  });
                else
                  await createInstitution({
                    countryId: bankForm.countryId as Id<"countries">,
                    name: bankForm.name,
                    code: bankForm.code || undefined,
                    swiftCode: bankForm.swiftCode || undefined,
                    type: bankForm.type,
                  });
                toast.success(
                  editInstitutionId
                    ? "Institution updated"
                    : "Institution registered",
                );
                setBankOpen(false);
                setBankForm({
                  countryId: "",
                  name: "",
                  code: "",
                  swiftCode: "",
                  type: "bank",
                });
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not register institution",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            <div>
              <Label>Country</Label>
              <Select
                disabled={!!editInstitutionId}
                value={bankForm.countryId}
                onValueChange={(countryId) =>
                  setBankForm({ ...bankForm, countryId })
                }
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
              <Label>Type</Label>
              <Select
                disabled={!!editInstitutionId}
                value={bankForm.type}
                onValueChange={(type) =>
                  setBankForm({
                    ...bankForm,
                    type: type as typeof bankForm.type,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="mobile_money">Mobile money</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                required
                value={bankForm.name}
                onChange={(e) =>
                  setBankForm({ ...bankForm, name: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code (optional)</Label>
                <Input
                  value={bankForm.code}
                  onChange={(e) =>
                    setBankForm({ ...bankForm, code: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>SWIFT/BIC (optional)</Label>
                <Input
                  value={bankForm.swiftCode}
                  onChange={(e) =>
                    setBankForm({ ...bankForm, swiftCode: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBankOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  pending || !bankForm.countryId || !bankForm.name.trim()
                }
              >
                {editInstitutionId ? "Save changes" : "Register"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
