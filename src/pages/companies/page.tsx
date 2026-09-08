import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
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
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileWarning,
  Plus,
  Search,
  Upload,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { formatCurrency } from "@/lib/format.ts";
import CompanyDialog from "./_components/company-dialog.tsx";
import ImportDialog from "./_components/import-dialog.tsx";
import { matchesOwnerFilter } from "./owner-filter.ts";

const PAGE_SIZE = 10;
const healthStyle = {
  healthy: "bg-emerald-100 text-emerald-800",
  attention: "bg-amber-100 text-amber-800",
  at_risk: "bg-red-100 text-red-800",
  prospect: "bg-sky-100 text-sky-800",
  lost: "bg-slate-100 text-slate-700",
} as const;
const healthLabel = {
  healthy: "Healthy",
  attention: "Attention",
  at_risk: "At risk",
  prospect: "Prospect",
  lost: "Lost",
} as const;

function formatDate(value?: number) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(value)
    : "—";
}

export default function CompaniesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dashboard = useQuery(api.companies.dashboard, {});
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const users = useQuery(api.users.listAll, {});
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [typeFilter, setTypeFilter] = useState("all");
  const [healthFilter, setHealthFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [selectedOwnerFilter, setSelectedOwnerFilter] = useState<string>();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const rows = useMemo(() => dashboard?.rows ?? [], [dashboard?.rows]);
  const ownerFilter =
    selectedOwnerFilter ??
    (dashboard?.currentUserRole === "account_manager" ? "mine" : "all");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        term &&
        !row.name.toLowerCase().includes(term) &&
        !row.contactName?.toLowerCase().includes(term) &&
        !row.ownerName?.toLowerCase().includes(term)
      )
        return false;
      if (typeFilter === "prospect" && row.lifecycleStatus !== "prospect")
        return false;
      if (typeFilter === "lost" && row.lifecycleStatus !== "lost") return false;
      if (
        (typeFilter === "contracted" || typeFilter === "payg") &&
        (row.lifecycleStatus !== "customer" ||
          row.commercialModel !== typeFilter)
      )
        return false;
      if (healthFilter !== "all" && row.health !== healthFilter) return false;
      if (signalFilter === "missing" && !row.missingInvoice) return false;
      if (signalFilter === "expiring" && !row.expiringSoon) return false;
      if (signalFilter === "overdue" && !row.overdue) return false;
      if (countryFilter !== "all" && row.countryId !== countryFilter)
        return false;
      if (
        !matchesOwnerFilter(
          row.accountManagerId,
          ownerFilter,
          dashboard?.currentUserId,
        )
      )
        return false;
      return true;
    });
  }, [
    rows,
    dashboard?.currentUserId,
    search,
    typeFilter,
    healthFilter,
    signalFilter,
    countryFilter,
    ownerFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const displayed = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const mixTotal =
    (dashboard?.summary.contracted ?? 0) +
    (dashboard?.summary.payg ?? 0) +
    (dashboard?.summary.prospects ?? 0);
  const percent = (value: number) =>
    mixTotal ? Math.round((value / mixTotal) * 100) : 0;
  const applyFilter = (type: string, health = "all") => {
    setTypeFilter(type);
    setHealthFilter(health);
    setSignalFilter(health === "at_risk" ? "overdue" : "all");
    setPage(1);
  };
  const applySignal = (signal: string) => {
    setTypeFilter("all");
    setHealthFilter("all");
    setSignalFilter(signal);
    setSelectedOwnerFilter("all");
    setPage(1);
  };

  if (!dashboard || !countries || !sectors || !users) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const summaryCards = [
    {
      label: "Total Customers",
      value: dashboard.summary.total,
      icon: UsersRound,
      action: () => applyFilter("all"),
    },
    {
      label: "Contracted",
      value: dashboard.summary.contracted,
      icon: Building2,
      action: () => applyFilter("contracted"),
    },
    {
      label: "Pay As You Go",
      value: dashboard.summary.payg,
      icon: CircleDollarSign,
      action: () => applyFilter("payg"),
    },
    {
      label: "Prospects",
      value: dashboard.summary.prospects,
      icon: UserRoundPlus,
      action: () => applyFilter("prospect"),
    },
    {
      label: "Overdue",
      value: dashboard.summary.overdue,
      icon: AlertTriangle,
      tone: "text-red-600",
      action: () => applyFilter("all", "at_risk"),
    },
    {
      label: "Missing Invoices",
      value: dashboard.summary.missingInvoices,
      icon: FileWarning,
      tone: "text-amber-600",
      action: () => applySignal("missing"),
    },
  ];
  const attention = [
    {
      count: dashboard.summary.missingInvoices,
      label: `${dashboard.previousMonth} PAYG cycles need invoices`,
      tone: "bg-amber-100 text-amber-800",
      action: () => applySignal("missing"),
    },
    {
      count: dashboard.summary.overdue,
      label: "customers have overdue balances",
      tone: "bg-red-100 text-red-800",
      action: () => applySignal("overdue"),
    },
    {
      count: dashboard.summary.expiringSoon,
      label: "contracts expire within 60 days",
      tone: "bg-orange-100 text-orange-800",
      action: () => applySignal("expiring"),
    },
    {
      count: dashboard.summary.unassigned,
      label: "customers are unassigned",
      tone: "bg-slate-100 text-slate-700",
      action: () => {
        applySignal("all");
        setSelectedOwnerFilter("unassigned");
      },
    },
  ];

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="mt-1 text-muted-foreground">
            Monitor customer health, billing, and ownership.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Customer
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map(({ label, value, icon: Icon, tone, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            className="rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <Icon className={`h-5 w-5 ${tone ?? "text-primary"}`} />
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className={`mt-3 text-2xl font-bold ${tone ?? ""}`}>
              {value}
            </div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
              >
                <Badge className={item.tone}>{item.count}</Badge>
                <span className="flex-1 text-sm">{item.label}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    item.action();
                    setPage(1);
                  }}
                >
                  View
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Customer Mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              ["Contracted", dashboard.summary.contracted, "bg-cyan-600"],
              ["Pay As You Go", dashboard.summary.payg, "bg-teal-500"],
              ["Prospects", dashboard.summary.prospects, "bg-slate-400"],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="font-medium">{percent(Number(value))}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${percent(Number(value))}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <CardTitle>Customer Portfolio</CardTitle>
            <span className="text-sm text-muted-foreground">
              {filtered.length} results
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search customers..."
                className="pl-9"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Customer type">
                <SelectValue placeholder="Customer type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="contracted">Contracted</SelectItem>
                <SelectItem value="payg">Pay As You Go</SelectItem>
                <SelectItem value="prospect">Prospects</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={healthFilter}
              onValueChange={(value) => {
                setHealthFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Customer health">
                <SelectValue placeholder="Health" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Health</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="attention">Attention</SelectItem>
                <SelectItem value="at_risk">At risk</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={countryFilter}
              onValueChange={(value) => {
                setCountryFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Country">
                <SelectValue placeholder="Country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Countries</SelectItem>
                {countries.map((country) => (
                  <SelectItem key={country._id} value={country._id}>
                    {country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ownerFilter}
              onValueChange={(value) => {
                setSelectedOwnerFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Account manager">
                <SelectValue placeholder="Account manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Account Managers</SelectItem>
                <SelectItem value="mine">My Customers</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users
                  .filter((user) => user.role === "account_manager")
                  .map((user) => (
                    <SelectItem key={user._id} value={user._id}>
                      {user.name ?? user.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead>
                <tr className="border-y bg-muted/30 text-left">
                  <th className="p-3 font-medium">Customer</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Owner</th>
                  <th className="p-3 font-medium">Contract</th>
                  <th className="p-3 text-right font-medium">Monthly Usage</th>
                  <th className="p-3 text-right font-medium">Outstanding</th>
                  <th className="p-3 font-medium">Last Payment</th>
                  <th className="p-3 font-medium">Health</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((row) => (
                  <tr
                    key={row._id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="p-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.contactName ?? "No primary contact"}
                      </div>
                    </td>
                    <td className="p-3">
                      <Badge variant="outline">
                        {row.lifecycleStatus === "prospect"
                          ? "Prospect"
                          : row.lifecycleStatus === "lost"
                            ? "Lost"
                            : row.commercialModel === "contracted"
                              ? "Contracted"
                              : "PAYG"}
                      </Badge>
                    </td>
                    <td className="p-3">{row.ownerName ?? "Unassigned"}</td>
                    <td className="p-3">
                      {row.contractNumber ? (
                        <div>
                          <span className="font-medium">
                            {row.contractNumber}
                          </span>
                          {row.expiringSoon && (
                            <div className="text-xs text-amber-700">
                              Renews {formatDate(row.contractEndDate)}
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {formatCurrency(row.monthlyUsage)}
                    </td>
                    <td
                      className={`p-3 text-right font-medium ${row.outstanding > 0 ? "text-amber-700" : ""}`}
                    >
                      {formatCurrency(row.outstanding)}
                    </td>
                    <td className="p-3">{formatDate(row.lastPaymentAt)}</td>
                    <td className="p-3">
                      <Badge className={healthStyle[row.health]}>
                        {healthLabel[row.health]}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/companies/${row._id}`)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
                {displayed.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="p-10 text-center text-muted-foreground"
                    >
                      No customers match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Page {safePage} of {pageCount}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={safePage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage === pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <CompanyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        company={null}
        countries={countries}
        sectors={sectors}
        users={users}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
