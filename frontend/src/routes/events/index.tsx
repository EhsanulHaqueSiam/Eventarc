import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EventCard } from "@/components/events/event-card";
import { CreateEventDialog } from "@/components/events/create-event-dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, Archive } from "lucide-react";
import { PageTransition, StaggerList, StaggerItem } from "@/lib/motion";

export const Route = createFileRoute("/events/")({
  component: EventsListPage,
});

type StatusFilter = "all" | "draft" | "active" | "live" | "archived";

function EventsListPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showArchived, setShowArchived] = useState(false);
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

  const { filteredEvents, archivedEvents } = useMemo(() => {
    if (!events) return { filteredEvents: [], archivedEvents: [] };
    const archived = events.filter((e) => e.status === "completed" || e.status === "archived");
    if (statusFilter === "archived") return { filteredEvents: archived, archivedEvents: [] };
    const nonArchived = events.filter((e) => e.status !== "completed" && e.status !== "archived");
    const filtered = statusFilter === "all" ? nonArchived : nonArchived.filter((e) => e.status === statusFilter);
    return { filteredEvents: filtered, archivedEvents: archived };
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
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      {events === undefined ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : filteredEvents.length === 0 ? (
        <PageTransition className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <CalendarDays className="size-6 text-muted-foreground" />
          </div>
          {canCreateEvents && statusFilter === "all" ? (
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
          ) : !canCreateEvents && statusFilter === "all" ? (
            <>
              <h2 className="mt-5 font-display text-lg font-semibold">No events assigned</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                No events have been assigned to your account. Contact an admin to get event access.
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              No {statusFilter} events.
            </p>
          )}
        </PageTransition>
      ) : (
        <>
          <StaggerList className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event) => (
              <StaggerItem key={event._id}>
                <EventCard event={event} />
              </StaggerItem>
            ))}
          </StaggerList>

          {statusFilter === "all" && archivedEvents.length > 0 && (
            <div className="space-y-4 border-t pt-6">
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="size-4 rounded border-border accent-primary"
                />
                <Archive className="size-3.5" />
                Show archived ({archivedEvents.length})
              </label>
              {showArchived && (
                <div className="grid gap-6 opacity-50 sm:grid-cols-2 lg:grid-cols-3">
                  {archivedEvents.map((event) => (
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
