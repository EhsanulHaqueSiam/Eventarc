import { useState, useEffect, useCallback } from "react";

const SESSION_KEY = "eventarc_scanner_session";

export interface SessionInfo {
  token: string;
  stallId: string;
  eventId: string;
  vendorCategoryId: string;
  vendorTypeId: string;
  stallName: string;
}

interface CreateSessionParams {
  stallId: string;
  eventId: string;
  vendorCategoryId: string;
  vendorTypeId: string;
  stallName: string;
}

async function validateToken(
  token: string,
): Promise<Omit<SessionInfo, "token" | "stallName"> | null> {
  try {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${API_URL}/api/v1/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function useDeviceSession() {
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRevoked, setIsRevoked] = useState(false);

  // On mount: check localStorage for existing token, validate with backend
  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    validateToken(stored).then((info) => {
      if (info) {
        setToken(stored);
        setSession({
          token: stored,
          stallId: info.stallId,
          eventId: info.eventId,
          vendorCategoryId: info.vendorCategoryId,
          vendorTypeId: info.vendorTypeId,
          stallName: "", // stallName not returned by validation endpoint
        });
      } else {
        localStorage.removeItem(SESSION_KEY);
        setIsRevoked(true);
      }
      setIsLoading(false);
    });
  }, []);

  const createSession = useCallback(
    async (params: CreateSessionParams): Promise<boolean> => {
      try {
        const API_URL = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${API_URL}/api/v1/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        if (!res.ok) return false;
        const { token: newToken } = await res.json();
        localStorage.setItem(SESSION_KEY, newToken);
        setToken(newToken);
        setSession({ token: newToken, ...params });
        setIsRevoked(false);
        return true;
      } catch {
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
