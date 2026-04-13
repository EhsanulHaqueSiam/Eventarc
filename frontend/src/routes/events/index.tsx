import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EventCard } from "@/components/events/event-card";
import { CreateEventDialog } from "@/components/events/create-event-dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronDown, ChevronRight } from "lucide-react";
import { PageTransition, StaggerList, StaggerItem } from "@/lib/motion";

export const Route = createFileRoute("/events/")({
  component: EventsListPage,
});

type StatusFilter = "all" | "draft" | "active" | "live";

function EventsListPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const myAccess = useQuery(api.auth.getMyAccess);
  const events = useQuery(api.events.list, {});
  const navigate = useNavigate();
  const canCreateEvents = myAccess?.isAdmin ?? false;
  const isManager = myAccess && !myAccess.isAdmin;

  // Auto-redirect: managers with exactly one event go straight to it
  useEffect(() => {
    if (isManager && events && events.length === 1) {
      navigate({ to: "/events/$eventId", params: { eventId: events[0]._id } });
    }
  }, [isManager, events, navigate]);

  const { activeEvents, completedEvents } = useMemo(() => {
    if (!events) return { activeEvents: [], completedEvents: [] };

    const completed = events.filter(
      (e) => e.status === "completed" || e.status === "archived",
    );
    const active = events.filter(
      (e) => e.status !== "completed" && e.status !== "archived",
    );

    const filtered =
      statusFilter === "all"
        ? active
        : active.filter((e) => e.status === statusFilter);

    return { activeEvents: filtered, completedEvents: completed };
  }, [events, statusFilter]);

  // Don't render list if manager will be redirected
  if (isManager && events && events.length === 1) {
    return null;
  }

  return (
    <PageTransition className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold leading-tight">Events</h1>
        {canCreateEvents ? (
          <CreateEventDialog />
        ) : (
          <Button variant="outline" disabled>
            Admin only
          </Button>
        )}
      </div>

      <Tabs
        value={statusFilter}
        onValueChange={(v) => setStatusFilter(v as StatusFilter)}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>
      </Tabs>

      {events === undefined ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : activeEvents.length === 0 && completedEvents.length === 0 ? (
        <PageTransition className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <CalendarDays className="size-6 text-muted-foreground" />
          </div>
          {canCreateEvents ? (
            <>
              <h2 className="mt-5 font-display text-lg font-semibold">No events yet</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Create your first event to manage guests, vendors, and
                QR-based entry and food operations at scale.
              </p>
              <div className="mt-6">
                <CreateEventDialog />
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-5 font-display text-lg font-semibold">No events assigned</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                No events have been assigned to your account. Contact an admin to get event access.
              </p>
            </>
          )}
        </PageTransition>
      ) : (
        <>
          {activeEvents.length > 0 ? (
            <StaggerList className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {activeEvents.map((event) => (
                <StaggerItem key={event._id}>
                  <EventCard event={event} />
                </StaggerItem>
              ))}
            </StaggerList>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No {statusFilter === "all" ? "active" : statusFilter} events.
            </p>
          )}

          {completedEvents.length > 0 && statusFilter === "all" && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                {showCompleted ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                Completed ({completedEvents.length})
              </button>
              {showCompleted && (
                <div className="grid gap-6 opacity-60 sm:grid-cols-2 lg:grid-cols-3">
                  {completedEvents.map((event) => (
                    <EventCard key={event._id} event={event} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </PageTransition>
  );
}
