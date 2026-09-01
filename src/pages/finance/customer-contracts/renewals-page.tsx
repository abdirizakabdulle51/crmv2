import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";

const DAY = 86_400_000;
const daysLeft = (endDate: number) => Math.ceil((endDate - Date.now()) / DAY);
const bucket = (days: number) =>
  days < 0
    ? "Expired"
    : days <= 30
      ? "Due in 30 days"
      : days <= 60
        ? "Due in 31–60 days"
        : "Due in 61–90 days";
const date = (value: number) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
const money = (value: number | undefined, currency: string) =>
  value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
        value,
      );

export default function ContractRenewalsPage() {
  const navigate = useNavigate();
  const contracts = useQuery(api.customerContracts.list, {});
  if (!contracts)
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80" />
      </div>
    );
  const rows = contracts
    .filter((row) => row.status === "active" || row.status === "expired")
    .map((contract) => ({ contract, days: daysLeft(contract.endDate) }))
    .filter((row) => row.days <= 90)
    .sort((a, b) => a.days - b.days);

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contract Renewals</h1>
        <p className="text-muted-foreground">
          Prioritize expiring agreements and revenue at risk.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          "Expired",
          "Due in 30 days",
          "Due in 31–60 days",
          "Due in 61–90 days",
        ].map((label) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold">
                {rows.filter((row) => bucket(row.days) === label).length}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[850px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3">Contract</th>
                <th>Customer</th>
                <th>End date</th>
                <th>Contract value</th>
                <th>Time remaining</th>
                <th>Priority</th>
                <th className="pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ contract, days }) => (
                <tr key={contract._id} className="border-b last:border-0">
                  <td className="p-3">
                    <div className="font-medium">{contract.contractNumber}</div>
                    <div className="text-muted-foreground">
                      {contract.title}
                    </div>
                  </td>
                  <td>{contract.companyName}</td>
                  <td>{date(contract.endDate)}</td>
                  <td>{money(contract.contractValue, contract.currency)}</td>
                  <td>
                    {days < 0
                      ? `${Math.abs(days)} days overdue`
                      : `${days} days`}
                  </td>
                  <td>
                    <Badge variant={days <= 30 ? "destructive" : "secondary"}>
                      {bucket(days)}
                    </Badge>
                  </td>
                  <td className="pr-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(`/finance/customer-contracts/${contract._id}`)
                      }
                    >
                      <CalendarClock className="mr-2 h-4 w-4" /> Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              No contracts require renewal within 90 days.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
