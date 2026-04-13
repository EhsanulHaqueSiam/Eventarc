import { createFileRoute } from "@tanstack/react-router";
import { ScannerApp } from "@/components/scanner/scanner-app";

export const Route = createFileRoute("/$eventId/scanner")({
  component: EventScopedScannerRoutePage,
});

function EventScopedScannerRoutePage() {
  const { eventId } = Route.useParams();
  return <ScannerApp fixedEventId={eventId} />;
}
