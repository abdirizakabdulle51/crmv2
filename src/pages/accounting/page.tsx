import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
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
import { Badge } from "@/components/ui/badge.tsx";
import { toast } from "sonner";

export type AccountingView =
  | "overview"
  | "chart"
  | "journals"
  | "ledger"
  | "trial-balance"
  | "balance-sheet"
  | "income-statement"
  | "corrections"
  | "migration"
  | "advances"
  | "periods";

const titles: Record<AccountingView, { title: string; description: string }> = {
  overview: {
    title: "Accounting Overview",
    description: "Double-entry balances and accounting controls.",
  },
  chart: {
    title: "Chart of Accounts",
    description: "Country-specific control and posting accounts.",
  },
  journals: {
    title: "Journal Entries",
    description: "Immutable source-linked accounting entries.",
  },
  ledger: {
    title: "General Ledger",
    description: "Chronological movements for one ledger account.",
  },
  "trial-balance": {
    title: "Trial Balance",
    description: "Debit and credit balances as of the selected date.",
  },
  "balance-sheet": {
    title: "Balance Sheet",
    description: "Assets, liabilities, equity, and current earnings.",
  },
  "income-statement": {
    title: "Income Statement",
    description: "Accounting income and expenses for the period.",
  },
  corrections: {
    title: "Historical Corrections",
    description: "Post auditable corrections without changing source records.",
  },
  migration: {
    title: "Historical Migration",
    description: "Post existing finance records in safe, resumable batches.",
  },
  advances: {
    title: "Customer Advances",
    description: "Cash received but not yet allocated to invoices.",
  },
  periods: {
    title: "Accounting Periods",
    description: "Control posting access by accounting month.",
  },
};

const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
const dateInput = (date: Date) => date.toISOString().slice(0, 10);
const timestamp = (date: string, end = false) =>
  Date.parse(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);

