import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2 } from "lucide-react";
import {
  useImportStore,
  type DuplicateResolution,
} from "./use-import-store";

interface StepDuplicatesProps {
  eventId: Id<"events">;
}

export function StepDuplicates({ eventId }: StepDuplicatesProps) {
  const validGuests = useImportStore((s) => s.validGuests);
  const dbDuplicates = useImportStore((s) => s.dbDuplicates);
  const setDbDuplicates = useImportStore((s) => s.setDbDuplicates);
  const duplicateResolutions = useImportStore((s) => s.duplicateResolutions);
  const setResolution = useImportStore((s) => s.setResolution);
  const bulkSetResolution = useImportStore((s) => s.bulkSetResolution);
  const nextStep = useImportStore((s) => s.nextStep);

  const [hasChecked, setHasChecked] = useState(false);

  // Get all phone numbers from valid guests
  const phones = validGuests.map((g) => g.phone);

  // Query for duplicates
  const duplicateResult = useQuery(
    api.guests.checkDuplicatePhones,
    phones.length > 0 ? { eventId, phones } : "skip",
  );

  // Process duplicate results once
  useEffect(() => {
    if (duplicateResult === undefined || hasChecked) return;

    if (duplicateResult.length === 0) {
      setDbDuplicates([]);
      setHasChecked(true);
      // Auto-advance to confirm step if no duplicates
      nextStep();
      return;
    }

    // Build DbDuplicate objects
    const dupes = duplicateResult.map((dup) => {
      const newRow = validGuests.find((g) => g.phone === dup.phone);
      return {
        phone: dup.phone,
        newName: newRow?.name ?? "",
        newRow: newRow!,
        existingGuestId: dup.existingGuestId,
        existingName: dup.existingName,
      };
    });

    setDbDuplicates(dupes);
    setHasChecked(true);
  }, [duplicateResult, hasChecked, validGuests, setDbDuplicates, nextStep]);

  if (duplicateResult === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        <span className="ml-2 text-sm text-muted-foreground">
          Checking for duplicates...
        </span>
      </div>
    );
  }

  if (dbDuplicates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <CheckCircle2 className="size-8 text-success" />
        <p className="text-sm font-medium">No duplicates found</p>
        <p className="text-sm text-muted-foreground">
          All guests are new to this event.
        </p>
      </div>
    );
  }

  const resolutionOptions: Array<{
    value: DuplicateResolution;
    label: string;
  }> = [
    { value: "skip", label: "Skip" },
    { value: "replace", label: "Replace" },
    { value: "keepBoth", label: "Keep Both" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">
          {dbDuplicates.length} duplicates found
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          These phone numbers already exist in this event. Choose how to handle
          each one.
        </p>
      </div>

      {/* Bulk actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => bulkSetResolution("skip")}
        >
          Skip All Duplicates
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => bulkSetResolution("replace")}
        >
          Replace All with New Data
        </Button>
      </div>

      {/* Duplicate table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Phone</TableHead>
            <TableHead>Existing Guest</TableHead>
            <TableHead>New Data</TableHead>
            <TableHead className="w-48">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dbDuplicates.map((dup) => (
            <TableRow key={dup.phone}>
              <TableCell className="font-mono text-sm">{dup.phone}</TableCell>
              <TableCell>{dup.existingName}</TableCell>
              <TableCell>{dup.newName}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {resolutionOptions.map((opt) => (
                    <Button
                      key={opt.value}
                      variant={
                        duplicateResolutions[dup.phone] === opt.value
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setResolution(dup.phone, opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Summary */}
      <div className="flex gap-3 text-sm text-muted-foreground">
        <span>
          Skip:{" "}
          <Badge variant="outline">
            {
              Object.values(duplicateResolutions).filter((r) => r === "skip")
                .length
            }
          </Badge>
        </span>
        <span>
          Replace:{" "}
          <Badge variant="outline">
            {
              Object.values(duplicateResolutions).filter(
                (r) => r === "replace",
              ).length
            }
          </Badge>
        </span>
        <span>
          Keep Both:{" "}
          <Badge variant="outline">
            {
              Object.values(duplicateResolutions).filter(
                (r) => r === "keepBoth",
              ).length
            }
          </Badge>
        </span>
      </div>
    </div>
  );
}
