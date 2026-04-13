import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/scanner/$eventId")({
  component: LegacyEventScannerRoutePage,
});

function LegacyEventScannerRoutePage() {
  const { eventId } = Route.useParams();
  return <Navigate to="/$eventId/scanner" params={{ eventId }} replace />;
}
