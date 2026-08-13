import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { CalendarDays, Database, Filter, Search } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { CompanyCombobox } from "@/components/company-combobox.tsx";
import { Badge } from "@/components/ui/badge.tsx";
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

function currentMonthInputValue() {
  return new Date().toISOString().slice(0, 7);
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

export default function DailyUsagePage() {
  const companies = useQuery(api.companies.list, {});
  const [month, setMonth] = useState(currentMonthInputValue());
  const [companyId, setCompanyId] = useState("all");
  const [serviceType, setServiceType] = useState("all");
  const [usageDate, setUsageDate] = useState("all");
  const [search, setSearch] = useState("");

  const review = useQuery(api.dailyUsage.review, {
    month,
    companyId: companyId === "all" ? undefined : (companyId as Id<"companies">),
  });

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (review?.rows ?? []).filter((row) => {
      if (serviceType !== "all" && row.serviceType !== serviceType) {
        return false;
      }
      if (usageDate !== "all" && row.usageDate !== usageDate) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = [
        row.companyName,
        row.tenantName,
        row.serviceType,
        row.itemName,
        row.regionName,
        row.dataCenterName,
        row.unit,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [review?.rows, search, serviceType, usageDate]);

  const totals = useMemo(() => {
    const companyCount = new Set(rows.map((row) => row.companyId)).size;
    const dayCount = new Set(rows.map((row) => row.usageDate)).size;
    const serviceCount = new Set(rows.map((row) => row.serviceType)).size;
    return {
      rows: rows.length,
      companyCount,
      dayCount,
      serviceCount,
      locked: rows.filter((row) => row.lockedAt).length,
    };
  }, [rows]);

  if (!companies || !review) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-56" />
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Daily Usage Review
        </h1>
        <p className="mt-1 text-muted-foreground">
          Review captured daily ManageOne usage snapshots before monthly rollup
          or billing is enabled.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Snapshot rows" value={totals.rows} />
        <SummaryCard label="Customers" value={totals.companyCount} />
        <SummaryCard label="Services" value={totals.serviceCount} />
        <SummaryCard label="Captured days" value={totals.dayCount} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[180px_260px_220px_220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="daily-usage-month">Month</Label>
              <Input
                id="daily-usage-month"
                type="month"
                value={month}
                onChange={(event) => {
                  setMonth(event.target.value);
                  setUsageDate("all");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Customer</Label>
              <CompanyCombobox
                companies={companies}
                value={companyId}
                onValueChange={setCompanyId}
              />
            </div>
            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger>
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {review.filters.serviceTypes.map((service) => (
                    <SelectItem key={service} value={service}>
                      {service}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Usage date</Label>
              <Select value={usageDate} onValueChange={setUsageDate}>
                <SelectTrigger>
                  <SelectValue placeholder="All days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All days</SelectItem>
                  {review.filters.usageDates.map((date) => (
                    <SelectItem key={date} value={date}>
                      {formatDate(date)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="daily-usage-search">Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="daily-usage-search"
                  className="pl-9"
                  placeholder="Customer, tenant, service, region..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Captured Daily Usage</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only data captured from ManageOne snapshots. It does not
              create or change invoices.
            </p>
          </div>
          <Badge variant="outline">{totals.locked} locked</Badge>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Database className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>No daily usage snapshots found.</EmptyTitle>
                <EmptyDescription>
                  The Phase 1 capture job stores rows after it runs. Adjust the
                  month or customer filter if you are reviewing older data.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1180px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Usage Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Tenant</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Quantity</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2">Region</th>
                    <th className="px-3 py-2">Captured</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row._id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" />
                          {formatDate(row.usageDate)}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-medium">
                        {row.companyName}
                      </td>
                      <td className="px-3 py-3">
                        <div>{row.tenantName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.tenantVdcId}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant="secondary">{row.serviceType}</Badge>
                      </td>
                      <td className="px-3 py-3">{row.itemName}</td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatQuantity(row.quantity)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.unit}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {row.regionName ?? row.dataCenterName ?? "-"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatTimestamp(row.capturedAt)}
                      </td>
                      <td className="px-3 py-3">
                        {row.lockedAt ? (
                          <Badge variant="outline">Locked</Badge>
                        ) : (
                          <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
                            Captured
                          </Badge>
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

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <Filter className="mt-0.5 h-4 w-4" />
          <p>
            This page is for review only. Monthly rollup and invoice generation
            will be added in later phases after the daily capture data is
            verified.
          </p>
        </div>
      </div>
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
