import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { SMSStatusBadge } from "./sms-status-badge";
import { Send, RefreshCw, MessageSquare } from "lucide-react";

interface SMSDashboardProps {
  eventId: string;
}

interface SMSDelivery {
  _id: string;
  guestName: string;
  phone: string;
  status: "queued" | "sending" | "sent" | "delivered" | "failed";
  lastAttemptAt?: number;
}

interface SMSCounts {
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  total: number;
}

export function SMSDashboard({ eventId: _eventId }: SMSDashboardProps) {
  const [statusFilter, setStatusFilter] = useState("all");

  // Placeholder data - will be wired to Convex queries when smsDeliveries table exists (Plan 03)
  const counts: SMSCounts | undefined = undefined;
  const deliveries: SMSDelivery[] | undefined = undefined;
  const isLoading = false;

  // Empty state
  if (!counts && !isLoading) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <MessageSquare className="size-12 text-muted-foreground/40" />
        <div>
          <h3 className="text-lg font-semibold">Invitations not sent</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Send SMS invitations with card download links to all guests.
            Delivery status is tracked per guest.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button>
              <Send className="mr-2 size-4" />
              Send Invitations
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send SMS to all guests?</AlertDialogTitle>
              <AlertDialogDescription>
                Standard messaging rates apply.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Send</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Queued</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight">
              {counts?.queued.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sent</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight text-amber-600">
              {counts?.sent.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Delivered</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight text-emerald-600">
              {counts?.delivered.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Failed</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight text-destructive">
              {counts?.failed.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button>
              <Send className="mr-2 size-4" />
              Send Invitations
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Send SMS to {counts?.total.toLocaleString()} guests?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Standard messaging rates apply.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Send</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {(counts?.failed ?? 0) > 0 && (
          <Button variant="outline">
            <RefreshCw className="mr-2 size-4" />
            Retry Failed
          </Button>
        )}
      </div>

      {/* Status filter tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="queued">Queued</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="delivered">Delivered</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Delivery table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guest</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries === undefined ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                </TableRow>
              ))
            ) : deliveries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No delivery records yet
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              deliveries.map((delivery) => (
                <TableRow key={delivery._id}>
                  <TableCell className="font-medium">
                    {delivery.guestName}
                  </TableCell>
                  <TableCell>{delivery.phone}</TableCell>
                  <TableCell>
                    <SMSStatusBadge status={delivery.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {delivery.lastAttemptAt
                      ? new Date(delivery.lastAttemptAt).toLocaleString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
