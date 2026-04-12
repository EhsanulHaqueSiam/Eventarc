import { create } from "zustand";

export type ScanState =
  | "idle"
  | "scanned"
  | "reviewing"
  | "confirming"
  | "flash"
  | "confirmed"
  | "dismissed"
  | "ready";

export type ScanOutcome =
  | "allowed"
  | "served"
  | "denied"
  | "duplicate_entry"
  | "duplicate_food";

export interface ScanResult {
  qrPayload: string;
  decodedAt: number;
}

export interface ServerResponse {
  outcome: ScanOutcome;
  guestName?: string;
  guestCategory?: string;
  foodCategory?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  reason?: string;
  originalCheckIn?: { time: string; stall: string };
  consumptionHistory?: Array<{ stall: string; time: string }>;
}

export interface ScanStore {
  state: ScanState;
  scanResult: ScanResult | null;
  serverResponse: ServerResponse | null;
  scanCount: number;

  onQrDetected: (qrPayload: string) => void;
  onFlashComplete: () => void;
  onConfirm: (
    sessionToken: string,
    stallId: string,
    vendorTypeId: string,
  ) => Promise<void>;
  onDismiss: () => void;
  onScanNext: () => void;
  reset: () => void;
}

function parseEntryResponse(data: Record<string, unknown>): ServerResponse {
  const status = data.status as string;
  if (status === "allowed") {
    const guest = data.guest as { name?: string; category?: string } | undefined;
    return {
      outcome: "allowed",
      guestName: guest?.name,
      guestCategory: guest?.category,
    };
  }
  if (status === "duplicate") {
    const guest = data.guest as { name?: string; category?: string } | undefined;
    const original = data.originalCheckIn as
      | { time?: string; stall?: string }
      | undefined;
    return {
      outcome: "duplicate_entry",
      guestName: guest?.name,
      guestCategory: guest?.category,
      originalCheckIn: original
        ? { time: original.time ?? "", stall: original.stall ?? "" }
        : undefined,
    };
  }
  return {
    outcome: "denied",
    reason: (data.reason as string) ?? "Entry rejected",
  };
}

function parseFoodResponse(data: Record<string, unknown>): ServerResponse {
  const status = data.status as string;
  if (status === "served") {
    return {
      outcome: "served",
      guestName: (data.guest as { name?: string })?.name,
      foodCategory: data.foodCategory as string | undefined,
      used: data.used as number | undefined,
      limit: data.limit as number | undefined,
      remaining: data.remaining as number | undefined,
    };
  }
  if (status === "already_served") {
    return {
      outcome: "duplicate_food",
      guestName: (data.guest as { name?: string })?.name,
      foodCategory: data.foodCategory as string | undefined,
      used: data.used as number | undefined,
      limit: data.limit as number | undefined,
      consumptionHistory: data.history as
        | Array<{ stall: string; time: string }>
        | undefined,
    };
  }
  return {
    outcome: "denied",
    reason: (data.reason as string) ?? "Food scan rejected",
  };
}

export const useScannerStore = create<ScanStore>((set, get) => ({
  state: "idle",
  scanResult: null,
  serverResponse: null,
  scanCount: 0,

  onQrDetected: (qrPayload: string) => {
    if (get().state !== "idle") return;
    set({
      state: "reviewing",
      scanResult: { qrPayload, decodedAt: Date.now() },
      serverResponse: null,
    });
  },

  onFlashComplete: () => {
    if (get().state !== "flash") return;
    set({ state: "ready" });
  },

  onConfirm: async (
    sessionToken: string,
    stallId: string,
    vendorTypeId: string,
  ) => {
    const { state, scanResult } = get();
    if (state !== "reviewing" || !scanResult) return;

    set({ state: "confirming" });

    const API_URL = import.meta.env.VITE_API_URL || "";
    const isEntry = vendorTypeId === "entry";
    const endpoint = isEntry
      ? `${API_URL}/api/v1/scan/entry`
      : `${API_URL}/api/v1/scan/food`;

    const body: Record<string, string> = { qrPayload: scanResult.qrPayload };
    if (!isEntry) {
      body.stallId = stallId;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as Record<string, unknown>;
      const serverResponse = isEntry
        ? parseEntryResponse(data)
        : parseFoodResponse(data);

      set({ state: "flash", serverResponse });
    } catch {
      set({
        state: "flash",
        serverResponse: {
          outcome: "denied",
          reason: "Network error. Please check your connection.",
        },
      });
    }
  },

  onDismiss: () => {
    if (get().state !== "reviewing") return;
    set({ state: "ready", serverResponse: null });
  },

  onScanNext: () => {
    if (get().state !== "ready") return;
    set((s) => ({
      state: "idle",
      scanResult: null,
      serverResponse: null,
      scanCount: s.scanCount + 1,
    }));
  },

  reset: () => {
    set({
      state: "idle",
      scanResult: null,
      serverResponse: null,
      scanCount: 0,
    });
  },
}));