function ReportTable({
  rows,
  currency,
}: {
  rows: Array<{ _id: string; code: string; name: string; amountCents: number }>;
  currency: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="p-3 text-left">Code</th>
            <th className="p-3 text-left">Account</th>
            <th className="p-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr key={row._id} className="border-b last:border-0">
                <td className="p-3 font-mono">{row.code}</td>
                <td className="p-3">{row.name}</td>
                <td className="p-3 text-right font-medium">
                  {money(row.amountCents, currency)}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="p-8 text-center text-muted-foreground">
                No posted balances for this selection.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AccountingPage({
  view = "overview",
}: {
  view?: AccountingView;
}) {
  const countries = useQuery(api.countries.list, {});
  const receivingAccounts = useQuery(api.receivingAccounts.list, {
    purpose: "incoming",
  });
  const [countryId, setCountryId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const today = new Date();
  const [asOf, setAsOf] = useState(dateInput(today));
  const [startDate, setStartDate] = useState(`${today.getUTCFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(dateInput(today));
  useEffect(() => {
    if (!countryId && countries?.length) setCountryId(countries[0]._id);
  }, [countries, countryId]);
  const selectedCountry = countryId as Id<"countries">;
  const ready = Boolean(countryId);
  const reportBase = ready ? { countryId: selectedCountry, currency } : "skip";
  const accounts = useQuery(
    api.accounting.listAccounts,
    ready ? { countryId: selectedCountry } : "skip",
  );
  const trial = useQuery(
    api.accounting.trialBalance,
    reportBase === "skip"
      ? "skip"
      : { ...reportBase, asOf: timestamp(asOf, true) },
  );
  const balance = useQuery(
    api.accounting.balanceSheet,
    reportBase === "skip"
      ? "skip"
      : { ...reportBase, asOf: timestamp(asOf, true) },
  );
  const income = useQuery(
    api.accounting.incomeStatement,
    reportBase === "skip"
      ? "skip"
      : {
          ...reportBase,
          startDate: timestamp(startDate),
          endDate: timestamp(endDate, true),
        },
  );
  const journals = useQuery(
    api.accounting.listJournals,
    ready
      ? {
          countryId: selectedCountry,
          startDate: timestamp(startDate),
          endDate: timestamp(endDate, true),
        }
      : "skip",
  );
  const periods = useQuery(
    api.accounting.listPeriods,
    ready ? { countryId: selectedCountry } : "skip",
  );
  const advances = useQuery(api.accounting.listAdvances, {});
  const migrationStatus = useQuery(
    api.accounting.migrationStatus,
    ready ? { countryId: selectedCountry } : "skip",
  );
  const migrationExceptions = useQuery(
    api.accounting.listMigrationExceptions,
    ready ? { countryId: selectedCountry } : "skip",
  );
  const reconciliation = useQuery(
    api.accounting.reconciliation,
    ready ? { countryId: selectedCountry, currency } : "skip",
  );
  const historicalInflows = useQuery(
    api.accounting.listHistoricalInflows,
    ready && view === "migration" ? { countryId: selectedCountry } : "skip",
  );
  const initialize = useMutation(api.accounting.initialize);
  const createAccount = useMutation(api.accounting.createAccount);
  const migrateBatch = useMutation(api.accounting.migrateBatch);
  const classifyHistoricalInflow = useMutation(
    api.accounting.classifyHistoricalInflow,
  );
  const assignHistoricalPaymentAccount = useMutation(
    api.accounting.assignHistoricalPaymentAccount,
  );
  const setPeriodStatus = useMutation(api.accounting.setPeriodStatus);
  const postManualJournal = useMutation(api.accounting.postManualJournal);
  const [accountId, setAccountId] = useState("");
  const [newAccountCode, setNewAccountCode] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState<
    "asset" | "liability" | "equity" | "income" | "expense"
  >("expense");
  useEffect(() => {
    if (!accountId && accounts?.length) setAccountId(accounts[0]._id);
  }, [accounts, accountId]);
  const ledger = useQuery(
    api.accounting.generalLedger,
    ready && accountId
      ? {
          countryId: selectedCountry,
          accountId: accountId as Id<"accountingAccounts">,
          currency,
          startDate: timestamp(startDate),
          endDate: timestamp(endDate, true),
        }
      : "skip",
  );
  const [pending, setPending] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(asOf.slice(0, 7));
  const [periodReason, setPeriodReason] = useState("");
  const [periodStatus, setPeriodStatusValue] = useState<
    "open" | "soft_closed" | "closed"
  >("closed");
  const [correctionDate, setCorrectionDate] = useState(dateInput(today));
  const [correctionDescription, setCorrectionDescription] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [debitAccountId, setDebitAccountId] = useState("");
  const [creditAccountId, setCreditAccountId] = useState("");
  const [migrationProgress, setMigrationProgress] = useState("");
  const [migrationPreviewed, setMigrationPreviewed] = useState(false);
  const [exceptionAccounts, setExceptionAccounts] = useState<
    Record<string, string>
  >({});
  const [exceptionReferences, setExceptionReferences] = useState<
    Record<string, string>
  >({});
  const heading = titles[view];

  const periodControls =
    view === "income-statement" || view === "journals" || view === "ledger";
  const run = async (action: () => Promise<unknown>, success: string) => {
    setPending(true);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Accounting action failed",
      );
    } finally {
      setPending(false);
    }
  };
  const runMigration = (dryRun: boolean) =>
    run(
      async () => {
        const phases = [
          "invoices",
          "deferred",
          "payments",
          "expenses",
          "transactions",
        ] as const;
        for (const phase of phases) {
          let cursor: string | null = null;
          let done = false;
          do {
            setMigrationProgress(`Processing ${phase.replace("_", " ")}…`);
            const result: { continueCursor: string; isDone: boolean } =
              await migrateBatch({
                countryId: selectedCountry,
                phase,
                dryRun,
                paginationOpts: { cursor, numItems: 25 },
              });
            cursor = result.continueCursor;
            done = result.isDone;
          } while (!done);
        }
        setMigrationProgress("");
        if (dryRun) setMigrationPreviewed(true);
      },
      dryRun ? "Migration scan completed" : "Historical migration completed",
    );
  const reportLinks = useMemo(
    () => [
      ["/accounting/trial-balance", "Trial Balance"],
      ["/accounting/balance-sheet", "Balance Sheet"],
      ["/accounting/income-statement", "Income Statement"],
      ["/accounting/general-ledger", "General Ledger"],
    ],
    [],
  );

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{heading.title}</h1>
          <p className="mt-1 text-muted-foreground">{heading.description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-44">
            <Label className="sr-only">Country</Label>
            <Select
              value={countryId}
              onValueChange={(value) => {
                setCountryId(value);
                setAccountId("");
                setMigrationPreviewed(false);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {countries?.map((country) => (
                  <SelectItem key={country._id} value={country._id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <Label className="sr-only">Currency</Label>
            <Input
              value={currency}
              maxLength={3}
              onChange={(event) =>
                setCurrency(event.target.value.toUpperCase())
              }
            />
          </div>
        </div>
      </div>

      {periodControls ? (
        <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <div>
            <Label>From</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div>
            <Label>To</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
        </div>
      ) : view === "trial-balance" ||
        view === "balance-sheet" ||
        view === "overview" ? (
        <div className="max-w-52">
          <Label>As of</Label>
          <Input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </div>
      ) : null}

      {view === "overview" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Trial balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {trial?.balanced ? "Balanced" : "Needs review"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {trial
                    ? `${money(trial.debitCents, currency)} debits`
                    : "Loading..."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Net income
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {income ? money(income.netIncomeCents, currency) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Balance sheet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {balance?.balanced ? "Balanced" : "Needs review"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {balance ? money(balance.assetCents, currency) : "Loading..."}{" "}
                  assets
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Accounting setup</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                disabled={!ready || pending}
                onClick={() =>
                  run(
                    () => initialize({ countryId: selectedCountry }),
                    "Chart of accounts initialized",
                  )
                }
              >
                Initialize accounts
              </Button>
              <Button variant="outline" asChild>
                <Link to="/accounting/historical-migration">
                  Migrate existing records
                </Link>
              </Button>
            </CardContent>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {reportLinks.map(([to, label]) => (
              <Button key={to} variant="outline" asChild>
                <Link to={to}>{label}</Link>
              </Button>
            ))}
          </div>
        </>
      ) : null}

      {view === "chart" ? (
        <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Add posting account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Code</Label>
                <Input
                  value={newAccountCode}
                  onChange={(event) => setNewAccountCode(event.target.value)}
                />
              </div>
              <div>
                <Label>Name</Label>
                <Input
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                />
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={newAccountType}
                  onValueChange={(value) =>
                    setNewAccountType(value as typeof newAccountType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      [
                        "asset",
                        "liability",
                        "equity",
                        "income",
                        "expense",
                      ] as const
                    ).map((type) => (
                      <SelectItem
                        key={type}
                        value={type}
                        className="capitalize"
                      >
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={
                  pending ||
                  !ready ||
                  !newAccountCode.trim() ||
                  !newAccountName.trim()
                }
                onClick={() =>
                  run(async () => {
                    await createAccount({
                      countryId: selectedCountry,
                      code: newAccountCode,
                      name: newAccountName,
                      type: newAccountType,
                      currency,
                    });
                    setNewAccountCode("");
                    setNewAccountName("");
                  }, "Posting account created")
                }
              >
                Create account
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex gap-2">
                <Button
                  disabled={!ready || pending}
                  onClick={() =>
                    run(
                      () => initialize({ countryId: selectedCountry }),
                      "Chart initialized",
                    )
                  }
                >
                  Initialize standard accounts
                </Button>
              </div>
              {!accounts ? (
                <Skeleton className="h-72" />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-3 text-left">Code</th>
                        <th className="p-3 text-left">Account</th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Control</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((row) => (
                        <tr key={row._id} className="border-b last:border-0">
                          <td className="p-3 font-mono">{row.code}</td>
                          <td className="p-3">{row.name}</td>
                          <td className="p-3 capitalize">{row.type}</td>
                          <td className="p-3">
                            {row.systemKey ? (
                              <Badge variant="secondary">System</Badge>
                            ) : (
                              "Manual"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === "journals" ? (
        <Card>
          <CardContent className="pt-6">
            {!journals ? (
              <Skeleton className="h-72" />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="p-3 text-left">Date</th>
                      <th className="p-3 text-left">Journal</th>
                      <th className="p-3 text-left">Source</th>
                      <th className="p-3 text-left">Description</th>
                      <th className="p-3 text-right">Debit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journals.length ? (
                      journals.map((row) => (
                        <tr key={row._id} className="border-b last:border-0">
                          <td className="p-3">
                            {new Date(row.accountingDate).toLocaleDateString()}
                          </td>
                          <td className="p-3 font-mono">{row.journalNumber}</td>
                          <td className="p-3">
                            {row.sourceType.replaceAll("_", " ")}
                          </td>
                          <td className="p-3">{row.description}</td>
                          <td className="p-3 text-right">
                            {money(
                              row.lines.reduce(
                                (sum, line) => sum + line.debitCents,
                                0,
                              ),
                              row.lines[0]?.currency ?? currency,
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-muted-foreground"
                        >
                          No journals in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === "trial-balance" ? (
        <Card>
          <CardContent className="pt-6">
            {!trial ? (
              <Skeleton className="h-72" />
            ) : (
              <>
                <div className="mb-4 flex justify-between">
                  <Badge variant={trial.balanced ? "default" : "destructive"}>
                    {trial.balanced ? "Balanced" : "Out of balance"}
                  </Badge>
                  <span className="font-medium">
                    Debits {money(trial.debitCents, currency)} · Credits{" "}
                    {money(trial.creditCents, currency)}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-3 text-left">Code</th>
                        <th className="p-3 text-left">Account</th>
                        <th className="p-3 text-right">Debit</th>
                        <th className="p-3 text-right">Credit</th>
                        <th className="p-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trial.rows.map((row) => (
                        <tr key={row._id} className="border-b last:border-0">
                          <td className="p-3 font-mono">{row.code}</td>
                          <td className="p-3">{row.name}</td>
                          <td className="p-3 text-right">
                            {money(row.debitCents, currency)}
                          </td>
                          <td className="p-3 text-right">
                            {money(row.creditCents, currency)}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {money(row.balanceCents, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === "income-statement" && income ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Income</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                rows={income.rows.filter((row) => row.type === "income")}
                currency={currency}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                rows={income.rows.filter((row) => row.type === "expense")}
                currency={currency}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex justify-between pt-6 text-lg font-bold">
              <span>Net income</span>
              <span>{money(income.netIncomeCents, currency)}</span>
            </CardContent>
          </Card>
        </div>
      ) : view === "income-statement" ? (
        <Skeleton className="h-72" />
      ) : null}

      {view === "balance-sheet" && balance ? (
        <div className="space-y-4">
          {(["assets", "liabilities", "equity"] as const).map((section) => (
            <Card key={section}>
              <CardHeader>
                <CardTitle className="capitalize">{section}</CardTitle>
              </CardHeader>
              <CardContent>
                <ReportTable rows={balance[section]} currency={currency} />
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardContent className="space-y-2 pt-6">
              <div className="flex justify-between">
                <span>Current earnings</span>
                <span>{money(balance.earningsCents, currency)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Assets</span>
                <span>{money(balance.assetCents, currency)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Liabilities + equity</span>
                <span>
                  {money(
                    balance.liabilityCents + balance.equityCents,
                    currency,
                  )}
                </span>
              </div>
              <Badge variant={balance.balanced ? "default" : "destructive"}>
                {balance.balanced ? "Balanced" : "Out of balance"}
              </Badge>
            </CardContent>
          </Card>
        </div>
      ) : view === "balance-sheet" ? (
        <Skeleton className="h-72" />
      ) : null}

      {view === "ledger" ? (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="max-w-md">
              <Label>Ledger account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.map((row) => (
                    <SelectItem key={row._id} value={row._id}>
                      {row.code} · {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!ledger ? (
              <Skeleton className="h-72" />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="p-3 text-left">Date</th>
                      <th className="p-3 text-left">Journal</th>
                      <th className="p-3 text-left">Description</th>
                      <th className="p-3 text-right">Debit</th>
                      <th className="p-3 text-right">Credit</th>
                      <th className="p-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((row) => (
                      <tr key={row._id} className="border-b last:border-0">
                        <td className="p-3">
                          {new Date(
                            row.journal.accountingDate,
                          ).toLocaleDateString()}
                        </td>
                        <td className="p-3 font-mono">
                          {row.journal.journalNumber}
                        </td>
                        <td className="p-3">{row.journal.description}</td>
                        <td className="p-3 text-right">
                          {money(row.debitCents, currency)}
                        </td>
                        <td className="p-3 text-right">
                          {money(row.creditCents, currency)}
                        </td>
                        <td className="p-3 text-right font-medium">
                          {money(row.runningBalanceCents, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === "advances" ? (
        <Card>
          <CardContent className="pt-6">
            {!advances ? (
              <Skeleton className="h-72" />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="p-3 text-left">Customer</th>
                      <th className="p-3 text-left">Created</th>
                      <th className="p-3 text-right">Original</th>
                      <th className="p-3 text-right">Available</th>
                      <th className="p-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advances.length ? (
                      advances.map((row) => (
                        <tr key={row._id} className="border-b last:border-0">
                          <td className="p-3">{row.companyName}</td>
                          <td className="p-3">
                            {new Date(row.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-3 text-right">
                            {money(row.originalAmountCents, row.currency)}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {money(row.remainingAmountCents, row.currency)}
                          </td>
                          <td className="p-3 capitalize">{row.status}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-muted-foreground"
                        >
                          No customer advances.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view === "periods" ? (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Update period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Month</Label>
                <Input
                  type="month"
                  value={periodMonth}
                  onChange={(event) => setPeriodMonth(event.target.value)}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={periodStatus}
                  onValueChange={(value) =>
                    setPeriodStatusValue(value as typeof periodStatus)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="soft_closed">Soft closed</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason</Label>
                <Input
                  value={periodReason}
                  onChange={(event) => setPeriodReason(event.target.value)}
                />
              </div>
              <Button
                disabled={!ready || pending || !periodReason.trim()}
                onClick={() =>
                  run(
                    () =>
                      setPeriodStatus({
                        countryId: selectedCountry,
                        month: periodMonth,
                        status: periodStatus,
                        reason: periodReason,
                      }),
                    "Accounting period updated",
                  )
                }
              >
                Save period
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              {!periods ? (
                <Skeleton className="h-64" />
              ) : periods.length ? (
                <div className="space-y-2">
                  {periods.map((row) => (
                    <div
                      key={row._id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <span className="font-medium">{row.month}</span>
                      <Badge variant="secondary">
                        {row.status.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-muted-foreground">
                  No controlled periods. Unlisted months are open.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {view === "corrections" ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>New adjustment journal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Accounting date</Label>
              <Input
                type="date"
                value={correctionDate}
                onChange={(event) => setCorrectionDate(event.target.value)}
              />
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={correctionAmount}
                onChange={(event) => setCorrectionAmount(event.target.value)}
              />
            </div>
            <div>
              <Label>Debit account</Label>
              <Select value={debitAccountId} onValueChange={setDebitAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    ?.filter((row) => row.allowManualPosting)
                    .map((row) => (
                      <SelectItem key={row._id} value={row._id}>
                        {row.code} · {row.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Credit account</Label>
              <Select
                value={creditAccountId}
                onValueChange={setCreditAccountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    ?.filter((row) => row.allowManualPosting)
                    .map((row) => (
                      <SelectItem key={row._id} value={row._id}>
                        {row.code} · {row.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Input
                value={correctionDescription}
                onChange={(event) =>
                  setCorrectionDescription(event.target.value)
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Correction reason</Label>
              <Input
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                disabled={
                  pending ||
                  !ready ||
                  !debitAccountId ||
                  !creditAccountId ||
                  debitAccountId === creditAccountId ||
                  Number(correctionAmount) <= 0 ||
                  !correctionDescription.trim() ||
                  !correctionReason.trim()
                }
                onClick={() =>
                  run(async () => {
                    const amountCents = Math.round(
                      Number(correctionAmount) * 100,
                    );
                    await postManualJournal({
                      countryId: selectedCountry,
                      accountingDate: timestamp(correctionDate),
                      currency,
                      description: correctionDescription.trim(),
                      reason: correctionReason.trim(),
                      lines: [
                        {
                          accountId: debitAccountId as Id<"accountingAccounts">,
                          debitCents: amountCents,
                        },
                        {
                          accountId:
                            creditAccountId as Id<"accountingAccounts">,
                          creditCents: amountCents,
                        },
                      ],
                    });
                    setCorrectionAmount("");
                    setCorrectionDescription("");
                    setCorrectionReason("");
                  }, "Correction journal posted")
                }
              >
                Post correction
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {view === "migration" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Posted journals</p>
                <p className="text-2xl font-bold">
                  {migrationStatus?.posted ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Open exceptions</p>
                <p className="text-2xl font-bold">
                  {migrationStatus?.openExceptions ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  Resolved exceptions
                </p>
                <p className="text-2xl font-bold">
                  {migrationStatus?.resolvedExceptions ?? "—"}
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Migration control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Records are processed in batches of 25. Existing journals are
                skipped using their source identifiers, so this can be safely
                resumed.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!ready || pending}
                  onClick={() => runMigration(true)}
                >
                  {pending
                    ? migrationProgress || "Processing…"
                    : "Scan existing records"}
                </Button>
                <Button
                  disabled={
                    !ready ||
                    pending ||
                    !migrationPreviewed ||
                    Boolean(migrationStatus?.openExceptions)
                  }
                  onClick={() => runMigration(false)}
                >
                  Post scanned records
                </Button>
              </div>
              {!migrationPreviewed ? (
                <p className="text-xs text-muted-foreground">
                  Scan first. Posting unlocks only after the scan has no open
                  exceptions.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Records requiring correction</CardTitle>
            </CardHeader>
            <CardContent>
              {!migrationExceptions ? (
                <Skeleton className="h-48" />
              ) : migrationExceptions.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Record</th>
                        <th className="p-3 text-left">Issue</th>
                        <th className="p-3 text-left">Details</th>
                        <th className="p-3 text-left">Required correction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {migrationExceptions.map((row) => (
                        <tr key={row._id} className="border-b last:border-0">
                          <td className="p-3">
                            {row.sourceType.replaceAll("_", " ")}
                          </td>
                          <td className="p-3 font-medium">
                            {row.sourceHref ? (
                              <Link
                                className="text-primary underline-offset-4 hover:underline"
                                to={row.sourceHref}
                              >
                                {row.sourceLabel}
                              </Link>
                            ) : (
                              row.sourceLabel
                            )}
                          </td>
                          <td className="p-3">
                            <Badge variant="destructive">
                              {row.code.replaceAll("_", " ")}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {row.details}
                          </td>
                          <td className="p-3">
                            <div>{row.message}</div>
                            {row.code === "CAPITAL_CLASSIFICATION_REQUIRED" ? (
                              <Button
                                className="mt-2"
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () =>
                                      classifyHistoricalInflow({
                                        transactionId:
                                          row.sourceId as Id<"accountTransactions">,
                                        type: "capital_contribution",
                                      }),
                                    "Transaction classified as capital contribution",
                                  )
                                }
                              >
                                Mark as capital
                              </Button>
                            ) : null}
                            {row.code === "MISSING_RECEIVING_ACCOUNT" ? (
                              <div className="mt-2 grid min-w-72 gap-2">
                                <Select
                                  value={exceptionAccounts[row._id] ?? ""}
                                  onValueChange={(value) =>
                                    setExceptionAccounts((current) => ({
                                      ...current,
                                      [row._id]: value,
                                    }))
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select receiving account" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {receivingAccounts
                                      ?.filter(
                                        (account) =>
                                          account.countryId ===
                                            selectedCountry &&
                                          account.currency === currency,
                                      )
                                      .map((account) => (
                                        <SelectItem
                                          key={account._id}
                                          value={account._id}
                                        >
                                          {account.name} ·{" "}
                                          {account.accountNumber}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                                <Input
                                  placeholder="Bank transaction ID"
                                  value={exceptionReferences[row._id] ?? ""}
                                  onChange={(event) =>
                                    setExceptionReferences((current) => ({
                                      ...current,
                                      [row._id]: event.target.value,
                                    }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  disabled={
                                    pending ||
                                    !exceptionAccounts[row._id] ||
                                    !exceptionReferences[row._id]?.trim()
                                  }
                                  onClick={() =>
                                    run(
                                      () =>
                                        assignHistoricalPaymentAccount({
                                          paymentId:
                                            row.sourceId as Id<"invoicePayments">,
                                          accountId: exceptionAccounts[
                                            row._id
                                          ] as Id<"receivingAccounts">,
                                          transactionId:
                                            exceptionReferences[row._id],
                                        }),
                                      "Historical payment account assigned",
                                    )
                                  }
                                >
                                  Assign and post payment
                                </Button>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-10 text-center text-muted-foreground">
                  No open migration exceptions.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Non-invoice inflow classification</CardTitle>
            </CardHeader>
            <CardContent>
              {!historicalInflows ? (
                <Skeleton className="h-32" />
              ) : historicalInflows.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-left">Reference</th>
                        <th className="p-3 text-left">Account</th>
                        <th className="p-3 text-left">Description</th>
                        <th className="p-3 text-right">Amount</th>
                        <th className="p-3 text-left">Classification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalInflows.map((row) => (
                        <tr key={row._id} className="border-b last:border-0">
                          <td className="p-3">
                            {new Date(row.transactionDate).toLocaleDateString()}
                          </td>
                          <td className="p-3 font-mono">{row.transactionId}</td>
                          <td className="p-3">{row.accountName}</td>
                          <td className="p-3">{row.description}</td>
                          <td className="p-3 text-right">
                            {money(row.amountCents, row.currency)}
                          </td>
                          <td className="p-3">
                            <Select
                              value={row.type}
                              disabled={row.isPosted || pending}
                              onValueChange={(value) =>
                                run(
                                  () =>
                                    classifyHistoricalInflow({
                                      transactionId: row._id,
                                      type: value as
                                        | "capital_contribution"
                                        | "other_non_invoice_inflow",
                                    }),
                                  "Inflow classification updated",
                                )
                              }
                            >
                              <SelectTrigger className="min-w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="capital_contribution">
                                  Capital contribution
                                </SelectItem>
                                <SelectItem value="other_non_invoice_inflow">
                                  Other non-invoice inflow
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            {row.isPosted ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Posted classifications must use Historical
                                Corrections.
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-8 text-center text-muted-foreground">
                  No non-invoice inflows found.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Reconciliation
                {reconciliation ? (
                  <Badge
                    variant={
                      reconciliation.reconciled ? "default" : "destructive"
                    }
                  >
                    {reconciliation.reconciled
                      ? "Reconciled"
                      : "Differences found"}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!reconciliation ? (
                <Skeleton className="h-48" />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="p-3 text-left">Control</th>
                        <th className="p-3 text-right">Source records</th>
                        <th className="p-3 text-right">Ledger</th>
                        <th className="p-3 text-right">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...reconciliation.controls,
                        ...reconciliation.banks,
                      ].map((row, index) => (
                        <tr
                          key={`${row.name}-${index}`}
                          className="border-b last:border-0"
                        >
                          <td className="p-3">{row.name}</td>
                          <td className="p-3 text-right">
                            {money(row.sourceCents, currency)}
                          </td>
                          <td className="p-3 text-right">
                            {money(row.ledgerCents, currency)}
                          </td>
                          <td
                            className={`p-3 text-right font-medium ${row.differenceCents ? "text-destructive" : ""}`}
                          >
                            {money(row.differenceCents, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
