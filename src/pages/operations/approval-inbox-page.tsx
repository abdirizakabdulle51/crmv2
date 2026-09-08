import { useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { formatCurrency } from "@/lib/format.ts";
import { Clock3, FileCheck2, ReceiptText } from "lucide-react";

export default function ApprovalInboxPage() {
  const navigate = useNavigate();
  const [type, setType] = useState<"all" | "expense" | "quote">("all");
  const expenses = useQuery(api.expenses.listExpenseRequests, {
    status: "submitted",
  });
  const quotes = useQuery(api.quotes.list, {});
  const companies = useQuery(api.companies.list, {});
  const users = useQuery(api.users.listAll, {});
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const settings = useQuery(api.expenses.getFinanceSettings, {});
  if (!expenses || !quotes || !companies || !users || !currentUser || !settings)
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  const companyNames = new Map(
    companies.map((company) => [company._id, company.name]),
  );
  const userNames = new Map(
    users.map((user) => [user._id, user.name ?? user.email]),
  );
  const isExecutive =
    currentUser.role === "ceo" || currentUser.role === "head_of_business";
  const reviewableExpenses = expenses.filter(
    (expense) =>
      isExecutive ||
      (currentUser.role === "country_gm" &&
        currentUser.countryId === expense.countryId &&
        expense.amount <= settings.countryApprovalLimit),
  );
  const pendingQuotes = quotes.filter((quote) => {
    if (quote.discountApprovalStatus !== "pending") return false;
    if (currentUser.role === "ceo") return true;
    if (currentUser.role === "head_of_business")
      return quote.discountApprovalLevel === "head_of_business";
    if (currentUser.role === "country_gm")
      return quote.discountApprovalLevel === "country_gm";
    return quote.discountApprovalLevel === "account_manager";
  });
  const rows = [
    ...reviewableExpenses.map((expense) => ({
      id: expense._id,
      kind: "expense" as const,
      title: expense.title,
      owner: userNames.get(expense.requestedBy) ?? "Unknown",
      context: companyNames.get(expense.companyId!),
      value: formatCurrency(expense.amount),
      submittedAt: expense.submittedAt ?? expense.createdAt,
      href: `/finance/expenses/${expense._id}`,
    })),
    ...pendingQuotes.map((quote) => ({
      id: quote._id,
      kind: "quote" as const,
      title: quote.quoteNumber ?? "Opportunity quote",
      owner:
        userNames.get(quote.discountRequestedBy ?? quote.createdBy) ??
        "Unknown",
      context: companyNames.get(quote.companyId),
      value: `${quote.discountPercent ?? 0}% discount`,
      submittedAt: quote.discountRequestedAt ?? quote._creationTime,
      href: `/quotes/${quote._id}`,
    })),
  ]
    .filter((row) => type === "all" || row.kind === type)
    .sort((a, b) => a.submittedAt - b.submittedAt);
  return (
    <div className="space-y-6 p-6 md:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Approval Inbox</h1>
        <p className="mt-1 text-muted-foreground">
          One place for decisions waiting on your review.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">
              Waiting for Review
            </div>
            <div className="text-2xl font-bold">
              {reviewableExpenses.length + pendingQuotes.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-muted-foreground">Expenses</div>
              <div className="text-2xl font-bold">
                {reviewableExpenses.length}
              </div>
            </div>
            <ReceiptText className="h-6 w-6 text-cyan-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <div className="text-sm text-muted-foreground">
                Quote Discounts
              </div>
              <div className="text-2xl font-bold">{pendingQuotes.length}</div>
            </div>
            <FileCheck2 className="h-6 w-6 text-teal-600" />
          </CardContent>
        </Card>
      </div>
      <div className="flex gap-2">
        {(["all", "expense", "quote"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={type === value ? "default" : "outline"}
            onClick={() => setType(value)}
          >
            {value === "all"
              ? "All Approvals"
              : value === "expense"
                ? "Expenses"
                : "Quote Discounts"}
          </Button>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.map((row) => (
              <div
                key={`${row.kind}:${row.id}`}
                role="link"
                tabIndex={0}
                onClick={() => navigate(row.href)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(row.href);
                }}
                className="flex cursor-pointer items-center gap-4 p-4 hover:bg-muted/30"
              >
                <div className="rounded-lg bg-primary/10 p-2">
                  {row.kind === "expense" ? (
                    <ReceiptText className="h-5 w-5 text-primary" />
                  ) : (
                    <FileCheck2 className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{row.title}</span>
                    <Badge variant="outline">
                      {row.kind === "expense" ? "Expense" : "Quote Discount"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Requested by {row.owner}
                    {row.context ? ` · ${row.context}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{row.value}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="h-3 w-3" />
                    {new Date(row.submittedAt).toLocaleDateString()}
                  </div>
                </div>
                <Button size="sm" variant="outline">
                  Review
                </Button>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="p-12 text-center text-muted-foreground">
                <FileCheck2 className="mx-auto mb-3 h-8 w-8" />
                No approvals are waiting in this view.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
