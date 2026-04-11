import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EventCard } from "@/components/events/event-card";
import { CreateEventDialog } from "@/components/events/create-event-dialog";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/events/")({
  component: EventsListPage,
});

type StatusFilter = "all" | "draft" | "active" | "live" | "completed" | "archived";

function EventsListPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const events = useQuery(
    api.events.list,
    statusFilter === "all" ? {} : { status: statusFilter },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <CreateEventDialog />
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
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      {events === undefined ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarDays className="size-12 text-muted-foreground/40" />
          <h2 className="mt-4 text-lg font-semibold">No events yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Create your first event to start managing guests, vendors, and
            QR-based operations.
          </p>
          <div className="mt-6">
            <CreateEventDialog />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard key={event._id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
