import { useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id, Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { toast } from "sonner";
import { Upload, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import Papa from "papaparse";
import {
  SERVICE_TYPES,
  matchServiceType,
  isValidMonth,
} from "../_lib/constants.ts";
import { formatCurrency } from "@/lib/format.ts";

type ImportRow = {
  company: string;
  month: string;
  usage_date?: string;
  service_type: string;
  amount: string;
};

type ValidatedRow = {
  companyId: Id<"companies">;
  companyName: string;
  month: string;
  usageDate?: string;
  serviceType: string;
  amount: number;
  errors: string[];
};

type UsageImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function UsageImportDialog({
  open,
  onOpenChange,
}: UsageImportDialogProps) {
  const companies = useQuery(api.companies.list, {});
  const bulkCreate = useMutation(api.consumption.bulkCreate);

  const [rows, setRows] = useState<ValidatedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companies) return;

    setParsing(true);
    Papa.parse<ImportRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const validated = result.data.map((row) => validateRow(row, companies));
        setRows(validated);
        setParsing(false);
      },
      error: () => {
        toast.error("Failed to parse CSV file");
        setParsing(false);
      },
    });
  };

  const validateRow = (
    row: ImportRow,
    companiesList: Doc<"companies">[],
  ): ValidatedRow => {
    const errors: string[] = [];

    // Match company
    const companyName = (row.company || "").trim();
    const matchedCompany = companiesList.find(
      (c) => c.name.toLowerCase() === companyName.toLowerCase(),
    );
    if (!matchedCompany) {
      errors.push(`Company "${companyName}" not found`);
    }

    // Validate month
    const month = (row.month || "").trim();
    if (!isValidMonth(month)) {
      errors.push(`Invalid month "${month}" (use YYYY-MM)`);
    }
    const usageDate = (row.usage_date || "").trim() || undefined;
    if (
      usageDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(usageDate) ||
        usageDate.slice(0, 7) !== month)
    ) {
      errors.push(`Invalid usage date "${row.usage_date}"`);
    }

    // Validate service type
    const serviceInput = (row.service_type || "").trim();
    const matchedService = matchServiceType(serviceInput);
    if (!matchedService) {
      errors.push(`Unknown service "${serviceInput}"`);
    }

    // Validate amount
    const cleanAmount = (row.amount || "").replace(/[$,]/g, "").trim();
    const numAmount = parseFloat(cleanAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      errors.push(`Invalid amount "${row.amount}"`);
    }

    return {
      companyId: (matchedCompany?._id || "") as Id<"companies">,
      companyName: matchedCompany?.name || companyName,
      month,
      usageDate,
      serviceType: matchedService || serviceInput,
      amount: isNaN(numAmount) ? 0 : numAmount,
      errors,
    };
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const errorRows = rows.filter((r) => r.errors.length > 0);

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      await bulkCreate({
        entries: validRows.map((r) => ({
          companyId: r.companyId,
          month: r.month,
          usageDate: r.usageDate,
          serviceType: r.serviceType,
          amount: r.amount,
        })),
      });
      toast.success(`Imported ${validRows.length} usage entries`);
      setRows([]);
      onOpenChange(false);
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = Papa.unparse({
      fields: ["company", "month", "service_type", "amount"],
      data: [
        ["Acme Corp", "2026-07", "ECS", "1500.00"],
        ["Beta Inc", "2026-07", "OBS", "320.50"],
      ],
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "usage_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Usage Data (CSV)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" />
              Download Template
            </Button>
            <p className="text-xs text-muted-foreground">
              Columns: company, month (YYYY-MM), service_type, amount
            </p>
          </div>

          <div className="text-xs text-muted-foreground">
            Valid services: {SERVICE_TYPES.join(", ")}
          </div>

          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-2">
              Choose a CSV file to upload
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="hidden"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
            >
              {parsing ? "Parsing..." : "Select File"}
            </Button>
          </div>

          {/* Preview */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge
                  variant="secondary"
                  className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  {validRows.length} valid
                </Badge>
                {errorRows.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {errorRows.length} errors
                  </Badge>
                )}
              </div>

              <div className="overflow-x-auto max-h-60 overflow-y-auto border rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Company</th>
                      <th className="text-left p-2">Month</th>
                      <th className="text-left p-2">Service</th>
                      <th className="text-right p-2">Amount</th>
                      <th className="text-left p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((row, i) => (
                      <tr
                        key={i}
                        className={
                          row.errors.length > 0
                            ? "bg-red-50 dark:bg-red-900/10"
                            : ""
                        }
                      >
                        <td className="p-2">{row.companyName}</td>
                        <td className="p-2">{row.month}</td>
                        <td className="p-2">{row.serviceType}</td>
                        <td className="p-2 text-right">
                          {formatCurrency(row.amount)}
                        </td>
                        <td className="p-2">
                          {row.errors.length > 0 ? (
                            <span className="text-destructive">
                              {row.errors.join("; ")}
                            </span>
                          ) : (
                            <span className="text-emerald-600">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 50 of {rows.length} rows
                </p>
              )}

              <Button
                className="w-full"
                disabled={validRows.length === 0 || importing}
                onClick={handleImport}
              >
                {importing
                  ? "Importing..."
                  : `Import ${validRows.length} Entries`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
