import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useSSE } from "@/hooks/use-sse";
import { getApiBaseUrl } from "@/lib/api";
import { MetricCard } from "./metric-card";
import { FoodCategoryRow } from "./food-category-row";
import { StallActivityRow } from "./stall-activity-row";
import { AlertFeedItem } from "./alert-feed-item";
import { ConnectionStatus } from "./connection-status";

// Types matching the Go SSE backend payloads
interface DashboardSnapshot {
  attendance: { checkedIn: number; totalInvited: number; percentage: number };
  counters: Record<string, number>;
  foodCategories: Array<{
    category: string;
    served: number;
    limit?: number;
    stallBreakdown?: Record<string, number>;
  }>;
  stalls: Array<{
    stallId: string;
    stallName: string;
    scanCount: number;
    lastScan: string;
    status: "active" | "idle" | "inactive";
  }>;
  systemHealth: {
    redisConnected: boolean;
    postgresConnected: boolean;
    activeSseClients: number;
    uptimeSeconds: number;
  };
}

interface AlertData {
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  timestamp: string;
}

const MAX_ALERTS = 50;
const API_BASE = getApiBaseUrl();

interface LiveDashboardProps {
  eventId: string;
}

export function LiveDashboard({ eventId }: LiveDashboardProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AlertData[]>([]);

  const handleSnapshot = useCallback((data: unknown) => {
    setSnapshot(data as DashboardSnapshot);
  }, []);

  const handleCounters = useCallback((data: unknown) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const update = data as Partial<DashboardSnapshot> & {
        counters?: Record<string, number>;
        timestamp?: string;
      };
      const mergedCounters = { ...prev.counters, ...(update.counters ?? {}) };

      const checkedIn =
        mergedCounters.attendance ??
        update.attendance?.checkedIn ??
        prev.attendance.checkedIn;
      const totalInvited =
        mergedCounters.total_invited ??
        update.attendance?.totalInvited ??
        prev.attendance.totalInvited;
      const percentage =
        totalInvited > 0 ? (checkedIn / totalInvited) * 100 : 0;

      const foodServedByCategory = new Map<string, number>();
      for (const [key, value] of Object.entries(mergedCounters)) {
        const foodMatch = key.match(/^food:(.+):served$/);
        if (!foodMatch) continue;
        foodServedByCategory.set(foodMatch[1], Number(value) || 0);
      }

      const foodCategories = prev.foodCategories.map((category) => {
        const served = foodServedByCategory.get(category.category);
        if (served === undefined) {
          return category;
        }
        return { ...category, served };
      });
      for (const [category, served] of foodServedByCategory.entries()) {
        if (!foodCategories.some((item) => item.category === category)) {
          foodCategories.push({ category, served });
        }
      }

      const stallServedByID = new Map<string, number>();
      for (const [key, value] of Object.entries(mergedCounters)) {
        const stallMatch = key.match(/^stall:(.+):served$/);
        if (!stallMatch) continue;
        stallServedByID.set(stallMatch[1], Number(value) || 0);
      }

      const eventTime = update.timestamp ?? new Date().toISOString();
      const stalls = prev.stalls.map((stall) => {
        const scanCount = stallServedByID.get(stall.stallId);
        if (scanCount === undefined) {
          return stall;
        }
        return {
          ...stall,
          scanCount,
          status: scanCount > 0 ? "active" : "idle",
          lastScan: scanCount !== stall.scanCount ? eventTime : stall.lastScan,
        };
      });
      for (const [stallID, scanCount] of stallServedByID.entries()) {
        if (!stalls.some((stall) => stall.stallId === stallID)) {
          stalls.push({
            stallId: stallID,
            stallName: stallID,
            scanCount,
            lastScan: eventTime,
            status: scanCount > 0 ? "active" : "idle",
          });
        }
      }

      return {
        ...prev,
        attendance: { checkedIn, totalInvited, percentage },
        counters: mergedCounters,
        foodCategories,
        stalls,
      };
    });
  }, []);

  const handleStallActivity = useCallback((data: unknown) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      const stallUpdate = data as DashboardSnapshot["stalls"][number];
      const stalls = prev.stalls.map((s) =>
        s.stallId === stallUpdate.stallId ? stallUpdate : s,
      );
      // Add new stall if not found
      if (!stalls.find((s) => s.stallId === stallUpdate.stallId)) {
        stalls.push(stallUpdate);
      }
      return { ...prev, stalls };
    });
  }, []);

  const handleAlert = useCallback((data: unknown) => {
    const alert = data as AlertData;
    setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS));
  }, []);

  const { status, lastEventTime } = useSSE({
    url: `${API_BASE}/api/v1/events/${eventId}/live`,
    enabled: true,
    onSnapshot: handleSnapshot,
    onCounters: handleCounters,
    onStallActivity: handleStallActivity,
    onAlert: handleAlert,
  });

  // Loading state before first snapshot
  if (!snapshot) {
    return (
      <div className="space-y-6">
        <ConnectionStatus status={status} lastEventTime={lastEventTime} />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  const { attendance, counters, foodCategories, stalls } = snapshot;
  const totalStalls = stalls.length;
  const activeStalls = stalls.filter((s) => s.status === "active").length;

  // Sort stalls by scan count (busiest first)
  const sortedStalls = [...stalls].sort((a, b) => b.scanCount - a.scanCount);

  return (
    <div className="space-y-6">
      {/* Connection Status Bar */}
      <ConnectionStatus status={status} lastEventTime={lastEventTime} />

      {/* Hero Row: Attendance */}
      <MetricCard
        label="Attendance"
        value={attendance.checkedIn}
        subtitle={`${attendance.checkedIn.toLocaleString()} checked in of ${attendance.totalInvited.toLocaleString()} invited`}
        progress={attendance.percentage}
        className="w-full"
      />

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Scans"
          value={counters.scans_total ?? 0}
          rate={`${Math.round((counters.scans_total ?? 0) / Math.max(1, (snapshot.systemHealth.uptimeSeconds ?? 1) / 60))}/min`}
        />
        <MetricCard
          label="Duplicate Attempts"
          value={counters.scans_duplicate ?? 0}
          subtitle={
            counters.scans_total
              ? `${(((counters.scans_duplicate ?? 0) / counters.scans_total) * 100).toFixed(1)}% of total`
              : "0% of total"
          }
        />
        <MetricCard
          label="Food Servings"
          value={foodCategories.reduce((sum, fc) => sum + fc.served, 0)}
          subtitle={`across ${foodCategories.length} categories`}
        />
      </div>

      {/* Two-Column Section: Food + Stalls */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Food Consumption */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Per Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[300px]">
              {foodCategories.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm font-medium">No food categories</p>
                  <p className="max-w-[200px] text-xs text-muted-foreground">
                    Configure food vendor categories in the Vendors tab to track consumption here.
                  </p>
                </div>
              ) : (
                foodCategories.map((fc) => (
                  <FoodCategoryRow
                    key={fc.category}
                    category={fc.category}
                    served={fc.served}
                    limit={fc.limit}
                  />
                ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Stall Monitor */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stall Monitor</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[300px]">
              {sortedStalls.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm font-medium">No active stations</p>
                  <p className="max-w-[200px] text-xs text-muted-foreground">
                    Scanning stations will appear here once operators connect and start scanning.
                  </p>
                </div>
              ) : (
                sortedStalls.map((stall) => (
                  <StallActivityRow
                    key={stall.stallId}
                    stallName={stall.stallName}
                    status={stall.status}
                    rate={`${stall.scanCount}/min`}
                    lastScan={new Date(stall.lastScan).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  />
                ))
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Alert Feed */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Alerts</CardTitle>
          {alerts.length > 0 && (
            <button
              onClick={() => setAlerts([])}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear All
            </button>
          )}
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-[300px]" role="log" aria-live="polite">
            {alerts.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium">No alerts</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Alerts will appear here when duplicate scans, offline devices,
                  or other events are detected.
                </p>
              </div>
            ) : (
              alerts.map((alert, index) => (
                <AlertFeedItem
                  key={`${alert.timestamp}-${index}`}
                  type={alert.type}
                  severity={alert.severity}
                  title={alert.title}
                  detail={alert.detail}
                  timestamp={new Date(alert.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                />
              ))
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
