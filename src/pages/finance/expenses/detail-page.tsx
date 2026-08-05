import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, CreditCard, Pencil, Send, XCircle } from "lucide-react";
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
type ExpenseEvent = Doc<"expenseEvents">;
type ReasonAction = "reject" | "cancel" | null;

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

function eventLabel(type: ExpenseEvent["type"]) {
  switch (type) {
    case "marked_paid":
      return "Marked Paid";
    default:
      return type
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
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

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function timestampToDateInput(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToTimestamp(value: string) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).getTime();
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

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

export default function ExpenseDetailPage() {
  const navigate = useNavigate();
  const { expenseId } = useParams();
  const { currentUser } = useCrm();
  const expense = useQuery(
    api.expenses.getExpenseRequest,
    expenseId ? { expenseId: expenseId as Id<"expenseRequests"> } : "skip",
  );
  const events = useQuery(
    api.expenses.listExpenseEvents,
    expense ? { expenseId: expense._id } : "skip",
  );
  const categories = useQuery(api.expenses.listExpenseCategories, {});
  const users = useQuery(api.users.listAll, {});
  const companies = useQuery(api.companies.list, {});
  const countries = useQuery(api.countries.list, {});

  const updateDraft = useMutation(api.expenses.updateDraftExpenseRequest);
  const submitExpense = useMutation(api.expenses.submitExpenseRequest);
  const approveExpense = useMutation(api.expenses.approveExpenseRequest);
  const rejectExpense = useMutation(api.expenses.rejectExpenseRequest);
  const cancelExpense = useMutation(api.expenses.cancelExpenseRequest);
  const markPaid = useMutation(api.expenses.markExpensePaid);

  const [editOpen, setEditOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);
  const [reason, setReason] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const categoryMap = useMemo(
    () => new Map((categories ?? []).map((category) => [category._id, category])),
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

  if (
    expense === undefined ||
    events === undefined ||
    !categories ||
    !users ||
    !companies ||
    !countries ||
    currentUser === undefined
  ) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (expense === null) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate("/finance/expenses")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Expenses
        </Button>
        <Card>
          <CardContent className="p-8">
            <h1 className="text-xl font-semibold">Expense not found or unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This expense may not exist or may be outside your access scope.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isRequester = currentUser?._id === expense.requestedBy;
  const isAdmin = isAdminRole(currentUser?.role);
  const canEditDraft = expense.status === "draft" && (isRequester || isAdmin);
  const canSubmit = expense.status === "draft" && isRequester;
  const canApproveReject =
    expense.status === "submitted" &&
    (currentUser?.role === "country_gm" || isAdmin);
  const canCancel =
    !["rejected", "paid", "cancelled"].includes(expense.status) &&
    (isRequester || isAdmin);
  const canMarkPaid = expense.status === "approved" && isAdmin;
  const category = categoryMap.get(expense.categoryId);
  const company = expense.companyId ? companyMap.get(expense.companyId) : undefined;
  const country = expense.countryId ? countryMap.get(expense.countryId) : undefined;

  const handleSubmitExpense = async () => {
    setPendingAction("submit");
    try {
      await submitExpense({ expenseId: expense._id });
      toast.success("Expense submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit expense");
    } finally {
      setPendingAction(null);
    }
  };

  const handleApprove = async () => {
    setPendingAction("approve");
    try {
      await approveExpense({ expenseId: expense._id });
      toast.success("Expense approved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve expense");
    } finally {
      setPendingAction(null);
    }
  };

  const handleReasonAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim() || !reasonAction) {
      toast.error("Reason is required");
      return;
    }
    setPendingAction(reasonAction);
    try {
      if (reasonAction === "reject") {
        await rejectExpense({ expenseId: expense._id, reason: reason.trim() });
        toast.success("Expense rejected");
      } else {
        await cancelExpense({ expenseId: expense._id, reason: reason.trim() });
        toast.success("Expense cancelled");
      }
      setReasonAction(null);
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update expense");
    } finally {
      setPendingAction(null);
    }
  };

  const handleMarkPaid = async (event: FormEvent) => {
    event.preventDefault();
    setPendingAction("paid");
    try {
      await markPaid({
        expenseId: expense._id,
        paymentMethod: paymentMethod.trim() || undefined,
        paymentReference: paymentReference.trim() || undefined,
      });
      toast.success("Expense marked paid");
      setPaymentOpen(false);
      setPaymentMethod("");
      setPaymentReference("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to mark expense paid");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button
            variant="ghost"
            className="mb-3 -ml-2"
            onClick={() => navigate("/finance/expenses")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Expenses
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{expense.title}</h1>
            {statusBadge(expense.status)}
          </div>
          <p className="mt-1 text-muted-foreground">
            Operational expense request and approval history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditDraft ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Draft
            </Button>
          ) : null}
          {canSubmit ? (
            <Button
              className="bg-cyan-600 text-white hover:bg-cyan-700"
              onClick={() => void handleSubmitExpense()}
              disabled={pendingAction === "submit"}
            >
              <Send className="mr-2 h-4 w-4" />
              Submit
            </Button>
          ) : null}
          {canApproveReject ? (
            <>
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => void handleApprove()}
                disabled={pendingAction === "approve"}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Approve
              </Button>
              <Button
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setReasonAction("reject")}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </>
          ) : null}
          {canMarkPaid ? (
            <Button variant="outline" onClick={() => setPaymentOpen(true)}>
              <CreditCard className="mr-2 h-4 w-4" />
              Mark Paid
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => setReasonAction("cancel")}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Expense Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Category" value={category?.name} />
            <Detail
              label="Amount"
              value={formatMoney(expense.amount, expense.currency)}
            />
            <Detail
              label="Requester"
              value={userDisplay(userMap.get(expense.requestedBy))}
            />
            <Detail label="Company" value={company?.name} />
            <Detail label="Country" value={country?.name} />
            <Detail label="Expense Date" value={formatDate(expense.expenseDate)} />
            <Detail label="Vendor" value={expense.vendor} />
            <Detail label="Created" value={formatDateTime(expense.createdAt)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Submitted" value={formatDateTime(expense.submittedAt)} />
            <Detail
              label="Approved By"
              value={userDisplay(
                expense.approvedBy ? userMap.get(expense.approvedBy) : undefined,
              )}
            />
            <Detail
              label="Rejected By"
              value={userDisplay(
                expense.rejectedBy ? userMap.get(expense.rejectedBy) : undefined,
              )}
            />
            <Detail
              label="Paid By"
              value={userDisplay(
                expense.paidBy ? userMap.get(expense.paidBy) : undefined,
              )}
            />
            <Detail label="Payment Method" value={expense.paymentMethod} />
            <Detail label="Payment Reference" value={expense.paymentReference} />
          </CardContent>
        </Card>
      </div>

      {expense.description ? (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{expense.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Audit Events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event._id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">{eventLabel(event.type)}</span>
                    <span className="text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {event.message}{" "}
                    <span>
                      By {userDisplay(userMap.get(event.actorId))}.
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EditExpenseDialog
        open={editOpen}
        pending={pendingAction === "edit"}
        expense={expense}
        categories={categories.filter((category) => category.isActive)}
        companies={companies}
        onOpenChange={setEditOpen}
        onSubmit={async (values) => {
          setPendingAction("edit");
          try {
            await updateDraft({ expenseId: expense._id, ...values });
            toast.success("Expense draft updated");
            setEditOpen(false);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to update expense",
            );
          } finally {
            setPendingAction(null);
          }
        }}
      />

      <Dialog
        open={reasonAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReasonAction(null);
            setReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonAction === "reject" ? "Reject Expense" : "Cancel Expense"}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleReasonAction}>
            <div className="space-y-2">
              <Label htmlFor="expense-reason">Reason</Label>
              <Textarea
                id="expense-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this action is needed"
                rows={4}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReasonAction(null)}
                disabled={pendingAction === reasonAction}
              >
                Close
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={pendingAction === reasonAction}
              >
                {pendingAction === reasonAction ? "Saving..." : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Expense Paid</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleMarkPaid}>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="text-muted-foreground">Amount</div>
              <div className="mt-1 text-xl font-bold">
                {formatMoney(expense.amount, expense.currency)}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-method">Payment method</Label>
              <Input
                id="payment-method"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                placeholder="Bank Transfer, Mobile Money..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-reference">Payment reference</Label>
              <Input
                id="payment-reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="Receipt or transfer reference"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPaymentOpen(false)}
                disabled={pendingAction === "paid"}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-cyan-600 text-white hover:bg-cyan-700"
                disabled={pendingAction === "paid"}
              >
                {pendingAction === "paid" ? "Saving..." : "Mark Paid"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-medium">{value || "-"}</div>
    </div>
  );
}

function EditExpenseDialog({
  open,
  pending,
  expense,
  categories,
  companies,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  expense: Expense;
  categories: Doc<"expenseCategories">[];
  companies: Doc<"companies">[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    title: string;
    description?: string;
    categoryId: Id<"expenseCategories">;
    amount: number;
    currency?: string;
    expenseDate: number;
    vendor?: string;
    companyId?: Id<"companies">;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(expense.title);
  const [categoryId, setCategoryId] = useState(expense.categoryId as string);
  const [amount, setAmount] = useState(String(expense.amount));
  const [currency, setCurrency] = useState(expense.currency);
  const [expenseDate, setExpenseDate] = useState(
    timestampToDateInput(expense.expenseDate),
  );
  const [vendor, setVendor] = useState(expense.vendor ?? "");
  const [companyId, setCompanyId] = useState(expense.companyId ?? "none");
  const [description, setDescription] = useState(expense.description ?? "");

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
    await onSubmit({
      title: title.trim(),
      categoryId: categoryId as Id<"expenseCategories">,
      amount: numericAmount,
      currency: currency.trim() || "USD",
      expenseDate: timestamp,
      vendor: vendor.trim() || undefined,
      companyId:
        companyId === "none" ? undefined : (companyId as Id<"companies">),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Expense Draft</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="edit-expense-title">Title</Label>
              <Input
                id="edit-expense-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger aria-label="Edit expense category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category._id} value={category._id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-expense-date">Expense date</Label>
              <Input
                id="edit-expense-date"
                type="date"
                value={expenseDate}
                onChange={(event) => setExpenseDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-expense-amount">Amount</Label>
              <Input
                id="edit-expense-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-expense-currency">Currency</Label>
              <Input
                id="edit-expense-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-expense-vendor">Vendor</Label>
              <Input
                id="edit-expense-vendor"
                value={vendor}
                onChange={(event) => setVendor(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger aria-label="Edit expense company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company._id} value={company._id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="edit-expense-description">Description</Label>
              <Textarea
                id="edit-expense-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
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
      </DialogContent>
    </Dialog>
  );
}
