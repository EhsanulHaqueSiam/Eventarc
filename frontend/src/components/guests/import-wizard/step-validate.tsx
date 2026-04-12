import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { normalizePhone, validateBDPhone } from "@/lib/phone";
import { downloadErrorCsv } from "@/lib/parse-file";
import {
  useImportStore,
  type MappedGuest,
  type ValidationError,
} from "./use-import-store";

export function StepValidate() {
  const headers = useImportStore((s) => s.headers);
  const rawRows = useImportStore((s) => s.rawRows);
  const columnMapping = useImportStore((s) => s.columnMapping);
  const validGuests = useImportStore((s) => s.validGuests);
  const validationErrors = useImportStore((s) => s.validationErrors);
  const intraFileDuplicates = useImportStore((s) => s.intraFileDuplicates);
  const setValidationResults = useImportStore((s) => s.setValidationResults);

  // Find column indices
  const nameIdx = useMemo(
    () =>
      Number(
        Object.entries(columnMapping).find(([, v]) => v === "name")?.[0] ?? -1,
      ),
    [columnMapping],
  );
  const phoneIdx = useMemo(
    () =>
      Number(
        Object.entries(columnMapping).find(([, v]) => v === "phone")?.[0] ?? -1,
      ),
    [columnMapping],
  );
  const categoryIdx = useMemo(
    () =>
      Number(
        Object.entries(columnMapping).find(([, v]) => v === "category")?.[0] ??
          -1,
      ),
    [columnMapping],
  );

  // Run validation on mount
  useEffect(() => {
    if (validGuests.length > 0 || validationErrors.length > 0) return;

    const valid: MappedGuest[] = [];
    const errors: ValidationError[] = [];
    const phoneMap = new Map<string, number[]>(); // normalized phone -> row indices

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const name = nameIdx >= 0 ? (row[nameIdx] ?? "").trim() : "";
      const phone = phoneIdx >= 0 ? (row[phoneIdx] ?? "").trim() : "";
      const category =
        categoryIdx >= 0 ? (row[categoryIdx] ?? "").trim() : "";
      const rowErrors: string[] = [];

      if (!name) {
        rowErrors.push("Name is required");
      } else if (name.length > 200) {
        rowErrors.push("Name must be under 200 characters");
      }

      if (!phone) {
        rowErrors.push("Phone is required");
      } else if (!validateBDPhone(phone)) {
        rowErrors.push(
          "Invalid Bangladesh phone number. Expected: 01XXXXXXXXX or +8801XXXXXXXXX",
        );
      }

      if (rowErrors.length > 0) {
        errors.push({
          rowIndex: i,
          originalRow: row,
          errors: rowErrors,
        });
        continue;
      }

      const normalized = normalizePhone(phone);
      if (!normalized) {
        errors.push({
          rowIndex: i,
          originalRow: row,
          errors: ["Failed to normalize phone number"],
        });
        continue;
      }

      // Track for intra-file duplicate detection
      const existing = phoneMap.get(normalized);
      if (existing) {
        existing.push(i);
      } else {
        phoneMap.set(normalized, [i]);
      }

      valid.push({
        name,
        phone: normalized,
        categoryName: category,
        originalRowIndex: i,
      });
    }

    // Detect intra-file duplicates
    const intraFileDupes: Array<{ phone: string; rowIndices: number[] }> = [];
    for (const [phone, indices] of phoneMap.entries()) {
      if (indices.length > 1) {
        intraFileDupes.push({ phone, rowIndices: indices });
      }
    }

    // Deduplicate: keep only the first occurrence of each phone
    const seenPhones = new Set<string>();
    const deduped: MappedGuest[] = [];
    for (const guest of valid) {
      if (!seenPhones.has(guest.phone)) {
        seenPhones.add(guest.phone);
        deduped.push(guest);
      }
    }

    setValidationResults(deduped, errors, intraFileDupes);
  }, [
    rawRows,
    nameIdx,
    phoneIdx,
    categoryIdx,
    validGuests.length,
    validationErrors.length,
    setValidationResults,
  ]);

  const handleDownloadErrors = () => {
    downloadErrorCsv(headers, validationErrors);
  };

  const totalProcessed = validGuests.length + validationErrors.length;
  const hasErrors = validationErrors.length > 0;
  const hasDuplicates = intraFileDuplicates.length > 0;

  // Group errors by type
  const errorGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const err of validationErrors) {
      for (const msg of err.errors) {
        groups.set(msg, (groups.get(msg) ?? 0) + 1);
      }
    }
    return Array.from(groups.entries());
  }, [validationErrors]);

  if (totalProcessed === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        <span className="ml-2 text-sm text-muted-foreground">
          Validating rows...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-4">
          {hasErrors ? (
            <AlertTriangle className="size-5 text-warning" />
          ) : (
            <CheckCircle2 className="size-5 text-success" />
          )}
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-success/10 text-success">
              {validGuests.length} valid
            </Badge>
            {hasErrors && (
              <Badge
                variant="secondary"
                className="bg-destructive/10 text-destructive"
              >
                {validationErrors.length} with errors
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Error breakdown */}
      {hasErrors && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {validationErrors.length} rows have errors. Download the error
            report to fix them, then re-import the failed rows.
          </p>
          <div className="space-y-1">
            {errorGroups.map(([msg, count]) => (
              <div
                key={msg}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">{msg}</span>
                <Badge variant="outline">{count}</Badge>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={handleDownloadErrors}>
            <Download className="mr-2 size-4" />
            Download Error Report
          </Button>
        </div>
      )}

      {/* Intra-file duplicates warning */}
      {hasDuplicates && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 text-warning" />
            <div>
              <p className="text-sm font-medium">
                {intraFileDuplicates.length} phone numbers appear multiple
                times in your file
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Only the first occurrence of each will be imported.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Success state */}
      {!hasErrors && !hasDuplicates && (
        <p className="text-sm text-muted-foreground">
          All {validGuests.length} rows passed validation. Click Next to check
          for duplicates in your event.
        </p>
      )}
    </div>
  );
}
