import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Pencil, Plus, Tags } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useCrm } from "@/lib/crm-context.tsx";

type ExpenseCategory = Doc<"expenseCategories">;

function isAdminRole(role: Doc<"users">["role"] | undefined) {
  return role === "ceo" || role === "head_of_business";
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

export default function ExpenseCategoriesPage() {
  const { currentUser } = useCrm();
  const canManage = isAdminRole(currentUser?.role);
  const categories = useQuery(api.expenses.listExpenseCategories, {
    includeInactive: canManage ? true : undefined,
  });
  const createCategory = useMutation(api.expenses.createExpenseCategory);
  const updateCategory = useMutation(api.expenses.updateExpenseCategory);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  const sortedCategories = useMemo(
    () =>
      [...(categories ?? [])].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [categories],
  );
  const summary = {
    active: sortedCategories.filter((category) => category.isActive).length,
    inactive: sortedCategories.filter((category) => !category.isActive).length,
    requiresReceipt: sortedCategories.filter((category) => category.requiresReceipt)
      .length,
  };

  const openCreate = () => {
    setEditingCategory(null);
    setDialogOpen(true);
  };

  const openEdit = (category: ExpenseCategory) => {
    setEditingCategory(category);
    setDialogOpen(true);
  };

  if (!categories || currentUser === undefined) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Expense Categories
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage operational expense categories and receipt rules.
          </p>
        </div>
        {canManage ? (
          <Button
            className="bg-cyan-600 text-white hover:bg-cyan-700"
            onClick={openCreate}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Category
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Category management is limited to CEO and Head of Business. You can
          view active categories only.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Active" value={summary.active} />
        <SummaryCard label="Inactive" value={summary.inactive} />
        <SummaryCard label="Requires Receipt" value={summary.requiresReceipt} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedCategories.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Tags className="h-6 w-6" />
                </EmptyMedia>
                <EmptyTitle>No expense categories yet.</EmptyTitle>
                <EmptyDescription>
                  CEO/HOB users can create categories for expense requests.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Code</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Requires Receipt</th>
                    <th className="px-3 py-3">Created</th>
                    <th className="px-3 py-3">Updated</th>
                    {canManage ? <th className="px-3 py-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {sortedCategories.map((category) => (
                    <tr key={category._id} className="border-b last:border-0">
                      <td className="px-3 py-3">
                        <div className="font-medium">{category.name}</div>
                        {category.description ? (
                          <div className="mt-1 max-w-sm text-xs text-muted-foreground">
                            {category.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {category.code || "-"}
                      </td>
                      <td className="px-3 py-3">
                        {category.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {category.requiresReceipt ? "Yes" : "No"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDateTime(category.createdAt)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDateTime(category.updatedAt)}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-3">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => openEdit(category)}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CategoryDialog
        open={dialogOpen}
        pending={pending}
        category={editingCategory}
        onOpenChange={setDialogOpen}
        onSubmit={async (values) => {
          setPending(true);
          try {
            if (editingCategory) {
              await updateCategory({
                categoryId: editingCategory._id,
                ...values,
              });
              toast.success("Expense category updated");
            } else {
              await createCategory(values);
              toast.success("Expense category created");
            }
            setDialogOpen(false);
            setEditingCategory(null);
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to save expense category",
            );
          } finally {
            setPending(false);
          }
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function CategoryDialog({
  open,
  pending,
  category,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  category: ExpenseCategory | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    name: string;
    code?: string;
    description?: string;
    isActive: boolean;
    requiresReceipt?: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [requiresReceipt, setRequiresReceipt] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setCode(category?.code ?? "");
    setDescription(category?.description ?? "");
    setIsActive(category?.isActive ?? true);
    setRequiresReceipt(category?.requiresReceipt ?? false);
  }, [category, open]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Category name is required");
      return;
    }
    await onSubmit({
      name: name.trim(),
      code: code.trim() || undefined,
      description: description.trim() || undefined,
      isActive,
      requiresReceipt,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {category ? "Edit Expense Category" : "New Expense Category"}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Travel"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-code">Code</Label>
            <Input
              id="category-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="TRAVEL"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional guidance for this category"
              rows={3}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="category-active">Active</Label>
              <Switch
                id="category-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="category-requires-receipt">
                Requires receipt
              </Label>
              <Switch
                id="category-requires-receipt"
                checked={requiresReceipt}
                onCheckedChange={setRequiresReceipt}
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
              {pending ? "Saving..." : "Save Category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
