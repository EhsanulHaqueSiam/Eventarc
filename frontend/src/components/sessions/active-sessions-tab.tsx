import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface ActiveSessionsTabProps {
  eventId: Id<"events">;
}

function getSessionStatus(lastHeartbeat: number): {
  label: string;
  dotColor: string;
  variant: "outline" | "secondary";
} {
  const now = Date.now();
  const elapsedMs = now - lastHeartbeat;
  const elapsedSec = elapsedMs / 1000;

  if (elapsedSec < 30) {
    return {
      label: "Connected",
      dotColor: "bg-[oklch(0.72_0.19_142)]",
      variant: "outline",
    };
  }
  if (elapsedSec < 120) {
    return {
      label: "Idle",
      dotColor: "bg-[oklch(0.82_0.17_85)]",
      variant: "outline",
    };
  }
  return {
    label: "Disconnected",
    dotColor: "bg-destructive",
    variant: "secondary",
  };
}

function formatScansPerMin(scanCount: number, createdAt: number): string {
  const now = Date.now();
  const minutes = (now - createdAt) / 60000;
  if (minutes < 1) return `${scanCount}`;
  return (scanCount / minutes).toFixed(1);
}

export function ActiveSessionsTab({ eventId }: ActiveSessionsTabProps) {
  const sessions = useQuery(api.deviceSessions.listByEvent, { eventId });
  const revokeMutation = useMutation(api.deviceSessions.revoke);

  if (sessions === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeSessions = sessions.filter(
    (s: { status: string }) => s.status === "active",
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-lg font-semibold">Active Sessions</h3>
        <p className="text-sm text-muted-foreground">
          {activeSessions.length} active scanning station
          {activeSessions.length !== 1 ? "s" : ""}
        </p>
      </div>

      {activeSessions.length === 0 ? (
        <div className="rounded-lg border bg-card py-12 text-center">
          <p className="text-muted-foreground">
            No active scanning sessions for this event
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stall</TableHead>
                    <TableHead>Scans/min</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeSessions.map(
                    (session: {
                      _id: string;
                      stallName: string;
                      scanCount: number;
                      createdAt: number;
                      lastHeartbeat: number;
                      token: string;
                    }) => {
                      const status = getSessionStatus(session.lastHeartbeat);
                      return (
                        <TableRow key={session._id}>
                          <TableCell className="font-medium">
                            {session.stallName}
                          </TableCell>
                          <TableCell>
                            {formatScansPerMin(
                              session.scanCount,
                              session.createdAt,
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant} className="gap-1.5">
                              <span
                                className={`inline-block size-2 rounded-full ${status.dotColor}`}
                              />
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <RevokeButton
                              stallName={session.stallName}
                              onRevoke={() =>
                                revokeMutation({ token: session.token })
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    },
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Mobile card layout */}
          <div className="space-y-3 md:hidden">
            {activeSessions.map(
              (session: {
                _id: string;
                stallName: string;
                scanCount: number;
                createdAt: number;
                lastHeartbeat: number;
                token: string;
              }) => {
                const status = getSessionStatus(session.lastHeartbeat);
                return (
                  <div
                    key={session._id}
                    className="rounded-lg border bg-card p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">{session.stallName}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatScansPerMin(
                            session.scanCount,
                            session.createdAt,
                          )}{" "}
                          scans/min
                        </p>
                      </div>
                      <Badge variant={status.variant} className="gap-1.5">
                        <span
                          className={`inline-block size-2 rounded-full ${status.dotColor}`}
                        />
                        {status.label}
                      </Badge>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <RevokeButton
                        stallName={session.stallName}
                        onRevoke={() =>
                          revokeMutation({ token: session.token })
                        }
                      />
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RevokeButton({
  stallName,
  onRevoke,
}: {
  stallName: string;
  onRevoke: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Revoke
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke session?</AlertDialogTitle>
          <AlertDialogDescription>
            The operator at &apos;{stallName}&apos; will be disconnected
            immediately and must re-select their station to continue scanning.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onRevoke}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Revoke Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
