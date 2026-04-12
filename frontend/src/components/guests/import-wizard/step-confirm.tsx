import { useState, useMemo, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useImportStore } from "./use-import-store";

const CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface StepConfirmProps {
  eventId: Id<"events">;
}

export function StepConfirm({ eventId }: StepConfirmProps) {
  const validGuests = useImportStore((s) => s.validGuests);
  const dbDuplicates = useImportStore((s) => s.dbDuplicates);
  const duplicateResolutions = useImportStore((s) => s.duplicateResolutions);
  const importProgress = useImportStore((s) => s.importProgress);
  const setImportProgress = useImportStore((s) => s.setImportProgress);
  const importResult = useImportStore((s) => s.importResult);
  const setImportResult = useImportStore((s) => s.setImportResult);

  const [isImporting, setIsImporting] = useState(false);

  const importBatch = useMutation(api.guests.importBatch);
  const replaceGuest = useMutation(api.guests.replaceGuest);
  const categories = useQuery(api.categories.listByEvent, { eventId });

  // Compute guests to import (excluding skipped duplicates)
  const { guestsToImport, guestsToReplace, skippedCount } = useMemo(() => {
    const skipPhones = new Set<string>();
    const replacePhones = new Map<string, string>(); // phone -> existingGuestId

    for (const dup of dbDuplicates) {
      const resolution = duplicateResolutions[dup.phone];
      if (resolution === "skip") {
        skipPhones.add(dup.phone);
      } else if (resolution === "replace") {
        replacePhones.set(dup.phone, dup.existingGuestId);
      }
      // keepBoth: include in normal import
    }

    const toImport = validGuests.filter(
      (g) => !skipPhones.has(g.phone) && !replacePhones.has(g.phone),
    );
    const toReplace = validGuests.filter((g) => replacePhones.has(g.phone));

    return {
      guestsToImport: toImport,
      guestsToReplace: toReplace,
      skippedCount: skipPhones.size,
    };
  }, [validGuests, dbDuplicates, duplicateResolutions]);

  const totalToProcess = guestsToImport.length + guestsToReplace.length;

  // Resolve category name to ID
  const resolveCategoryId = useCallback(
    (categoryName: string): Id<"guestCategories"> | null => {
      if (!categories || categories.length === 0) return null;
      if (!categoryName.trim()) {
        // Use default category
        const defaultCat = categories.find((c) => c.isDefault);
        return defaultCat?._id ?? categories[0]._id;
      }
      const match = categories.find(
        (c) => c.name.toLowerCase() === categoryName.toLowerCase(),
      );
      return match?._id ?? categories.find((c) => c.isDefault)?._id ?? categories[0]._id;
    },
    [categories],
  );

  const handleImport = useCallback(async () => {
    if (!categories || categories.length === 0) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: totalToProcess });

    let totalInserted = 0;
    let totalErrors = 0;
    let processed = 0;

    try {
      // Handle replacements first
      for (const guest of guestsToReplace) {
        const dup = dbDuplicates.find((d) => d.phone === guest.phone);
        if (dup) {
          try {
            await replaceGuest({
              guestId: dup.existingGuestId as Id<"guests">,
              name: guest.name,
              phone: guest.phone,
              categoryId:
                resolveCategoryId(guest.categoryName) ??
                (categories.find((c) => c.isDefault)?._id ?? categories[0]._id),
            });
            totalInserted++;
          } catch {
            totalErrors++;
          }
        }
        processed++;
        setImportProgress({ current: processed, total: totalToProcess });
      }

      // Chunked batch import for new guests
      const chunks = chunkArray(guestsToImport, CHUNK_SIZE);
      for (const chunk of chunks) {
        const result = await importBatch({
          eventId,
          guests: chunk.map((g) => ({
            name: g.name,
            phone: g.phone,
            categoryId:
              resolveCategoryId(g.categoryName) ??
              (categories.find((c) => c.isDefault)?._id ?? categories[0]._id),
          })),
        });
        totalInserted += result.inserted;
        totalErrors += result.errors.length;
        processed += chunk.length;
        setImportProgress({ current: processed, total: totalToProcess });
      }

      setImportResult({
        totalInserted,
        totalErrors,
        totalSkipped: skippedCount,
      });
    } catch {
      setImportResult({
        totalInserted,
        totalErrors: totalErrors + 1,
        totalSkipped: skippedCount,
      });
    } finally {
      setIsImporting(false);
    }
  }, [
    categories,
    totalToProcess,
    guestsToReplace,
    guestsToImport,
    dbDuplicates,
    replaceGuest,
    importBatch,
    eventId,
    resolveCategoryId,
    skippedCount,
    setImportProgress,
    setImportResult,
  ]);

  // Import complete
  if (importResult) {
    const allSuccess = importResult.totalErrors === 0;
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        {allSuccess ? (
          <CheckCircle2 className="size-12 text-success" />
        ) : (
          <AlertTriangle className="size-12 text-warning" />
        )}

        <div className="text-center">
          {allSuccess ? (
            <p className="text-lg font-medium">
              {importResult.totalInserted} guests imported successfully.
            </p>
          ) : (
            <p className="text-lg font-medium">
              {importResult.totalInserted} imported, {importResult.totalErrors}{" "}
              failed. Download error report.
            </p>
          )}
          {importResult.totalSkipped > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {importResult.totalSkipped} duplicates skipped.
            </p>
          )}
        </div>

        <Button asChild>
          <Link to="/events/$eventId/guests" params={{ eventId }}>
            Go to Guest List
          </Link>
        </Button>
      </div>
    );
  }

  // Importing in progress
  if (isImporting && importProgress) {
    const percent = Math.round(
      (importProgress.current / importProgress.total) * 100,
    );
    return (
      <div className="space-y-4 py-8">
        <div className="text-center">
          <p className="text-sm font-medium">
            Importing {importProgress.current} of {importProgress.total}{" "}
            guests...
          </p>
        </div>
        <Progress value={percent}>
          <ProgressLabel>Importing guests</ProgressLabel>
          <ProgressValue />
        </Progress>
      </div>
    );
  }

  // Pre-import summary
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Ready to Import</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Review the summary below, then confirm to start importing.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>New guests to import</span>
          <Badge variant="secondary">{guestsToImport.length}</Badge>
        </div>
        {guestsToReplace.length > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span>Existing guests to replace</span>
            <Badge variant="secondary">{guestsToReplace.length}</Badge>
          </div>
        )}
        {skippedCount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Duplicates to skip
            </span>
            <Badge variant="outline">{skippedCount}</Badge>
          </div>
        )}
        <div className="border-t pt-2 flex items-center justify-between text-sm font-medium">
          <span>Total to process</span>
          <Badge>{totalToProcess}</Badge>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleImport}
          disabled={totalToProcess === 0 || !categories}
        >
          Confirm Import
        </Button>
      </div>
    </div>
  );
}
