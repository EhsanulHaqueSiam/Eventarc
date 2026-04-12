import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { autoDetectColumns } from "@/lib/parse-file";
import { useImportStore } from "./use-import-store";

const MAPPING_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "phone", label: "Phone" },
  { value: "category", label: "Category" },
  { value: "skip", label: "Skip" },
] as const;

export function StepMapColumns() {
  const headers = useImportStore((s) => s.headers);
  const rawRows = useImportStore((s) => s.rawRows);
  const columnMapping = useImportStore((s) => s.columnMapping);
  const setColumnMapping = useImportStore((s) => s.setColumnMapping);

  // Auto-detect columns on mount if mapping is empty
  useEffect(() => {
    if (Object.keys(columnMapping).length === 0 && headers.length > 0) {
      const detected = autoDetectColumns(headers);
      setColumnMapping(detected);
    }
  }, [headers, columnMapping, setColumnMapping]);

  const handleMappingChange = (
    columnIndex: number,
    value: "name" | "phone" | "category" | "skip",
  ) => {
    setColumnMapping({ ...columnMapping, [columnIndex]: value });
  };

  const previewRows = rawRows.slice(0, 5);
  const mappedValues = Object.values(columnMapping);
  const hasName = mappedValues.includes("name");
  const hasPhone = mappedValues.includes("phone");

  // Get mapped column indices for preview
  const nameIdx = Object.entries(columnMapping).find(
    ([, v]) => v === "name",
  )?.[0];
  const phoneIdx = Object.entries(columnMapping).find(
    ([, v]) => v === "phone",
  )?.[0];
  const categoryIdx = Object.entries(columnMapping).find(
    ([, v]) => v === "category",
  )?.[0];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Map Columns</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Match your file columns to guest fields. Name and Phone are required.
        </p>
      </div>

      {/* Column mapping */}
      <div className="space-y-3">
        {headers.map((header, i) => (
          <div
            key={i}
            className="flex items-center gap-3"
          >
            <span className="w-40 truncate text-sm font-medium">{header}</span>
            <span className="text-muted-foreground">&rarr;</span>
            <Select
              value={columnMapping[i] ?? "skip"}
              onValueChange={(val) =>
                handleMappingChange(
                  i,
                  val as "name" | "phone" | "category" | "skip",
                )
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAPPING_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {!hasName && (
        <p className="text-sm text-destructive">
          Please map a column to &quot;Name&quot;
        </p>
      )}
      {!hasPhone && (
        <p className="text-sm text-destructive">
          Please map a column to &quot;Phone&quot;
        </p>
      )}

      {/* Preview table */}
      {previewRows.length > 0 && hasName && hasPhone && (
        <div>
          <h4 className="mb-2 text-sm font-medium">
            Preview (first 5 rows)
          </h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                {categoryIdx !== undefined && <TableHead>Category</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row, rowIdx) => (
                <TableRow key={rowIdx}>
                  <TableCell>
                    {nameIdx !== undefined ? row[Number(nameIdx)] : ""}
                  </TableCell>
                  <TableCell>
                    {phoneIdx !== undefined ? row[Number(phoneIdx)] : ""}
                  </TableCell>
                  {categoryIdx !== undefined && (
                    <TableCell>
                      <Badge variant="secondary">
                        {row[Number(categoryIdx)] || "—"}
                      </Badge>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
