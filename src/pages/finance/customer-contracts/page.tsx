import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { FileSignature, Pencil, Plus, Search } from "lucide-react";
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
import { useCrm } from "@/lib/crm-context.tsx";
import {
  contractModel,
  contractModelLabel,
  FREQUENCY_LABELS,
  MODEL_LABELS,
  STATUS_LABELS,
} from "./contract-utils.ts";

const date = (value: number) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);

export default function CustomerContractsPage() {
  const navigate = useNavigate();
  const { currentUser } = useCrm();
  const contracts = useQuery(api.customerContracts.list, {});
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [model, setModel] = useState("all");
  const [frequency, setFrequency] = useState("all");
  const [timing, setTiming] = useState("all");
  const canManage =
    currentUser?.role === "ceo" || currentUser?.role === "head_of_business";

  if (!contracts)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80" />
      </div>
    );

  const term = search.trim().toLowerCase();
  const filtered = contracts.filter(
    (contract) =>
      (!term ||
        contract.contractNumber.toLowerCase().includes(term) ||
        contract.title.toLowerCase().includes(term) ||
        contract.companyName.toLowerCase().includes(term)) &&
      (status === "all" || contract.status === status) &&
      (model === "all" || contractModel(contract) === model) &&
      (frequency === "all" || contract.billingFrequency === frequency) &&
      (timing === "all" || (contract.billingTiming ?? "postpaid") === timing),
  );

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
          <p className="text-muted-foreground">
            Current agreements, billing terms, status, editing, and invoicing.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => navigate("/finance/customer-contracts/new")}>
            <Plus className="mr-2 h-4 w-4" /> New Contract
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Filtered contracts" value={filtered.length} />
        <Metric
          label="Active"
          value={filtered.filter((row) => row.status === "active").length}
        />
        <Metric
          label="Drafts"
          value={filtered.filter((row) => row.status === "draft").length}
        />
      </div>

      <Card>
        <div className="grid gap-3 border-b p-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative md:col-span-2 xl:col-span-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search contracts..."
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Contract status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Select value={timing} onValueChange={setTiming}>
            <SelectTrigger aria-label="Billing timing">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All billing timing</SelectItem>
              <SelectItem value="prepaid">Prepaid</SelectItem>
              <SelectItem value="postpaid">Postpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1050px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3">Contract</th>
                <th>Customer</th>
                <th>Model</th>
                <th>Billing</th>
                <th>Dates</th>
                <th>Status</th>
                <th className="pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contract) => (
                <tr key={contract._id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{contract.contractNumber}</div>
                    <div className="text-muted-foreground">
                      {contract.title}
                    </div>
                  </td>
                  <td>{contract.companyName}</td>
                  <td>{contractModelLabel(contract)}</td>
                  <td>
                    {FREQUENCY_LABELS[contract.billingFrequency]} ·{" "}
                    {contract.billingTiming ?? "postpaid"}
                  </td>
                  <td>
                    {date(contract.startDate)} – {date(contract.endDate)}
                  </td>
                  <td>
                    <Badge
                      variant={
                        contract.status === "active" ? "default" : "secondary"
                      }
                    >
                      {STATUS_LABELS[contract.status]}
                    </Badge>
                  </td>
                  <td className="pr-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate(
                            `/finance/customer-contracts/${contract._id}`,
                          )
                        }
                      >
                        <FileSignature className="mr-2 h-4 w-4" />
                        {contract.status === "active"
                          ? "Manage / Invoice"
                          : "View"}
                      </Button>
                      {canManage &&
                      contract.status === "draft" &&
                      contract.pricingModel ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(
                              `/finance/customer-contracts/${contract._id}/edit`,
                            )
                          }
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              No contracts match these filters.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
