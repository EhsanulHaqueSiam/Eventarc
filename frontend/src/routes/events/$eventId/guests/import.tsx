import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { WizardShell } from "@/components/guests/import-wizard/wizard-shell";
import { useImportStore } from "@/components/guests/import-wizard/use-import-store";
import { useEffect } from "react";

export const Route = createFileRoute("/events/$eventId/guests/import")({
  component: ImportPage,
});

function ImportPage() {
  const { eventId } = Route.useParams();
  const typedEventId = eventId as Id<"events">;
  const event = useQuery(api.events.getById, { eventId: typedEventId });
  const reset = useImportStore((s) => s.reset);

  // Reset wizard state when page mounts
  useEffect(() => {
    reset();
    return () => reset(); // And cleanup on unmount
  }, [reset]);

  if (event === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (event === null) {
    return (
      <div className="py-16 text-center">
        <h2 className="font-display text-lg font-semibold">Event not found</h2>
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
            <BreadcrumbLink asChild>
              <Link to="/events/$eventId/guests" params={{ eventId }}>
                Guests
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Import</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <h1 className="font-display text-2xl font-semibold">Import Guests</h1>

      {/* Wizard */}
      <WizardShell eventId={typedEventId} />
    </div>
  );
}
