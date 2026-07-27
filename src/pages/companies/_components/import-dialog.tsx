import { useState, useCallback } from "react";
import Papa from "papaparse";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner.tsx";

// Expected CSV column headers (case-insensitive, trimmed)
const EXPECTED_COLUMNS = [
  "company_name",
  "sector",
  "country",
  "account_manager",
  "contract_status",
  "website",
  "contact_name",
  "contact_email",
  "notes",
];

const VALID_STATUSES = ["active", "pending", "expired", "terminated"];

type RowError = {
  row: number;
  field: string;
  message: string;
};

type ValidatedRow = {
  row: number;
  name: string;
  sectorId: Id<"sectors">;
  countryId: Id<"countries">;
  accountManagerId: Id<"users">;
  contractStatus: "active" | "pending" | "expired" | "terminated";
  website?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  // For display in preview
  sectorName: string;
  countryName: string;
  amName: string;
};

type ImportState = "idle" | "preview" | "importing" | "done";

export default function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const users = useQuery(api.users.listAll, {});
  const existingCompanies = useQuery(api.companies.list, {});
  const bulkCreate = useMutation(api.companiesImport.bulkCreate);

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
      "company_name",
      "sector",
      "country",
      "account_manager",
      "contract_status",
      "website",
      "contact_name",
      "contact_email",
      "notes",
    ];
    const exampleRow = [
      "Acme Corp",
      "Technology",
      "United Kingdom",
      "john@example.com",
      "active",
      "https://acme.com",
      "John Smith",
      "john@acme.com",
      "Key enterprise client",
    ];
    const csv = [headers.join(","), exampleRow.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "companies_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = [".csv", ".txt"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!validTypes.includes(ext)) {
      setParseError("Please upload a CSV file (.csv)");
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setParseError("File size must be less than 5MB");
      return;
    }

    if (!countries || !sectors || !users || !existingCompanies) {
      setParseError("Still loading configuration data. Please try again.");
      return;
    }

    setParseError("");
    setErrors([]);
    setValidRows([]);

    // Create lookup maps (case-insensitive)
    const sectorByName = new Map(
      sectors.map((s) => [s.name.toLowerCase().trim(), s]),
    );
    const countryByName = new Map(
      countries.map((c) => [c.name.toLowerCase().trim(), c]),
    );
    // Existing company names for duplicate detection
    const existingCompanyNames = new Set(
      existingCompanies.map((c) => c.name.toLowerCase().trim()),
    );
    // Match AM by email or name (case-insensitive)
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

        // Validate required columns present
        const headers = results.meta.fields || [];
        const missingCols = ["company_name", "sector", "country", "account_manager", "contract_status"].filter(
          (col) => !headers.includes(col),
        );
        if (missingCols.length > 0) {
          setParseError(
            `Missing required columns: ${missingCols.join(", ")}. Download the template to see expected format.`,
          );
          return;
        }

        const rowErrors: RowError[] = [];
        const valid: ValidatedRow[] = [];

        results.data.forEach((row, index) => {
          const rowNum = index + 2; // 1-indexed + header
          const name = row.company_name?.trim();
          const sectorVal = row.sector?.trim();
          const countryVal = row.country?.trim();
          const amVal = row.account_manager?.trim();
          const statusVal = row.contract_status?.trim().toLowerCase();

          // Required field checks
          if (!name) {
            rowErrors.push({ row: rowNum, field: "company_name", message: "Company name is required" });
            return;
          }

          // Duplicate company check
          if (existingCompanyNames.has(name.toLowerCase())) {
            rowErrors.push({
              row: rowNum,
              field: "company_name",
              message: `"${name}" already exists in the database`,
            });
            return;
          }

          if (!sectorVal) {
            rowErrors.push({ row: rowNum, field: "sector", message: "Sector is required" });
            return;
          }

          if (!countryVal) {
            rowErrors.push({ row: rowNum, field: "country", message: "Country is required" });
            return;
          }

          if (!amVal) {
            rowErrors.push({ row: rowNum, field: "account_manager", message: "Account manager is required" });
            return;
          }

          if (!statusVal) {
            rowErrors.push({ row: rowNum, field: "contract_status", message: "Contract status is required" });
            return;
          }

          // Validate sector against existing list
          const sector = sectorByName.get(sectorVal.toLowerCase());
          if (!sector) {
            rowErrors.push({
              row: rowNum,
              field: "sector",
              message: `"${sectorVal}" does not match any configured sector`,
            });
            return;
          }

          // Validate country against existing list
          const country = countryByName.get(countryVal.toLowerCase());
          if (!country) {
            rowErrors.push({
              row: rowNum,
              field: "country",
              message: `"${countryVal}" does not match any configured country`,
            });
            return;
          }

          // Validate account manager (try email first, then name)
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

          // Validate contract status
          if (!VALID_STATUSES.includes(statusVal)) {
            rowErrors.push({
              row: rowNum,
              field: "contract_status",
              message: `"${statusVal}" is not valid. Use: active, pending, expired, or terminated`,
            });
            return;
          }

          valid.push({
            row: rowNum,
            name,
            sectorId: sector._id,
            countryId: country._id,
            accountManagerId: am._id,
            contractStatus: statusVal as "active" | "pending" | "expired" | "terminated",
            website: row.website?.trim() || undefined,
            contactName: row.contact_name?.trim() || undefined,
            contactEmail: row.contact_email?.trim() || undefined,
            notes: row.notes?.trim() || undefined,
            sectorName: sector.name,
            countryName: country.name,
            amName: am.name || am.email || "Unknown",
          });
        });

        setErrors(rowErrors);
        setValidRows(valid);
        setState("preview");
      },
      error: (error) => {
        setParseError(`Error reading file: ${error.message}`);
      },
    });

    // Reset input so same file can be re-uploaded
    event.target.value = "";
  };

  const handleImport = async () => {
    if (validRows.length === 0) return;

    setState("importing");
    try {
      const companiesData = validRows.map((r) => ({
        name: r.name,
        sectorId: r.sectorId,
        countryId: r.countryId,
        accountManagerId: r.accountManagerId,
        contractStatus: r.contractStatus,
        website: r.website,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        notes: r.notes,
      }));

      const count = await bulkCreate({ companies: companiesData });
      setImportedCount(count);
      setState("done");
      toast.success(`Successfully imported ${count} companies`);
    } catch (error) {
      setState("preview");
      const msg =
        error instanceof Error ? error.message : "Import failed";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state === "done" ? "Import Complete" : "Bulk Import Companies"}
          </DialogTitle>
          <DialogDescription>
            {state === "idle" &&
              "Upload a CSV file to bulk-import companies. Download the template to see the expected format."}
            {state === "preview" && "Review the data below before importing."}
            {state === "importing" && "Importing companies..."}
            {state === "done" &&
              `Successfully imported ${importedCount} companies.`}
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
                <li><code className="text-xs">company_name</code> — Company name</li>
                <li><code className="text-xs">sector</code> — Must match a configured sector exactly</li>
                <li><code className="text-xs">country</code> — Must match a configured country exactly</li>
                <li><code className="text-xs">account_manager</code> — Email or name of an existing user</li>
                <li><code className="text-xs">contract_status</code> — active, pending, expired, or terminated</li>
              </ul>
              <p className="font-medium text-foreground mt-3">Optional columns:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><code className="text-xs">website</code></li>
                <li><code className="text-xs">contact_name</code></li>
                <li><code className="text-xs">contact_email</code></li>
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

        {/* Preview: show valid rows + errors */}
        {state === "preview" && (
          <div className="space-y-4 py-2">
            {/* Summary badges */}
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

            {/* Errors */}
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

            {/* Valid rows preview table */}
            {validRows.length > 0 && (
              <div className="border rounded-md overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Row</th>
                      <th className="text-left px-3 py-2 font-medium">Company</th>
                      <th className="text-left px-3 py-2 font-medium">Sector</th>
                      <th className="text-left px-3 py-2 font-medium">Country</th>
                      <th className="text-left px-3 py-2 font-medium">AM</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.map((r) => (
                      <tr key={r.row} className="border-t">
                        <td className="px-3 py-1.5 text-muted-foreground">{r.row}</td>
                        <td className="px-3 py-1.5 font-medium">{r.name}</td>
                        <td className="px-3 py-1.5">{r.sectorName}</td>
                        <td className="px-3 py-1.5">{r.countryName}</td>
                        <td className="px-3 py-1.5">{r.amName}</td>
                        <td className="px-3 py-1.5 capitalize">{r.contractStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Actions */}
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
                  Import {validRows.length} {validRows.length === 1 ? "Company" : "Companies"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Importing spinner */}
        {state === "importing" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Spinner />
            <p className="text-sm text-muted-foreground">
              Importing {validRows.length} companies...
            </p>
          </div>
        )}

        {/* Done */}
        {state === "done" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              {importedCount} companies imported successfully.
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
