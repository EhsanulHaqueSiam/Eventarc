import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/scanner/")({
  component: ScannerRoutePage,
});

function ScannerRoutePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-xl space-y-4 rounded-2xl border bg-card p-6 text-center shadow-card">
        <h1 className="font-display text-xl font-semibold">
          Use event-specific link
        </h1>
        <p className="text-sm text-muted-foreground">
          Central scanner access is disabled. Open scanner using the event link:
          <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            /&lt;eventId&gt;/scanner
          </code>
        </p>
        <p className="text-sm text-muted-foreground">
          Admins can find the scanner link on each event&apos;s detail page.
        </p>
        <Link
          to="/events"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to Events
        </Link>
      </div>
    </div>
  );
}
