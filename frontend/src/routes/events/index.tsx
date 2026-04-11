import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/events/")({
  component: EventsListPage,
});

function EventsListPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Events</h1>
      <p className="text-muted-foreground mt-2">
        Event list placeholder - will be implemented in Task 2.
      </p>
    </div>
  );
}
