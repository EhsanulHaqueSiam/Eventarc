import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, UserPlus } from "lucide-react";
import { GuestTable } from "@/components/guests/guest-table";
import {
  GuestFilters,
  type GuestFilterValues,
} from "@/components/guests/guest-filters";
import { AddGuestDialog } from "@/components/guests/add-guest-dialog";

export const Route = createFileRoute("/events/$eventId/guests/")({
  component: GuestListPage,
});

function GuestListPage() {
  const { eventId } = Route.useParams();
  const typedEventId = eventId as Id<"events">;
  const event = useQuery(api.events.getById, { eventId: typedEventId });
  const guestCount = useQuery(api.guests.countByEvent, {
    eventId: typedEventId,
  });

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [filters, setFilters] = useState<GuestFilterValues>({
    searchText: "",
    searchType: "name",
    categoryId: null,
    status: null,
  });

  if (event === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (event === null) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-lg font-semibold">Event not found</h2>
        <Link
          to="/events"
          className="mt-2 text-sm text-primary hover:underline"
        >
          Back to events
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/events">Events</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/events/$eventId" params={{ eventId }}>
                {event.name}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Guests</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Guest Management</h1>
          {guestCount !== undefined && guestCount > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              {guestCount.toLocaleString()} total guests
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/events/$eventId/guests/import" params={{ eventId }}>
              <Upload className="mr-2 size-4" />
              Import Guests
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setAddDialogOpen(true)}>
            <UserPlus className="mr-2 size-4" />
            Add Guest
          </Button>
        </div>
      </div>

      {/* Filters */}
      <GuestFilters
        eventId={typedEventId}
        filters={filters}
        onFilterChange={setFilters}
      />

      {/* Table */}
      <GuestTable
        eventId={typedEventId}
        filters={filters}
        onAddGuest={() => setAddDialogOpen(true)}
      />

      {/* Add Guest Dialog */}
      <AddGuestDialog
        eventId={typedEventId}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}
