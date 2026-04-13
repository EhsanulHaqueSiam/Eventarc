import { useState, useEffect, useCallback } from "react";

const SESSION_KEY = "eventarc_scanner_session";
type VendorType = "entry" | "food";

function getApiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_URL ??
    import.meta.env.VITE_GO_API_URL ??
    "http://localhost:8080"
  );
}

export interface SessionInfo {
  token: string;
  stallId: string;
  eventId: string;
  vendorCategoryId: string;
  vendorTypeId: string;
  vendorType: VendorType;
  stallName: string;
  eventName?: string;
}

interface CreateSessionParams {
  stallId: string;
  eventId: string;
  vendorCategoryId: string;
  vendorTypeId: string;
  vendorType: VendorType;
  stallName: string;
  eventName?: string;
}

interface UseDeviceSessionOptions {
  // When true, scanner always starts from station selection and ignores stored session.
  disableStoredSessionRestore?: boolean;
}

type ValidationResult =
  | {
      status: "valid";
      info: Omit<SessionInfo, "token" | "stallName">;
    }
  | { status: "invalid" }
  | { status: "network_error" };

async function validateToken(token: string): Promise<ValidationResult> {
  try {
    const API_URL = getApiBaseUrl();
    const res = await fetch(`${API_URL}/api/v1/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      return { status: "valid", info: await res.json() };
    }
    if (res.status === 401 || res.status === 403) {
      return { status: "invalid" };
    }
    // Server error — don't assume token is invalid
    return { status: "network_error" };
  } catch {
    return { status: "network_error" };
  }
}

export function useDeviceSession(
  expectedEventId?: string,
  options?: UseDeviceSessionOptions,
) {
  const disableStoredSessionRestore = options?.disableStoredSessionRestore ?? false;
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevoked, setIsRevoked] = useState(false);

  // On mount: check localStorage for existing session, validate token with backend
  useEffect(() => {
    if (disableStoredSessionRestore) {
      setIsLoading(false);
      return;
    }

    const storedJson = localStorage.getItem(SESSION_KEY);
    if (!storedJson) {
      setIsLoading(false);
      return;
    }

    // Support both legacy (plain token string) and new (JSON session) formats
    let storedToken: string;
    let storedStallName = "";
    let storedVendorType: VendorType | null = null;
    let storedEventName = "";
    try {
      const parsed = JSON.parse(storedJson) as SessionInfo;
      storedToken = parsed.token;
      storedStallName = parsed.stallName ?? "";
      storedVendorType = parsed.vendorType ?? null;
      storedEventName = parsed.eventName ?? "";
    } catch {
      storedToken = storedJson;
    }

    validateToken(storedToken).then((result) => {
      if (result.status === "valid") {
        if (expectedEventId && result.info.eventId !== expectedEventId) {
          // Event-scoped scanner links must never reuse another event's session.
          localStorage.removeItem(SESSION_KEY);
          setToken(null);
          setSession(null);
          setIsLoading(false);
          return;
        }

        setToken(storedToken);
        setSession({
          token: storedToken,
          stallId: result.info.stallId,
          eventId: result.info.eventId,
          vendorCategoryId: result.info.vendorCategoryId,
          vendorTypeId: result.info.vendorTypeId,
          vendorType: result.info.vendorType ?? storedVendorType ?? "entry",
          stallName: storedStallName,
          eventName: storedEventName,
        });
      } else if (result.status === "invalid") {
        localStorage.removeItem(SESSION_KEY);
        setIsRevoked(true);
      }
      // network_error: keep token in storage, don't mark as revoked — retry on next load
      setIsLoading(false);
    });
  }, [expectedEventId, disableStoredSessionRestore]);

  const createSession = useCallback(
    async (params: CreateSessionParams): Promise<boolean> => {
      try {
        const API_URL = getApiBaseUrl();
        const payload = {
          stallId: params.stallId,
          eventId: params.eventId,
          vendorCategoryId: params.vendorCategoryId,
          vendorTypeId: params.vendorTypeId,
          vendorType: params.vendorType,
        };
        const res = await fetch(`${API_URL}/api/v1/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return false;
        const { token: newToken } = await res.json();
        const newSession: SessionInfo = { token: newToken, ...params };
        localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
        setToken(newToken);
        setSession(newSession);
        setIsRevoked(false);
        return true;
      } catch (error) {
        console.error("Failed to create session:", error);
        return false;
      }
    },
    [],
  );

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setToken(null);
    setSession(null);
    setIsRevoked(false);
  }, []);

  return { token, session, isLoading, isRevoked, createSession, clearSession };
}
