import { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { parseFile } from "@/lib/parse-file";
import { useImportStore } from "./use-import-store";

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx"];

export function StepUpload() {
  const file = useImportStore((s) => s.file);
  const totalRows = useImportStore((s) => s.totalRows);
  const headers = useImportStore((s) => s.headers);
  const setFileData = useImportStore((s) => s.setFileData);
  const reset = useImportStore((s) => s.reset);

  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (selectedFile: File) => {
      const ext = selectedFile.name
        .slice(selectedFile.name.lastIndexOf("."))
        .toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setError(
          "Unsupported file type. Please upload a .csv or .xlsx file.",
        );
        return;
      }

      setError(null);
      setIsParsing(true);
      try {
        const parsed = await parseFile(selectedFile);
        setFileData(selectedFile, parsed.headers, parsed.rows, parsed.totalRows);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not read file. Check that it is a valid CSV or Excel (.xlsx) file and try again.",
        );
      } finally {
        setIsParsing(false);
      }
    },
    [setFileData],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFile(droppedFile);
      }
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        handleFile(selectedFile);
      }
    },
    [handleFile],
  );

  const handleRemoveFile = useCallback(() => {
    reset();
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, [reset]);

  if (file) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <FileSpreadsheet className="size-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {totalRows} rows, {headers.length} columns
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRemoveFile}
            className="size-8"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : error
              ? "border-destructive bg-destructive/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
        )}
      >
        {isParsing ? (
          <div className="flex flex-col items-center gap-2">
            <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            <p className="text-sm text-muted-foreground">Reading file...</p>
          </div>
        ) : (
          <>
            <Upload className="mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              Drop your file here or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Supports .csv and .xlsx files
            </p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        onChange={handleInputChange}
        className="hidden"
      />

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
