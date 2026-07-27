import { useState, useCallback } from "react";
import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Download,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner.tsx";
import { STAGE_LABELS } from "../_lib/constants.ts";
import type { LeadStage } from "../_lib/constants.ts";

// Stage mapping: user-friendly label -> internal key
const STAGE_BY_LABEL = new Map(
  Object.entries(STAGE_LABELS).map(([key, label]) => [
    label.toLowerCase(),
    key as LeadStage,
  ]),
);
// Also allow direct internal keys
const VALID_STAGE_KEYS = new Set(Object.keys(STAGE_LABELS));

function resolveStage(input: string): LeadStage | null {
  const normalized = input.toLowerCase().trim();
  // Check label match first (e.g. "New Lead" -> "new_lead")
  const fromLabel = STAGE_BY_LABEL.get(normalized);
  if (fromLabel) return fromLabel;
  // Check direct key match (e.g. "new_lead")
  if (VALID_STAGE_KEYS.has(normalized)) return normalized as LeadStage;
  return null;
}

type RowError = {
  row: number;
  field: string;
  message: string;
};

type ValidatedRow = {
  row: number;
  title: string;
  companyId: Id<"companies">;
  accountManagerId: Id<"users">;
  stage: LeadStage;
  potentialValue: number;
  expectedCloseDate: string;
  nextAction?: string;
  notes?: string;
  // Display
  companyName: string;
  amName: string;
  stageLabel: string;
};

type ImportState = "idle" | "preview" | "importing" | "done";

