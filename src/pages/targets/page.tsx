import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { toast } from "sonner";
import { Plus, Target, ShieldAlert } from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const QUARTERS = [1, 2, 3, 4] as const;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function TargetsPage() {
  const { isAdmin } = useCrm();
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);
  const targets = useQuery(api.salesTargets.getByYear, { year: selectedYear });
  const users = useQuery(api.users.listAll, {});

  if (!targets || !users) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Only CEO and Head of Business can manage sales targets.
          </p>
        </div>
      </div>
    );
  }

  const accountManagers = users.filter(
    (u) =>
      u.role === "account_manager" ||
      u.role === "country_gm" ||
      u.role === "head_of_business" ||
      u.role === "ceo",
  );
  const assignableAccountManagers = accountManagers.filter(
    (u) => u.isDisabled !== true,
  );

  // Group targets by AM
  const targetsByAm = new Map<string, Doc<"salesTargets">[]>();
  for (const t of targets) {
    if (!t.accountManagerId) {
      continue;
    }
    const existing = targetsByAm.get(t.accountManagerId) || [];
    existing.push(t);
    targetsByAm.set(t.accountManagerId, existing);
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales Targets</h1>
          <p className="text-muted-foreground mt-1">
            Set quarterly targets for each account manager
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={selectedYear.toString()}
            onValueChange={(v) => setSelectedYear(Number(v))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={y.toString()}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AddTargetDialog
            accountManagers={assignableAccountManagers}
            year={selectedYear}
          />
        </div>
      </div>

      {accountManagers.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No team members with roles assigned yet. Assign roles in the Team page.
        </p>
      ) : (
        <div className="space-y-4">
          {accountManagers.map((am) => {
            const amTargets = targetsByAm.get(am._id) || [];
            const yearlyTotal = amTargets.reduce((s, t) => s + t.target, 0);

            return (
              <Card key={am._id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        {am.name || "Unnamed"}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Yearly total: {formatCurrency(yearlyTotal)}
                      </p>
                    </div>
                    <Target className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    {QUARTERS.map((q) => {
                      const target = amTargets.find((t) => t.quarter === q);
                      return (
                        <QuarterTargetCell
                          key={q}
                          quarter={q}
                          target={target}
                          accountManagerId={am._id}
                          year={selectedYear}
                        />
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuarterTargetCell({
  quarter,
  target,
  accountManagerId,
  year,
}: {
  quarter: 1 | 2 | 3 | 4;
  target: Doc<"salesTargets"> | undefined;
  accountManagerId: Id<"users">;
  year: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(target?.target?.toString() || "");
  const upsert = useMutation(api.salesTargets.upsert);

  const handleSave = async () => {
    const numVal = Number(value);
    if (isNaN(numVal) || numVal < 0) {
      toast.error("Please enter a valid target amount");
      return;
    }
    try {
      await upsert({
        accountManagerId,
        year,
        quarter,
        target: numVal,
      });
      toast.success(`Q${quarter} target saved`);
      setEditing(false);
    } catch {
      toast.error("Failed to save target");
    }
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <Label className="text-xs">Q{quarter}</Label>
        <Input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
          className="h-8 text-sm"
          min="0"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
        />
        <div className="flex gap-1">
          <Button size="sm" className="h-6 text-xs flex-1" onClick={handleSave}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => {
        setValue(target?.target?.toString() || "");
        setEditing(true);
      }}
    >
      <div className="text-xs text-muted-foreground mb-1">Q{quarter}</div>
      <div className="font-semibold text-sm">
        {target ? formatCurrency(target.target) : "—"}
      </div>
    </div>
  );
}

function AddTargetDialog({
  accountManagers,
  year,
}: {
  accountManagers: Doc<"users">[];
  year: number;
}) {
  const [open, setOpen] = useState(false);
  const [amId, setAmId] = useState<string>("");
  const [quarter, setQuarter] = useState<string>("1");
  const [target, setTarget] = useState("");
  const upsert = useMutation(api.salesTargets.upsert);

  const handleSave = async () => {
    if (!amId) {
      toast.error("Select an account manager");
      return;
    }
    const numVal = Number(target);
    if (isNaN(numVal) || numVal < 0) {
      toast.error("Enter a valid target amount");
      return;
    }
    try {
      await upsert({
        accountManagerId: amId as Id<"users">,
        year,
        quarter: Number(quarter) as 1 | 2 | 3 | 4,
        target: numVal,
      });
      toast.success("Target saved");
      setOpen(false);
      setAmId("");
      setTarget("");
    } catch {
      toast.error("Failed to save target");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Set Target
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Sales Target</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Account Manager</Label>
            <Select value={amId} onValueChange={setAmId}>
              <SelectTrigger>
                <SelectValue placeholder="Select person" />
              </SelectTrigger>
              <SelectContent>
                {accountManagers.map((u) => (
                  <SelectItem key={u._id} value={u._id}>
                    {u.name || u.email || "Unnamed"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Q1</SelectItem>
                  <SelectItem value="2">Q2</SelectItem>
                  <SelectItem value="3">Q3</SelectItem>
                  <SelectItem value="4">Q4</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Target (USD)</Label>
              <Input
                type="number"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="100000"
                min="0"
              />
            </div>
          </div>
          <Button className="w-full" onClick={handleSave}>
            Save Target
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
