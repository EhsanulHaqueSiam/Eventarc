import { create } from "zustand";

export interface Rejection {
  guestName: string;
  reason: string;
  scanType: string;
  idempotencyKey: string;
}

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
}

export interface OfflineScannerState {
  networkStatus: "online" | "offline" | "syncing";
  setNetworkStatus: (status: "online" | "offline" | "syncing") => void;

  pendingCount: number;
  setPendingCount: (count: number) => void;

  syncProgress: SyncProgress | null;
  setSyncProgress: (progress: SyncProgress | null) => void;

  rejections: Rejection[];
  addRejection: (rejection: Rejection) => void;
  clearRejection: (idempotencyKey: string) => void;
}

export const useOfflineScannerStore = create<OfflineScannerState>((set) => ({
  networkStatus:
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
  setNetworkStatus: (status) => set({ networkStatus: status }),

  pendingCount: 0,
  setPendingCount: (count) => set({ pendingCount: count }),

  syncProgress: null,
  setSyncProgress: (progress) => set({ syncProgress: progress }),

  rejections: [],
  addRejection: (rejection) =>
    set((state) => ({ rejections: [...state.rejections, rejection] })),
  clearRejection: (idempotencyKey) =>
    set((state) => ({
      rejections: state.rejections.filter(
        (r) => r.idempotencyKey !== idempotencyKey,
      ),
    })),
}));
