import { useEffect, useRef, useState } from "react";

export type SSEConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface UseSSEOptions {
  url: string;
  enabled: boolean;
  onSnapshot?: (data: unknown) => void;
  onCounters?: (data: unknown) => void;
  onStallActivity?: (data: unknown) => void;
  onAlert?: (data: unknown) => void;
  onHeartbeat?: () => void;
}

export interface UseSSEReturn {
  status: SSEConnectionStatus;
  lastEventTime: Date | null;
}

export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const { url, enabled, onSnapshot, onCounters, onStallActivity, onAlert, onHeartbeat } =
    options;
  const [status, setStatus] = useState<SSEConnectionStatus>("disconnected");
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);

  // Stable refs for callbacks to avoid re-creating EventSource on callback changes
  const callbacksRef = useRef({
    onSnapshot,
    onCounters,
    onStallActivity,
    onAlert,
    onHeartbeat,
  });
  callbacksRef.current = {
    onSnapshot,
    onCounters,
    onStallActivity,
    onAlert,
    onHeartbeat,
  };

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      reconnectAttemptRef.current = 0;
    };

    es.onerror = () => {
      // EventSource auto-reconnects natively; we just update status
      reconnectAttemptRef.current += 1;
      if (reconnectAttemptRef.current > 3) {
        setStatus("disconnected");
      } else {
        setStatus("reconnecting");
      }
    };

    const handleSSEEvent = (
      eventType: string,
      callback: ((data: unknown) => void) | undefined,
      e: MessageEvent,
    ) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data as string);
      } catch (parseErr) {
        console.warn(`SSE ${eventType}: failed to parse event data:`, parseErr);
        return;
      }
      try {
        callback?.(data);
        setLastEventTime(new Date());
      } catch (callbackErr) {
        console.error(`SSE ${eventType} callback error:`, callbackErr);
      }
    };

    es.addEventListener("snapshot", (e: MessageEvent) =>
      handleSSEEvent("snapshot", callbacksRef.current.onSnapshot, e),
    );
    es.addEventListener("counters", (e: MessageEvent) =>
      handleSSEEvent("counters", callbacksRef.current.onCounters, e),
    );
    es.addEventListener("stall_activity", (e: MessageEvent) =>
      handleSSEEvent("stall_activity", callbacksRef.current.onStallActivity, e),
    );
    es.addEventListener("alert", (e: MessageEvent) =>
      handleSSEEvent("alert", callbacksRef.current.onAlert, e),
    );

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [url, enabled]);

  return { status, lastEventTime };
}
