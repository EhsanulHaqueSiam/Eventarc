import { create } from "zustand";

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface MappedGuest {
  name: string;
  phone: string; // Normalized to 01XXXXXXXXX
  categoryName: string; // Raw from CSV, resolved to categoryId later
  originalRowIndex: number;
}

export interface ValidationError {
  rowIndex: number;
  originalRow: string[];
  errors: string[];
}

export interface DbDuplicate {
  phone: string;
  newName: string;
  newRow: MappedGuest;
  existingGuestId: string;
  existingName: string;
}

export type DuplicateResolution = "skip" | "replace" | "keepBoth";

export interface ImportResult {
  totalInserted: number;
  totalErrors: number;
  totalSkipped: number;
}

interface ImportWizardState {
  // Navigation
  step: WizardStep;
  setStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;

  // Step 1: Upload
  file: File | null;
  headers: string[];
  rawRows: string[][];
  totalRows: number;
  setFileData: (
    file: File,
    headers: string[],
    rows: string[][],
    totalRows: number,
  ) => void;

  // Step 2: Column Mapping
  columnMapping: Record<number, "name" | "phone" | "category" | "skip">;
  setColumnMapping: (
    mapping: Record<number, "name" | "phone" | "category" | "skip">,
  ) => void;

  // Step 3: Validation
  validGuests: MappedGuest[];
  validationErrors: ValidationError[];
  intraFileDuplicates: Array<{ phone: string; rowIndices: number[] }>;
  setValidationResults: (
    valid: MappedGuest[],
    errors: ValidationError[],
    intraFileDupes: Array<{ phone: string; rowIndices: number[] }>,
  ) => void;

  // Step 4: Duplicate Resolution
  dbDuplicates: DbDuplicate[];
  setDbDuplicates: (dupes: DbDuplicate[]) => void;
  duplicateResolutions: Record<string, DuplicateResolution>; // keyed by phone
  setResolution: (phone: string, resolution: DuplicateResolution) => void;
  bulkSetResolution: (resolution: DuplicateResolution) => void;

  // Step 5: Import Progress
  importProgress: { current: number; total: number } | null;
  setImportProgress: (
    progress: { current: number; total: number } | null,
  ) => void;
  importResult: ImportResult | null;
  setImportResult: (result: ImportResult | null) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  step: 1 as WizardStep,
  file: null as File | null,
  headers: [] as string[],
  rawRows: [] as string[][],
  totalRows: 0,
  columnMapping: {} as Record<number, "name" | "phone" | "category" | "skip">,
  validGuests: [] as MappedGuest[],
  validationErrors: [] as ValidationError[],
  intraFileDuplicates: [] as Array<{ phone: string; rowIndices: number[] }>,
  dbDuplicates: [] as DbDuplicate[],
  duplicateResolutions: {} as Record<string, DuplicateResolution>,
  importProgress: null as { current: number; total: number } | null,
  importResult: null as ImportResult | null,
};

export const useImportStore = create<ImportWizardState>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),
  nextStep: () =>
    set((s) => ({ step: Math.min(s.step + 1, 5) as WizardStep })),
  prevStep: () =>
    set((s) => ({ step: Math.max(s.step - 1, 1) as WizardStep })),

  setFileData: (file, headers, rawRows, totalRows) =>
    set({ file, headers, rawRows, totalRows }),

  setColumnMapping: (columnMapping) => set({ columnMapping }),

  setValidationResults: (validGuests, validationErrors, intraFileDuplicates) =>
    set({ validGuests, validationErrors, intraFileDuplicates }),

  setDbDuplicates: (dbDuplicates) => {
    const resolutions: Record<string, DuplicateResolution> = {};
    for (const dupe of dbDuplicates) {
      resolutions[dupe.phone] = "skip";
    }
    set({ dbDuplicates, duplicateResolutions: resolutions });
  },

  setResolution: (phone, resolution) =>
    set((s) => ({
      duplicateResolutions: { ...s.duplicateResolutions, [phone]: resolution },
    })),

  bulkSetResolution: (resolution) =>
    set((s) => {
      const resolutions: Record<string, DuplicateResolution> = {};
      for (const phone of Object.keys(s.duplicateResolutions)) {
        resolutions[phone] = resolution;
      }
      return { duplicateResolutions: resolutions };
    }),

  setImportProgress: (importProgress) => set({ importProgress }),
  setImportResult: (importResult) => set({ importResult }),

  reset: () => set(initialState),
}));
