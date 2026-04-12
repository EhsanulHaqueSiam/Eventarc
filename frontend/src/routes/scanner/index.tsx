import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { ScannerSetup } from "@/components/scanner/scanner-setup";
import { useDeviceSession } from "@/hooks/use-device-session";

export const Route = createFileRoute("/scanner/")({
  component: ScannerPage,
});

function ScannerPage() {
  const { token, session, isLoading, isRevoked, createSession, clearSession } =
    useDeviceSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <Skeleton className="mx-auto h-8 w-48" />
          <Skeleton className="mx-auto h-4 w-32" />
        </div>
      </div>
    );
  }

  if (isRevoked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="rounded-xl border border-destructive/30 bg-card p-8 text-center shadow-lg">
          <h2 className="mb-2 text-xl font-semibold text-destructive">
            Session Revoked
          </h2>
          <p className="mb-6 text-muted-foreground">
            This scanning session has been revoked by an administrator. Please
            contact your event coordinator.
          </p>
          <button
            onClick={clearSession}
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Select New Station
          </button>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <ScannerSetup
        onSessionCreated={() => {
          // Session created, component will re-render with token
        }}
        createSession={createSession}
      />
    );
  }

  // Active session — placeholder for Plan 02 camera scanning
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="rounded-xl border bg-card p-8 text-center shadow-lg">
        <h2 className="mb-2 text-xl font-semibold text-foreground">
          Session Active
        </h2>
        <p className="mb-2 text-muted-foreground">
          {session?.stallName
            ? `Station: ${session.stallName}`
            : "Scanning station ready"}
        </p>
        <p className="text-xs text-muted-foreground">
          Camera scanning coming in Plan 02
        </p>
        <button
          onClick={clearSession}
          className="mt-4 inline-flex h-10 items-center rounded-lg border px-4 text-sm text-muted-foreground hover:bg-muted"
        >
          Change Station
        </button>
      </div>
    </div>
  );
}
