import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { FileSignature, Pencil, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { FREQUENCY_LABELS, STATUS_LABELS } from "./contract-utils.ts";

const date = (value: number) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);

export default function CustomerContractsPage() {
  const navigate = useNavigate();
  const { currentUser } = useCrm();
  const contracts = useQuery(api.customerContracts.list, {});
  const canManage =
    currentUser?.role === "ceo" || currentUser?.role === "head_of_business";

  if (!contracts)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80" />
      </div>
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
        <Metric label="All contracts" value={contracts.length} />
        <Metric
          label="Active"
          value={contracts.filter((row) => row.status === "active").length}
        />
        <Metric
          label="Drafts"
          value={contracts.filter((row) => row.status === "draft").length}
        />
      </div>

      <Card>
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
              {contracts.map((contract) => (
                <tr key={contract._id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{contract.contractNumber}</div>
                    <div className="text-muted-foreground">
                      {contract.title}
                    </div>
                  </td>
                  <td>{contract.companyName}</td>
                  <td className="capitalize">
                    {(
                      contract.pricingModel ?? "legacy service lines"
                    ).replaceAll("_", " ")}
                  </td>
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
          {contracts.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              No contracts have been created.
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
