import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useConvex, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Download,
  Paperclip,
  Pencil,
  Send,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog.tsx";
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
type ExpenseReceipt = Doc<"expenseReceipts">;
type ReasonAction = "reject" | "cancel" | null;
type FinanceSettings = {
  countryApprovalLimit: number;
  businessApprovalLimit: number;
  currency: string;
};
type ApprovalLevel = "country" | "business" | "executive";

const APPROVAL_LEVEL_LABELS: Record<ApprovalLevel, string> = {
  country: "Country Approval",
  business: "Business Approval",
  executive: "Executive Approval",
};
const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const RECEIPT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.xls,.xlsx,.doc,.docx";

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

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function userDisplay(user?: Doc<"users">) {
  return user?.name || user?.email || "Unknown user";
}

function actionUserDisplay(
  userId: Id<"users"> | undefined,
  userMap: Map<Id<"users">, Doc<"users">>,
) {
  if (!userId) return "-";
  return userDisplay(userMap.get(userId));
}

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function approvalLevelForAmount(
  amount: number,
  settings: FinanceSettings,
): ApprovalLevel {
  if (amount <= settings.countryApprovalLimit) {
    return "country";
  }
  if (amount <= settings.businessApprovalLimit) {
    return "business";
  }
  return "executive";
}

function canApproveForLevel(
  currentUser: Doc<"users"> | null,
  expense: Expense,
  approvalLevel: ApprovalLevel,
) {
  if (!currentUser) return false;
  if (isAdminRole(currentUser.role)) return true;
  return (
    approvalLevel === "country" &&
    currentUser.role === "country_gm" &&
    !!currentUser.countryId &&
    expense.countryId === currentUser.countryId
  );
}

function canArchiveReceipt(
  currentUser: Doc<"users"> | null,
  receipt: ExpenseReceipt,
) {
  if (!currentUser) return false;
  return (
    receipt.uploadedBy === currentUser._id || isAdminRole(currentUser.role)
  );
}

