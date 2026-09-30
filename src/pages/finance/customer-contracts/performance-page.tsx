import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  contractModel,
  FREQUENCY_LABELS,
  MODEL_LABELS,
} from "./contract-utils.ts";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
const percent = (value?: number) =>
  value === undefined ? "—" : `${Math.round(value)}%`;

export default function ContractPerformancePage() {
  const navigate = useNavigate();
  const rows = useQuery(api.customerContracts.performance, {});
  const countries = useQuery(api.countries.list, {});
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("all");
  const [signal, setSignal] = useState("all");
  const [frequency, setFrequency] = useState("all");
  const [country, setCountry] = useState("all");
  if (!rows || !countries)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-80" />
      </div>
    );
  const term = search.trim().toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (!term ||
        row.contractNumber.toLowerCase().includes(term) ||
        row.companyName.toLowerCase().includes(term)) &&
      (model === "all" || contractModel(row) === model) &&
      (signal === "all" || row.signal === signal) &&
      (frequency === "all" || row.billingFrequency === frequency) &&
      (country === "all" || row.countryId === country),
  );
  const totals = filtered.reduce(
    (sum, row) => ({
      value: sum.value + (row.contractValue ?? 0),
      invoiced: sum.invoiced + row.invoiced,
      collected: sum.collected + row.collected,
      outstanding: sum.outstanding + row.outstanding,
      overage: sum.overage + row.overage,
    }),
    { value: 0, invoiced: 0, collected: 0, outstanding: 0, overage: 0 },
  );
  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Contract Performance
        </h1>
        <p className="text-muted-foreground">
          Commitment utilization, invoicing, collections, and commercial risk.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Active contract value" value={money(totals.value)} />
        <Metric label="Invoiced" value={money(totals.invoiced)} />
        <Metric label="Collected" value={money(totals.collected)} />
        <Metric label="Outstanding" value={money(totals.outstanding)} />
        <Metric label="Overage" value={money(totals.overage)} />
      </div>
      <Card>
        <div className="grid gap-3 border-b p-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search contract or customer..."
              className="pl-9"
            />
          </div>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger aria-label="Contract model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {Object.entries(MODEL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={signal} onValueChange={setSignal}>
            <SelectTrigger aria-label="Performance signal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All signals</SelectItem>
              {[
                "On track",
                "Collection risk",
                "Over-consuming",
                "Underutilized",
              ].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger aria-label="Billing frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All billing cycles</SelectItem>
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger aria-label="Country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map((row) => (
                <SelectItem key={row._id} value={row._id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3">Contract</th>
                <th>Customer</th>
                <th>Elapsed</th>
                <th>Commitment used</th>
                <th>Invoiced</th>
                <th>Collected</th>
                <th>Outstanding</th>
                <th>Overage</th>
                <th>Signal</th>
                <th className="pr-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.contractId} className="border-b last:border-0">
                  <td className="p-3 font-medium">{row.contractNumber}</td>
                  <td>{row.companyName}</td>
                  <td>{percent(row.elapsedPercent)}</td>
                  <td>{percent(row.utilizationPercent)}</td>
                  <td>{money(row.invoiced)}</td>
                  <td>{money(row.collected)}</td>
                  <td>{money(row.outstanding)}</td>
                  <td>{money(row.overage)}</td>
                  <td>
                    <Badge
                      variant={
                        row.signal === "Collection risk" ||
                        row.signal === "Over-consuming"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {row.signal}
                    </Badge>
                  </td>
                  <td className="pr-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(
                          `/finance/customer-contracts/${row.contractId}`,
                        )
                      }
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              No contract performance data matches these filters.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
