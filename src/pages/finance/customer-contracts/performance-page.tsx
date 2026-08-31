import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
const percent = (value?: number) =>
  value === undefined ? "—" : `${Math.round(value)}%`;

export default function ContractPerformancePage() {
  const navigate = useNavigate();
  const rows = useQuery(api.customerContracts.performance, {});
  if (!rows)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-80" />
      </div>
    );
  const totals = rows.reduce(
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
              {rows.map((row) => (
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
          {rows.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              No active contract performance data.
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