export default function ExpenseDetailPage() {
  const navigate = useNavigate();
  const { expenseId } = useParams();
  const { currentUser } = useCrm();
  const convex = useConvex();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const expense = useQuery(
    api.expenses.getExpenseRequest,
    expenseId ? { expenseId: expenseId as Id<"expenseRequests"> } : "skip",
  );
  const events = useQuery(
    api.expenses.listExpenseEvents,
    expense ? { expenseId: expense._id } : "skip",
  );
  const receipts = useQuery(
    api.expenses.listReceipts,
    expense ? { expenseId: expense._id } : "skip",
  );
  const financeSettings = useQuery(api.expenses.getFinanceSettings, {});
  const categories = useQuery(api.expenses.listExpenseCategories, {});
  const users = useQuery(api.users.listAll, {});
  const companies = useQuery(api.companies.list, {});
  const countries = useQuery(api.countries.list, {});
  const fundingAccounts = useQuery(api.receivingAccounts.list, {
    purpose: "outgoing",
  });

  const updateDraft = useMutation(api.expenses.updateDraftExpenseRequest);
  const submitExpense = useMutation(api.expenses.submitExpenseRequest);
  const approveExpense = useMutation(api.expenses.approveExpenseRequest);
  const rejectExpense = useMutation(api.expenses.rejectExpenseRequest);
  const cancelExpense = useMutation(api.expenses.cancelExpenseRequest);
  const markPaid = useMutation(api.expenses.markExpensePaid);
  const archiveExpense = useMutation(api.expenses.archiveExpenseRequest);
  const generateReceiptUploadUrl = useMutation(
    api.expenses.generateReceiptUploadUrl,
  );
  const saveReceiptMetadata = useMutation(api.expenses.saveReceiptMetadata);
  const archiveReceipt = useMutation(api.expenses.archiveReceipt);

  const [editOpen, setEditOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);
  const [reason, setReason] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [fundingAccountId, setFundingAccountId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentTransactionId, setPaymentTransactionId] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pendingReceiptAction, setPendingReceiptAction] = useState<
    string | null
  >(null);

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

  if (
    expense === undefined ||
    events === undefined ||
    receipts === undefined ||
    financeSettings === undefined ||
    !categories ||
    !users ||
    !companies ||
    !countries ||
    !fundingAccounts ||
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
        <Button
          variant="ghost"
          className="-ml-2"
          onClick={() => navigate("/finance/expenses")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Expenses
        </Button>
        <Card>
          <CardContent className="p-8">
            <h1 className="text-xl font-semibold">
              Expense not found or unavailable
            </h1>
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
  const approvalLevel = approvalLevelForAmount(expense.amount, financeSettings);
  const canEditDraft = expense.status === "draft" && (isRequester || isAdmin);
  const canSubmit = expense.status === "draft" && isRequester;
  const canApproveReject =
    expense.status === "submitted" &&
    canApproveForLevel(currentUser, expense, approvalLevel);
  const canCancel =
    !["rejected", "paid", "cancelled"].includes(expense.status) &&
    (isRequester || isAdmin);
  const canMarkPaid = expense.status === "approved" && isAdmin;
  const canDelete = isAdmin;
  const category = categoryMap.get(expense.categoryId);
  const receiptRequired = category?.requiresReceipt === true;
  const company = expense.companyId
    ? companyMap.get(expense.companyId)
    : undefined;
  const country = expense.countryId
    ? countryMap.get(expense.countryId)
    : undefined;
  const expenseCountryId = expense.countryId ?? company?.countryId;
  const eligibleFundingAccounts = fundingAccounts.filter(
    (account) =>
      account.currency === expense.currency &&
      account.countryId === expenseCountryId,
  );

  const handleSubmitExpense = async () => {
    setPendingAction("submit");
    try {
      await submitExpense({ expenseId: expense._id });
      toast.success("Expense submitted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to submit expense",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleApprove = async (event: FormEvent) => {
    event.preventDefault();
    if (!fundingAccountId) {
      toast.error("Select the account that will fund this expense");
      return;
    }
    setPendingAction("approve");
    try {
      await approveExpense({
        expenseId: expense._id,
        fundingAccountId: fundingAccountId as Id<"receivingAccounts">,
      });
      toast.success("Expense approved");
      setApprovalOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to approve expense",
      );
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
      toast.error(
        error instanceof Error ? error.message : "Failed to update expense",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleMarkPaid = async (event: FormEvent) => {
    event.preventDefault();
    if (!paymentTransactionId.trim()) {
      toast.error("Payment transaction ID is required");
      return;
    }
    if (!expense.fundingAccountId && !fundingAccountId) {
      toast.error("Select the funding account for this legacy expense");
      return;
    }
    setPendingAction("paid");
    try {
      await markPaid({
        expenseId: expense._id,
        paymentReference: paymentReference.trim() || undefined,
        paymentTransactionId: paymentTransactionId.trim(),
        fundingAccountId: expense.fundingAccountId
          ? undefined
          : (fundingAccountId as Id<"receivingAccounts">),
      });
      toast.success("Expense marked paid");
      setPaymentOpen(false);
      setPaymentReference("");
      setPaymentTransactionId("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to mark expense paid",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const validateReceiptFile = (file: File) => {
    if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.type)) {
      toast.error("This file type is not allowed for expense receipts");
      return false;
    }
    if (file.size > MAX_RECEIPT_SIZE_BYTES) {
      toast.error("Receipts must be 10 MB or less");
      return false;
    }
    return true;
  };

  const handleUploadReceipt = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !validateReceiptFile(file)) return;

    setPendingReceiptAction("upload");
    try {
      const uploadUrl = await generateReceiptUploadUrl({});
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error("Receipt upload failed");
      }
      const { storageId } = (await uploadResponse.json()) as {
        storageId: Id<"_storage">;
      };
      await saveReceiptMetadata({
        expenseId: expense._id,
        storageId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });
      toast.success("Receipt uploaded");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload receipt",
      );
    } finally {
      setPendingReceiptAction(null);
    }
  };

  const handleDownloadReceipt = async (receiptId: Id<"expenseReceipts">) => {
    setPendingReceiptAction(`${receiptId}:download`);
    try {
      const url = await convex.query(api.expenses.getReceiptDownloadUrl, {
        receiptId,
      });
      if (!url) {
        throw new Error("Receipt download URL is unavailable");
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to download receipt",
      );
    } finally {
      setPendingReceiptAction(null);
    }
  };

  const handleArchiveReceipt = async (receiptId: Id<"expenseReceipts">) => {
    setPendingReceiptAction(`${receiptId}:archive`);
    try {
      await archiveReceipt({ receiptId });
      toast.success("Receipt removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove receipt",
      );
    } finally {
      setPendingReceiptAction(null);
    }
  };

  const handleDeleteExpense = async () => {
    setPendingAction("delete");
    try {
      await archiveExpense({
        expenseId: expense._id,
        reason: "Deleted from CRM expense detail page",
      });
      toast.success("Expense deleted");
      navigate("/finance/expenses");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete expense",
      );
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
            <h1 className="text-2xl font-bold tracking-tight">
              {expense.title}
            </h1>
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
                onClick={() => setApprovalOpen(true)}
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
          {canDelete ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={pendingAction === "delete"}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the expense from CRM lists and keeps an audit
                    event for production cleanup.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void handleDeleteExpense()}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
            {receiptRequired ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200 sm:col-span-2">
                Receipt required: upload at least one active receipt before this
                expense can be submitted or approved.
              </div>
            ) : null}
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
            <Detail
              label="Expense Date"
              value={formatDate(expense.expenseDate)}
            />
            <Detail label="Vendor" value={expense.vendor} />
            <Detail label="Created" value={formatDateTime(expense.createdAt)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail
              label="Approval Level"
              value={APPROVAL_LEVEL_LABELS[approvalLevel]}
            />
            <Detail
              label="Submitted"
              value={formatDateTime(expense.submittedAt)}
            />
            <Detail
              label="Approved By"
              value={actionUserDisplay(expense.approvedBy, userMap)}
            />
            <Detail
              label="Funding Account"
              value={expense.fundingAccountName}
            />
            <Detail
              label="Rejected By"
              value={actionUserDisplay(expense.rejectedBy, userMap)}
            />
            <Detail
              label="Paid By"
              value={actionUserDisplay(expense.paidBy, userMap)}
            />
            <Detail label="Payment Method" value={expense.paymentMethod} />
            <Detail
              label="Payment Reference"
              value={expense.paymentReference}
            />
          </CardContent>
        </Card>
      </div>

      {expense.description ? (
        <Card>
          <CardHeader>
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {expense.description}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Receipts
              <Badge variant="secondary" className="text-xs">
                {receipts.length}
              </Badge>
            </span>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept={RECEIPT_ACCEPT}
                className="hidden"
                onChange={(event) => void handleUploadReceipt(event)}
                aria-label="Upload expense receipt"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pendingReceiptAction === "upload"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                {pendingReceiptAction === "upload"
                  ? "Uploading..."
                  : "Upload Receipt"}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {receiptRequired && receipts.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              This expense category requires a receipt. Upload a receipt before
              submitting or approving this expense.
            </div>
          ) : null}
          {receipts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              No receipts uploaded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {receipts.map((receipt) => {
                const uploader = userMap.get(receipt.uploadedBy);
                const canRemove = canArchiveReceipt(currentUser, receipt);

                return (
                  <div
                    key={receipt._id}
                    className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {receipt.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {receipt.mimeType} - {formatFileSize(receipt.size)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Uploaded by{" "}
                        {uploader?.name || uploader?.email || "Team member"} -{" "}
                        {formatDateTime(receipt.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={
                          pendingReceiptAction === `${receipt._id}:download`
                        }
                        onClick={() => void handleDownloadReceipt(receipt._id)}
                      >
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Download
                      </Button>
                      {canRemove ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              disabled={
                                pendingReceiptAction ===
                                `${receipt._id}:archive`
                              }
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Remove
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent size="sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Remove this receipt?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the receipt from this expense and
                                keeps an audit event.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  void handleArchiveReceipt(receipt._id)
                                }
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                    <span className="font-medium">
                      {eventLabel(event.type)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {event.message}{" "}
                    <span>By {userDisplay(userMap.get(event.actorId))}.</span>
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

      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Expense</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleApprove}>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="text-muted-foreground">Approved amount</div>
              <div className="mt-1 text-xl font-bold">
                {formatMoney(expense.amount, expense.currency)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Pay from account</Label>
              <Select
                value={fundingAccountId}
                onValueChange={setFundingAccountId}
              >
                <SelectTrigger aria-label="Pay from account">
                  <SelectValue placeholder="Select funding account" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleFundingAccounts.map((account) => (
                    <SelectItem key={account._id} value={account._id}>
                      {account.name} · {account.accountNumber} (
                      {account.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligibleFundingAccounts.length === 0 ? (
                <p className="text-xs text-destructive">
                  No active {expense.currency} expense account is configured.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setApprovalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!fundingAccountId || pendingAction === "approve"}
              >
                {pendingAction === "approve"
                  ? "Approving..."
                  : "Approve Expense"}
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
            <div className="rounded-lg border p-3 text-sm">
              <div className="text-muted-foreground">Pay from</div>
              <div className="mt-1 font-medium">
                {expense.fundingAccountName}
              </div>
              <div className="text-xs text-muted-foreground">
                {expense.fundingProviderName} · {expense.fundingAccountNumber}
              </div>
            </div>
            {!expense.fundingAccountId ? (
              <div className="space-y-2">
                <Label>Pay from account</Label>
                <Select
                  value={fundingAccountId}
                  onValueChange={setFundingAccountId}
                >
                  <SelectTrigger aria-label="Legacy funding account">
                    <SelectValue placeholder="Select funding account" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleFundingAccounts.map((account) => (
                      <SelectItem key={account._id} value={account._id}>
                        {account.name} · {account.accountNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required because this expense was approved before account
                  selection was introduced.
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="payment-transaction-id">Transaction ID</Label>
              <Input
                id="payment-transaction-id"
                value={paymentTransactionId}
                onChange={(event) =>
                  setPaymentTransactionId(event.target.value)
                }
                placeholder="Bank, wallet, or cash voucher reference"
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
                disabled={
                  pendingAction === "paid" ||
                  !paymentTransactionId.trim() ||
                  (!expense.fundingAccountId && !fundingAccountId)
                }
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
  const selectedCategory = categories.find(
    (category) => category._id === categoryId,
  );

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
              {selectedCategory?.requiresReceipt ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  This category requires a receipt before the expense can be
                  submitted or approved.
                </p>
              ) : null}
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