export default function LeadImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const companies = useQuery(api.companies.list, {});
  const users = useQuery(api.users.listAll, {});
  const existingLeads = useQuery(api.leads.list, {});
  const bulkCreate = useMutation(api.leadsImport.bulkCreate);

  const [state, setState] = useState<ImportState>("idle");
  const [validRows, setValidRows] = useState<ValidatedRow[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [parseError, setParseError] = useState<string>("");
  const [importedCount, setImportedCount] = useState(0);

  const reset = useCallback(() => {
    setState("idle");
    setValidRows([]);
    setErrors([]);
    setParseError("");
    setImportedCount(0);
  }, []);

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const downloadTemplate = () => {
    const headers = [
      "lead_title",
      "company",
      "account_manager",
      "stage",
      "potential_value",
      "expected_close_date",
      "next_action",
      "notes",
    ];
    const exampleRow = [
      "Enterprise Deal Q3",
      "Acme Corp",
      "john@example.com",
      "New Lead",
      "50000",
      "2026-09-30",
      "Schedule discovery call",
      "Referral from partner",
    ];
    const csv = [headers.join(","), exampleRow.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (![".csv", ".txt"].includes(ext)) {
      setParseError("Please upload a CSV file (.csv)");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setParseError("File size must be less than 5MB");
      return;
    }

    if (!companies || !users || !existingLeads) {
      setParseError("Still loading data. Please try again.");
      return;
    }

    setParseError("");
    setErrors([]);
    setValidRows([]);

    // Build lookup maps
    const companyByName = new Map(
      companies.map((c) => [c.name.toLowerCase().trim(), c]),
    );
    const userByEmail = new Map(
      users
        .filter((u) => u.email)
        .map((u) => [u.email!.toLowerCase().trim(), u]),
    );
    const userByName = new Map(
      users
        .filter((u) => u.name)
        .map((u) => [u.name!.toLowerCase().trim(), u]),
    );

    // Existing lead title+company combinations for duplicate detection
    const existingLeadKeys = new Set(
      existingLeads.map((l) => {
        const company = companies.find((c) => c._id === l.companyId);
        const companyName = company?.name.toLowerCase().trim() || "";
        return `${l.title.toLowerCase().trim()}||${companyName}`;
      }),
    );

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) =>
        header
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, ""),
      complete: (results) => {
        if (results.errors.length > 0) {
          setParseError(
            `CSV parse error: ${results.errors[0].message} (row ${results.errors[0].row})`,
          );
          return;
        }

        const headers = results.meta.fields || [];
        const requiredCols = [
          "lead_title",
          "company",
          "account_manager",
          "stage",
          "potential_value",
          "expected_close_date",
        ];
        const missingCols = requiredCols.filter((col) => !headers.includes(col));
        if (missingCols.length > 0) {
          setParseError(
            `Missing required columns: ${missingCols.join(", ")}. Download the template to see expected format.`,
          );
          return;
        }

        const rowErrors: RowError[] = [];
        const valid: ValidatedRow[] = [];

        results.data.forEach((row, index) => {
          const rowNum = index + 2;
          const title = row.lead_title?.trim();
          const companyVal = row.company?.trim();
          const amVal = row.account_manager?.trim();
          const stageVal = row.stage?.trim();
          const valueStr = row.potential_value?.trim();
          const dateVal = row.expected_close_date?.trim();

          // Required checks
          if (!title) {
            rowErrors.push({ row: rowNum, field: "lead_title", message: "Lead title is required" });
            return;
          }
          if (!companyVal) {
            rowErrors.push({ row: rowNum, field: "company", message: "Company is required" });
            return;
          }
          if (!amVal) {
            rowErrors.push({ row: rowNum, field: "account_manager", message: "Account manager is required" });
            return;
          }
          if (!stageVal) {
            rowErrors.push({ row: rowNum, field: "stage", message: "Stage is required" });
            return;
          }
          if (!valueStr) {
            rowErrors.push({ row: rowNum, field: "potential_value", message: "Potential value is required" });
            return;
          }
          if (!dateVal) {
            rowErrors.push({ row: rowNum, field: "expected_close_date", message: "Expected close date is required" });
            return;
          }

          // Validate company
          const company = companyByName.get(companyVal.toLowerCase());
          if (!company) {
            rowErrors.push({
              row: rowNum,
              field: "company",
              message: `"${companyVal}" does not match any existing company`,
            });
            return;
          }

          // Duplicate lead check (title + company)
          const leadKey = `${title.toLowerCase()}||${companyVal.toLowerCase()}`;
          if (existingLeadKeys.has(leadKey)) {
            rowErrors.push({
              row: rowNum,
              field: "lead_title",
              message: `"${title}" for "${companyVal}" already exists`,
            });
            return;
          }

          // Validate account manager
          const am =
            userByEmail.get(amVal.toLowerCase()) ||
            userByName.get(amVal.toLowerCase());
          if (!am) {
            rowErrors.push({
              row: rowNum,
              field: "account_manager",
              message: `"${amVal}" does not match any user (by email or name)`,
            });
            return;
          }

          // Validate stage
          const stage = resolveStage(stageVal);
          if (!stage) {
            const validOptions = Object.values(STAGE_LABELS).join(", ");
            rowErrors.push({
              row: rowNum,
              field: "stage",
              message: `"${stageVal}" is not a valid stage. Use: ${validOptions}`,
            });
            return;
          }

          // Validate potential value
          const potentialValue = Number(valueStr.replace(/[,$]/g, ""));
          if (isNaN(potentialValue) || potentialValue < 0) {
            rowErrors.push({
              row: rowNum,
              field: "potential_value",
              message: "Must be a valid positive number",
            });
            return;
          }

          // Validate date format (YYYY-MM-DD)
          const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(dateVal);
          if (!dateMatch || isNaN(Date.parse(dateVal))) {
            rowErrors.push({
              row: rowNum,
              field: "expected_close_date",
              message: "Must be a valid date in YYYY-MM-DD format",
            });
            return;
          }

          // Also check for duplicates within the file itself
          const alreadyInBatch = valid.some(
            (v) =>
              v.title.toLowerCase() === title.toLowerCase() &&
              v.companyId === company._id,
          );
          if (alreadyInBatch) {
            rowErrors.push({
              row: rowNum,
              field: "lead_title",
              message: `Duplicate within file: "${title}" for "${companyVal}"`,
            });
            return;
          }

          valid.push({
            row: rowNum,
            title,
            companyId: company._id,
            accountManagerId: am._id,
            stage,
            potentialValue,
            expectedCloseDate: dateVal,
            nextAction: row.next_action?.trim() || undefined,
            notes: row.notes?.trim() || undefined,
            companyName: company.name,
            amName: am.name || am.email || "Unknown",
            stageLabel: STAGE_LABELS[stage],
          });

          // Add to dedup set so later rows in same file are caught
          existingLeadKeys.add(leadKey);
        });

        setErrors(rowErrors);
        setValidRows(valid);
        setState("preview");
      },
      error: (error) => {
        setParseError(`Error reading file: ${error.message}`);
      },
    });

    event.target.value = "";
  };

  const handleImport = async () => {
    if (validRows.length === 0) return;

    setState("importing");
    try {
      const leadsData = validRows.map((r) => ({
        title: r.title,
        companyId: r.companyId,
        accountManagerId: r.accountManagerId,
        stage: r.stage,
        potentialValue: r.potentialValue,
        expectedCloseDate: r.expectedCloseDate,
        nextAction: r.nextAction,
        notes: r.notes,
      }));

      const count = await bulkCreate({ leads: leadsData });
      setImportedCount(count);
      setState("done");
      toast.success(`Successfully imported ${count} leads`);
    } catch (error) {
      setState("preview");
      const msg = error instanceof Error ? error.message : "Import failed";
      toast.error(msg);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(value);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state === "done" ? "Import Complete" : "Bulk Import Leads"}
          </DialogTitle>
          <DialogDescription>
            {state === "idle" &&
              "Upload a CSV file to bulk-import leads. Download the template to see the expected format."}
            {state === "preview" && "Review the data below before importing."}
            {state === "importing" && "Importing leads..."}
            {state === "done" &&
              `Successfully imported ${importedCount} leads.`}
          </DialogDescription>
        </DialogHeader>

        {/* Idle: upload instructions */}
        {state === "idle" && (
          <div className="space-y-4 py-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={downloadTemplate}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download Template CSV
            </Button>

            <div className="text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Required columns:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><code className="text-xs">lead_title</code> — Name/title of the lead</li>
                <li><code className="text-xs">company</code> — Must match an existing company name exactly</li>
                <li><code className="text-xs">account_manager</code> — Email or name of an existing user</li>
                <li><code className="text-xs">stage</code> — New Lead, Qualified, Discovery, Proposal, Negotiation, Won, or Lost</li>
                <li><code className="text-xs">potential_value</code> — Numeric value (e.g. 50000)</li>
                <li><code className="text-xs">expected_close_date</code> — Date in YYYY-MM-DD format</li>
              </ul>
              <p className="font-medium text-foreground mt-3">Optional columns:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><code className="text-xs">next_action</code></li>
                <li><code className="text-xs">notes</code></li>
              </ul>
            </div>

            <div className="border-2 border-dashed border-muted rounded-lg p-6 text-center">
              <FileSpreadsheet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                Choose a CSV file to upload
              </p>
              <Input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="max-w-xs mx-auto"
              />
            </div>

            {parseError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{parseError}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview */}
        {state === "preview" && (
          <div className="space-y-4 py-2">
            <div className="flex gap-3 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                {validRows.length} valid {validRows.length === 1 ? "row" : "rows"}
              </Badge>
              {errors.length > 0 && (
                <Badge variant="secondary" className="gap-1 text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.length} {errors.length === 1 ? "error" : "errors"}
                </Badge>
              )}
            </div>

            {errors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 max-h-40 overflow-y-auto">
                <p className="text-sm font-medium text-destructive mb-1">
                  Rows with errors (will be skipped):
                </p>
                <ul className="text-sm text-destructive space-y-0.5">
                  {errors.map((err, i) => (
                    <li key={i}>
                      Row {err.row}: <strong>{err.field}</strong> — {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {validRows.length > 0 && (
              <div className="border rounded-md overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Row</th>
                      <th className="text-left px-3 py-2 font-medium">Lead Title</th>
                      <th className="text-left px-3 py-2 font-medium">Company</th>
                      <th className="text-left px-3 py-2 font-medium">AM</th>
                      <th className="text-left px-3 py-2 font-medium">Stage</th>
                      <th className="text-right px-3 py-2 font-medium">Value</th>
                      <th className="text-left px-3 py-2 font-medium">Close Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((r) => (
                      <tr key={r.row} className="border-t">
                        <td className="px-3 py-1.5 text-muted-foreground">{r.row}</td>
                        <td className="px-3 py-1.5 font-medium">{r.title}</td>
                        <td className="px-3 py-1.5">{r.companyName}</td>
                        <td className="px-3 py-1.5">{r.amName}</td>
                        <td className="px-3 py-1.5">{r.stageLabel}</td>
                        <td className="px-3 py-1.5 text-right">{formatCurrency(r.potentialValue)}</td>
                        <td className="px-3 py-1.5">{r.expectedCloseDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={reset}>
                Upload Different File
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleClose(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={validRows.length === 0}
                  onClick={handleImport}
                >
                  Import {validRows.length} {validRows.length === 1 ? "Lead" : "Leads"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Importing */}
        {state === "importing" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Spinner />
            <p className="text-sm text-muted-foreground">
              Importing {validRows.length} leads...
            </p>
          </div>
        )}

        {/* Done */}
        {state === "done" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              {importedCount} leads imported successfully.
            </p>
            <Button size="sm" onClick={() => handleClose(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
