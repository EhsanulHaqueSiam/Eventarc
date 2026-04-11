import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/events/$eventId")({
  component: EventDetailPage,
});

function EventDetailPage() {
  const { eventId } = Route.useParams();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Event Detail</h1>
      <p className="text-muted-foreground mt-2">
        Event {eventId} - placeholder for Task 2.
      </p>
    </div>
  );
}
