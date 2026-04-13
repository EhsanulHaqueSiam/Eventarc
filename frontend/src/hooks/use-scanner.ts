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
  | "duplicate_food"
  | "network_error";

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
  additionalGuests?: number;
  totalPersons?: number;
}

interface ConfirmParams {
  sessionToken: string;
  vendorType: "entry" | "food";
  additionalGuests?: number;
}

export interface ScanStore {
  state: ScanState;
  scanResult: ScanResult | null;
  serverResponse: ServerResponse | null;
  scanCount: number;

  onQrDetected: (qrPayload: string) => void;
  onFlashComplete: () => void;
  onConfirm: (params: ConfirmParams) => Promise<void>;
  onDismiss: () => void;
  onScanNext: () => void;
  reset: () => void;
}

function parseErrorReason(data: Record<string, unknown>): string {
  const nestedError = data.error as { message?: string } | undefined;
  return (
    nestedError?.message ??
    (data.message as string | undefined) ??
    "Scan rejected"
  );
}

function parseEntryResponse(data: Record<string, unknown>): ServerResponse {
  const status = (data.status as string | undefined) ?? "";
  if (status === "valid" || status === "allowed") {
    const guest = data.guest as { name?: string; category?: string } | undefined;
    return {
      outcome: "allowed",
      guestName: guest?.name,
      guestCategory: guest?.category,
      additionalGuests:
        typeof data.additional_guests === "number"
          ? data.additional_guests
          : undefined,
      totalPersons:
        typeof data.total_persons === "number" ? data.total_persons : undefined,
    };
  }
  if (status === "duplicate") {
    const guest = data.guest as { name?: string; category?: string } | undefined;
    const original = (data.original_scan ??
      data.originalCheckIn ??
      null) as
      | {
          checked_in_at?: string;
          stall_id?: string;
          time?: string;
          stall?: string;
        }
      | null;
    return {
      outcome: "duplicate_entry",
      guestName: guest?.name,
      guestCategory: guest?.category,
      originalCheckIn: original
        ? {
            time: original.checked_in_at ?? original.time ?? "",
            stall: original.stall_id ?? original.stall ?? "",
          }
        : undefined,
    };
  }
  return {
    outcome: "denied",
    reason: parseErrorReason(data),
  };
}

function parseFoodResponse(data: Record<string, unknown>): ServerResponse {
  const status = (data.status as string | undefined) ?? "";
  if (status === "valid" || status === "served") {
    const guest = data.guest as { name?: string } | undefined;
    const foodCategory = (data.food_category as { name?: string } | undefined)
      ?.name;
    const consumption = data.consumption as
      | { current?: number; limit?: number; remaining?: number }
      | undefined;
    return {
      outcome: "served",
      guestName: guest?.name,
      foodCategory: foodCategory ?? (data.foodCategory as string | undefined),
      used: consumption?.current ?? (data.used as number | undefined),
      limit: consumption?.limit ?? (data.limit as number | undefined),
      remaining:
        consumption?.remaining ?? (data.remaining as number | undefined),
    };
  }
  if (status === "limit_reached" || status === "already_served") {
    const guest = data.guest as { name?: string } | undefined;
    const foodCategory = (data.food_category as { name?: string } | undefined)
      ?.name;
    const consumption = data.consumption as
      | { current?: number; limit?: number }
      | undefined;
    const history = data.history as
      | Array<{
          stall_name?: string;
          stall?: string;
          consumed_at?: string;
          time?: string;
        }>
      | undefined;
    return {
      outcome: "duplicate_food",
      guestName: guest?.name,
      foodCategory: foodCategory ?? (data.foodCategory as string | undefined),
      used: consumption?.current ?? (data.used as number | undefined),
      limit: consumption?.limit ?? (data.limit as number | undefined),
      consumptionHistory: history?.map((item) => ({
        stall: item.stall_name ?? item.stall ?? "",
        time: item.consumed_at ?? item.time ?? "",
      })),
    };
  }
  return {
    outcome: "denied",
    reason: parseErrorReason(data),
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

  onConfirm: async ({ sessionToken, vendorType, additionalGuests = 0 }) => {
    const { state, scanResult } = get();
    if (state !== "reviewing" || !scanResult) return;

    set({ state: "confirming" });

    const apiUrl =
      import.meta.env.VITE_API_URL ??
      import.meta.env.VITE_GO_API_URL ??
      "http://localhost:8080";
    const endpoint =
      vendorType === "entry"
        ? `${apiUrl}/api/v1/scan/entry`
        : `${apiUrl}/api/v1/scan/food`;

    const body: Record<string, unknown> = { qr_payload: scanResult.qrPayload };
    if (vendorType === "entry") {
      body.additional_guests = Math.max(0, Math.floor(additionalGuests));
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

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const serverResponse =
        vendorType === "entry"
          ? parseEntryResponse(data)
          : parseFoodResponse(data);

      // Defensive fallback when backend returns a non-JSON 5xx body.
      if (!res.ok && !data.status && !data.error) {
        set({
          state: "flash",
          serverResponse: {
            outcome: "network_error",
            reason: "Server unavailable. Please retry.",
          },
        });
        return;
      }

      set({ state: "flash", serverResponse });
    } catch (error) {
      console.error("Scan confirm failed:", error);
      set({
        state: "flash",
        serverResponse: {
          outcome: "network_error",
          reason: "Could not reach server. The scan was not confirmed — please retry.",
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
