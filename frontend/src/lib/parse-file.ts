export interface ParsedFile {
  headers: string[];
  rows: string[][]; // Each row is array of cell values as strings
  totalRows: number;
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const XLSX = await import("xlsx");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!firstSheet) {
          reject(new Error("No sheets found in file"));
          return;
        }

        // Get raw data as 2D array of strings
        const rawData: string[][] = XLSX.utils.sheet_to_json(firstSheet, {
          header: 1,
          defval: "",
          raw: false,
        });

        if (rawData.length < 2) {
          reject(
            new Error(
              "File must contain a header row and at least one data row",
            ),
          );
          return;
        }

        const headers = rawData[0].map((h) => String(h).trim());
        const rows = rawData
          .slice(1)
          .filter((row) => row.some((cell) => String(cell).trim() !== ""));

        resolve({
          headers,
          rows: rows.map((row) => row.map((cell) => String(cell).trim())),
          totalRows: rows.length,
        });
      } catch {
        reject(
          new Error(
            "Could not read file. Check that it is a valid CSV or Excel (.xlsx) file and try again.",
          ),
        );
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/** Auto-detect column mapping from headers */
export function autoDetectColumns(
  headers: string[],
): Record<number, "name" | "phone" | "category" | "skip"> {
  const mapping: Record<number, "name" | "phone" | "category" | "skip"> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase());

  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    if (/\bname\b/.test(h)) {
      const alreadyMappedName = Object.values(mapping).includes("name");
      mapping[i] = alreadyMappedName ? "skip" : "name";
    } else if (/\b(phone|mobile|cell|number)\b/.test(h)) {
      const alreadyMappedPhone = Object.values(mapping).includes("phone");
      mapping[i] = alreadyMappedPhone ? "skip" : "phone";
    } else if (/\b(category|group|type)\b/.test(h)) {
      const alreadyMappedCategory =
        Object.values(mapping).includes("category");
      mapping[i] = alreadyMappedCategory ? "skip" : "category";
    } else {
      mapping[i] = "skip";
    }
  }

  return mapping;
}

/** Export error rows as downloadable CSV */
export function downloadErrorCsv(
  headers: string[],
  errorRows: Array<{
    rowIndex: number;
    originalRow: string[];
    errors: string[];
  }>,
): void {
  const csvHeaders = [...headers, "Errors"];
  const csvRows = errorRows.map((r) => [
    ...r.originalRow,
    r.errors.join("; "),
  ]);
  const csvContent = [csvHeaders, ...csvRows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}
