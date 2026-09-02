import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { FileText, Plus, WalletCards } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
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
import { Textarea } from "@/components/ui/textarea.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type Expense = Doc<"expenseRequests">;
type ExpenseStatus = Expense["status"];
type StatusFilter = "all" | ExpenseStatus;

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

function statusLabel(status: ExpenseStatus) {
  return (
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
  );
}

function statusBadge(status: ExpenseStatus) {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "submitted":
      return (
        <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
          Submitted
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          Approved
        </Badge>
      );
    case "paid":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Paid
        </Badge>
      );
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function dateInputToTimestamp(value: string) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).getTime();
}

function todayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })}`;
  }
}

function userDisplay(user?: Doc<"users">) {
  return user?.name || user?.email || "Unknown user";
}

export default function ExpensesPage() {
  const { currentUser } = useCrm();
  const navigate = useNavigate();
  const expenses = useQuery(api.expenses.listExpenseRequests, {});
  const categories = useQuery(api.expenses.listExpenseCategories, {});
  const users = useQuery(api.users.listAll, {});
  const companies = useQuery(api.companies.list, {});
  const countries = useQuery(api.countries.list, {});
  const createExpense = useMutation(api.expenses.createExpenseRequest);

  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [pendingCreate, setPendingCreate] = useState(false);

  const categoryMap = useMemo(
    () =>
      new Map((categories ?? []).map((category) => [category._id, category])),
    [categories],
  );
  const userMap = useMemo(
    () => new Map((users ?? []).map((user) => [user._id, user])),
    [users],
  );
  const companyMap = useMemo(
    () => new Map((companies ?? []).map((company) => [company._id, company])),
    [companies],
  );
  const countryMap = useMemo(
    () => new Map((countries ?? []).map((country) => [country._id, country])),
    [countries],
  );

  if (!expenses || !categories || !users || !companies || !countries) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-44" />
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const activeCategories = categories.filter((category) => category.isActive);
  const summary = {
    draft: expenses.filter((expense) => expense.status === "draft").length,
    submitted: expenses.filter((expense) => expense.status === "submitted")
      .length,
    approved: expenses.filter((expense) => expense.status === "approved")
      .length,
    paid: expenses.filter((expense) => expense.status === "paid").length,
  };

  const filteredExpenses = expenses
    .filter((expense) => {
      if (statusFilter !== "all" && expense.status !== statusFilter)
        return false;
      if (categoryFilter !== "all" && expense.categoryId !== categoryFilter) {
        return false;
      }
      if (
        requesterFilter !== "all" &&
        expense.requestedBy !== requesterFilter
      ) {
        return false;
      }
      if (companyFilter !== "all" && expense.companyId !== companyFilter) {
        return false;
      }
      return true;
    })
    .sort(
      (a, b) => b.expenseDate - a.expenseDate || b.createdAt - a.createdAt,
    );

  const openExpense = (expenseId: Id<"expenseRequests">) => {
    navigate(`/finance/expenses/${expenseId}`);
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-1 text-muted-foreground">
            Request, approve, and track operational expenses.
          </p>
        </div>
        <Button
          className="bg-cyan-600 text-white hover:bg-cyan-700"
          onClick={() => setCreateOpen(true)}
          disabled={activeCategories.length === 0}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Expense
        </Button>
      </div>

      {activeCategories.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          No active expense categories are available. Ask CEO/HOB to create or
          seed categories.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Draft" value={summary.draft} />
        <SummaryCard title="Submitted" value={summary.submitted} />
        <SummaryCard title="Approved" value={summary.approved} />
        <SummaryCard title="Paid" value={summary.paid} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <SelectTrigger className="w-[190px]" aria-label="Filter by status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filter by category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category._id} value={category._id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={requesterFilter} onValueChange={setRequesterFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filter by requester">
            <SelectValue placeholder="All Requesters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Requesters</SelectItem>
            {users.map((user) => (
              <SelectItem key={user._id} value={user._id}>
                {userDisplay(user)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filter by company">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((company) => (
              <SelectItem key={company._id} value={company._id}>
                {company.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {expenses.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WalletCards />
            </EmptyMedia>
            <EmptyTitle>No expenses yet.</EmptyTitle>
            <EmptyDescription>
              Create a draft expense request when operational spending needs
              approval.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : filteredExpenses.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No matching expenses</EmptyTitle>
            <EmptyDescription>
              Adjust your filters to see expense requests.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium">Title</th>
                  <th className="p-3 text-left font-medium">Category</th>
                  <th className="p-3 text-right font-medium">Amount</th>
                  <th className="p-3 text-left font-medium">Requester</th>
                  <th className="p-3 text-left font-medium">Company/Country</th>
                  <th className="p-3 text-left font-medium">Status</th>
                  <th className="p-3 text-left font-medium">Expense Date</th>
                  <th className="p-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map((expense) => {
                  const company = expense.companyId
                    ? companyMap.get(expense.companyId)
                    : undefined;
                  const country = expense.countryId
                    ? countryMap.get(expense.countryId)
                    : undefined;
                  return (
                    <tr
                      key={expense._id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openExpense(expense._id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openExpense(expense._id);
                        }
                      }}
                      aria-label={`Open ${expense.title}`}
                    >
                      <td className="p-3 font-medium">{expense.title}</td>
                      <td className="p-3 text-muted-foreground">
                        {categoryMap.get(expense.categoryId)?.name ?? "-"}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {formatMoney(expense.amount, expense.currency)}
                      </td>
                      <td className="p-3">
                        {userDisplay(userMap.get(expense.requestedBy))}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {company?.name ?? country?.name ?? "-"}
                      </td>
                      <td className="p-3">{statusBadge(expense.status)}</td>
                      <td className="p-3 text-muted-foreground">
                        {formatDate(expense.expenseDate)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            openExpense(expense._id);
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewExpenseDialog
        open={createOpen}
        pending={pendingCreate}
        categories={activeCategories}
        companies={companies}
        countries={countries}
        currentUser={currentUser}
        onOpenChange={setCreateOpen}
        onSubmit={async (values) => {
          setPendingCreate(true);
          try {
            const expenseId = await createExpense(values);
            toast.success("Expense draft created");
            setCreateOpen(false);
            navigate(`/finance/expenses/${expenseId}`);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to create expense",
            );
          } finally {
            setPendingCreate(false);
          }
        }}
      />
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function NewExpenseDialog({
  open,
  pending,
  categories,
  companies,
  countries,
  currentUser,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  categories: Doc<"expenseCategories">[];
  companies: Doc<"companies">[];
  countries: Doc<"countries">[];
  currentUser: Doc<"users"> | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    title: string;
    categoryId: Id<"expenseCategories">;
    amount: number;
    currency?: string;
    expenseDate: number;
    vendor?: string;
    companyId?: Id<"companies">;
    countryId?: Id<"countries">;
    description?: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [expenseDate, setExpenseDate] = useState(todayInputValue());
  const [vendor, setVendor] = useState("");
  const [companyId, setCompanyId] = useState("none");
  const isGlobal =
    currentUser?.organizationScope === "global" ||
    (currentUser?.organizationScope === undefined &&
      !currentUser?.countryId &&
      (currentUser?.role === "ceo" ||
        currentUser?.role === "head_of_business"));
  const [countryId, setCountryId] = useState(currentUser?.countryId ?? "");
  const [description, setDescription] = useState("");
  const selectedCategory = categories.find(
    (category) => category._id === categoryId,
  );

  const resetForm = () => {
    setTitle("");
    setCategoryId("");
    setAmount("");
    setCurrency("USD");
    setExpenseDate(todayInputValue());
    setVendor("");
    setCompanyId("none");
    setCountryId(currentUser?.countryId ?? "");
    setDescription("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    const timestamp = dateInputToTimestamp(expenseDate);
    if (!title.trim()) {
      toast.error("Expense title is required");
      return;
    }
    if (!categoryId) {
      toast.error("Please select an expense category");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast.error("Expense amount must be positive");
      return;
    }
    if (!timestamp) {
      toast.error("Expense date is required");
      return;
    }
    if (!countryId) {
      toast.error("Please select the expense country");
      return;
    }
    await onSubmit({
      title: title.trim(),
      categoryId: categoryId as Id<"expenseCategories">,
      amount: numericAmount,
      currency: currency.trim() || "USD",
      expenseDate: timestamp,
      vendor: vendor.trim() || undefined,
      companyId:
        companyId === "none" ? undefined : (companyId as Id<"companies">),
      countryId: countryId as Id<"countries">,
      description: description.trim() || undefined,
    });
    resetForm();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        onOpenChange(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Expense</DialogTitle>
        </DialogHeader>
        {categories.length === 0 ? (
          <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            No active expense categories are available. Ask CEO/HOB to create or
            seed categories.
          </p>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="expense-title">Title</Label>
                <Input
                  id="expense-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Customer visit transport"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger aria-label="Expense category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category._id} value={category._id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCategory?.requiresReceipt ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    This category requires a receipt before the expense can be
                    submitted or approved.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-date">Expense date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-amount">Amount</Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-currency">Currency</Label>
                <Input
                  id="expense-currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expense-vendor">Vendor</Label>
                <Input
                  id="expense-vendor"
                  value={vendor}
                  onChange={(event) => setVendor(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                {isGlobal ? (
                  <Select
                    value={countryId}
                    onValueChange={(value) => {
                      setCountryId(value);
                      setCompanyId("none");
                    }}
                  >
                    <SelectTrigger aria-label="Expense country">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map((country) => (
                        <SelectItem key={country._id} value={country._id}>
                          {country.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={
                      countries.find(
                        (country) => country._id === currentUser?.countryId,
                      )?.name ?? "Country assignment required"
                    }
                    disabled
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger aria-label="Expense company">
                    <SelectValue placeholder="No company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No company</SelectItem>
                    {companies
                      .filter((company) => company.countryId === countryId)
                      .map((company) => (
                        <SelectItem key={company._id} value={company._id}>
                          {company.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="expense-description">Description</Label>
                <Textarea
                  id="expense-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional context for approval"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-cyan-600 text-white hover:bg-cyan-700"
                disabled={pending}
              >
                {pending ? "Saving..." : "Save Draft"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
