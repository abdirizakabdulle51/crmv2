import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty.tsx";
import { Plus, FileText, Eye, Sparkles } from "lucide-react";
import QuoteCreateDialog from "./_components/quote-create-dialog.tsx";
import QuoteDetailDialog from "./_components/quote-detail-dialog.tsx";
import { formatCurrency } from "./_lib/format.ts";

type Quote = Doc<"quotes">;

export default function QuotesPage() {
  const navigate = useNavigate();
  const companies = useQuery(api.companies.list, {});
  const quotes = useQuery(api.quotes.list, {});
  const updateStatus = useMutation(api.quotes.updateStatus);
  const removeQuote = useMutation(api.quotes.remove);

  const [createOpen, setCreateOpen] = useState(false);
  const [viewQuote, setViewQuote] = useState<Quote | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");

  if (!companies || !quotes) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const companyMap = new Map(companies.map((c) => [c._id, c]));

  // Filter quotes
  const filtered = quotes.filter((q) => {
    if (statusFilter !== "all" && q.status !== statusFilter) return false;
    if (companyFilter !== "all" && q.companyId !== companyFilter) return false;
    return true;
  });

  // Summary stats
  const totalQuotes = quotes.length;
  const draftCount = quotes.filter((q) => q.status === "draft").length;
  const sentCount = quotes.filter((q) => q.status === "sent").length;
  const acceptedCount = quotes.filter((q) => q.status === "accepted").length;

  const statusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <Badge variant="secondary">Draft</Badge>;
      case "sent":
        return (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
            Sent
          </Badge>
        );
      case "accepted":
        return (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
            Accepted
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quotes</h1>
          <p className="text-muted-foreground mt-1">
            Generate and manage service quotes for companies
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/quotes/generate")}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate from Usage
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Quote
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalQuotes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Draft
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{draftCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{sentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Accepted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {acceptedCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quote list */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>
              {quotes.length === 0 ? "No quotes yet" : "No matching quotes"}
            </EmptyTitle>
            <EmptyDescription>
              {quotes.length === 0
                ? "Create a quote from the service catalog for a company"
                : "Adjust your filters to see quotes"}
            </EmptyDescription>
          </EmptyHeader>
          {quotes.length === 0 && (
            <EmptyContent>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create Quote
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium">Company</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Items</th>
                    <th className="text-right p-3 font-medium">Monthly</th>
                    <th className="text-right p-3 font-medium">Yearly</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((quote) => {
                      const company = companyMap.get(quote.companyId);
                      return (
                        <tr key={quote._id} className="border-b last:border-0">
                          <td className="p-3 font-medium">
                            {company?.name || "Unknown"}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {quote.date}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {quote.lineItems.length}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(quote.monthlyGrandTotal)}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(quote.yearlyGrandTotal)}
                          </td>
                          <td className="p-3">{statusBadge(quote.status)}</td>
                          <td className="p-3 text-right">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setViewQuote(quote)}
                                className="cursor-pointer"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <QuoteCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companies={companies}
      />

      {viewQuote && (
        <QuoteDetailDialog
          quote={viewQuote}
          companyName={companyMap.get(viewQuote.companyId)?.name || "Unknown"}
          open={!!viewQuote}
          onOpenChange={(v) => {
            if (!v) setViewQuote(null);
          }}
          onStatusChange={async (status) => {
            await updateStatus({ id: viewQuote._id, status });
            setViewQuote(null);
          }}
          onDelete={async () => {
            await removeQuote({ id: viewQuote._id });
            setViewQuote(null);
          }}
        />
      )}
    </div>
  );
}
