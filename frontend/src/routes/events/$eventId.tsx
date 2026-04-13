import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Button } from "@/components/ui/button";
import { PageTransition } from "@/lib/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreVertical, Calendar, MapPin, Users, ImageIcon, ScanLine } from "lucide-react";
import { OverviewTab } from "@/components/events/overview-tab";
import { EventConfigForm } from "@/components/events/event-config-form";
import { CategoriesTab } from "@/components/events/categories-tab";
import { VendorsTab } from "@/components/events/vendors-tab";
import { EventAccessTab } from "@/components/events/event-access-tab";
import { ExportEventButton } from "@/components/events/export-event-button";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { ActiveSessionsTab } from "@/components/sessions/active-sessions-tab";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/events/$eventId")({
  component: EventDetailPage,
});

const statusStyles: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  active: "border-primary text-primary bg-transparent",
  live: "bg-success text-success-foreground",
  completed: "bg-secondary text-secondary-foreground",
  archived: "bg-muted text-muted-foreground",
};

function EventDetailPage() {
  const { eventId } = Route.useParams();
  const location = useLocation();
  const eventRootPath = `/events/${eventId}`;
  const normalizedPath =
    location.pathname.length > 1
      ? location.pathname.replace(/\/$/, "")
      : location.pathname;
  const isNestedChildRoute = normalizedPath !== eventRootPath;

  // Render nested pages (/cards, /guests, etc.) through Outlet.
  // Without this, those feature routes exist in the router but never mount.
  if (isNestedChildRoute) {
    return <Outlet />;
  }

  const event = useQuery(api.events.getById, {
    eventId: eventId as Id<"events">,
  });
  const myAccess = useQuery(api.auth.getMyAccess);
  const updateStatus = useMutation(api.events.updateStatus);
  const removeEvent = useMutation(api.events.remove);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");

  if (event === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (event === null) {
    return (
      <div className="py-16 text-center">
        <h2 className="font-display text-lg font-semibold">Event not found</h2>
        <Link to="/events" className="mt-2 text-sm text-primary hover:underline">
          Back to events
        </Link>
      </div>
    );
  }

  const isAdmin = myAccess?.isAdmin ?? false;
  const permission = (myAccess?.eventPermissions ?? []).find(
    (entry) => entry.eventId === event._id,
  );
  const canEditEvent = isAdmin || Boolean(permission?.canEdit);
  const canShowStatusMenu =
    (event.status === "active" && canEditEvent) ||
    (event.status === "live" && canEditEvent) ||
    (event.status === "completed" && canEditEvent) ||
    (event.status === "draft" && isAdmin);

  const handleDelete = async () => {
    try {
      await removeEvent({ eventId: event._id });
      toast.success("Event deleted");
      navigate({ to: "/events" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete event. Check your connection and try again.");
    }
  };

  const handleStatusChange = async (newStatus: "live" | "completed" | "archived") => {
    try {
      await updateStatus({ eventId: event._id, newStatus });
      toast.success(`Event transitioned to ${newStatus}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not change status to ${newStatus}. Try again.`);
    }
  };

  return (
    <PageTransition className="space-y-8">
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
            <BreadcrumbPage>{event.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold leading-tight">{event.name}</h1>
            <Badge className={statusStyles[event.status]} variant="outline">
              {event.status}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
            {event.venue && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {event.venue}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" />
              {new Date(event.eventDate).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ExportEventButton eventId={event._id} eventName={event.name} />
          {event.status === "live" && (
            <Button variant="outline" render={<Link to="/$eventId/scanner" params={{ eventId }} />}>
              <ScanLine className="size-4" />
              Scanner
            </Button>
          )}
          <Button variant="outline" render={<Link to="/events/$eventId/cards" params={{ eventId }} />}>
            <ImageIcon className="size-4" />
            Cards & SMS
          </Button>
          {canShowStatusMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
              {event.status === "active" && canEditEvent && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      Go Live Early
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Go live with &apos;{event.name}&apos;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Once live, the event will be available to scanners and cannot be reverted to draft. All guest and vendor data will sync to scanning devices.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleStatusChange("live")}>
                        Go Live
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {event.status === "live" && canEditEvent && (
                <DropdownMenuItem onClick={() => handleStatusChange("completed")}>
                  Complete Event
                </DropdownMenuItem>
              )}
              {event.status === "completed" && canEditEvent && (
                <DropdownMenuItem onClick={() => handleStatusChange("archived")}>
                  Archive
                </DropdownMenuItem>
              )}
              {event.status === "draft" && isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem
                      onSelect={(e) => e.preventDefault()}
                      className="text-destructive"
                    >
                      Delete
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &apos;{event.name}&apos;?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this event, including all guests, categories, vendors, and invitation cards. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="guests">
            <Users className="mr-1 size-3.5" />
            Guests
          </TabsTrigger>
          {event.status === "live" && (
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          )}
          {event.status === "live" && (
            <TabsTrigger value="live">Live</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab event={event} canEdit={canEditEvent} />
        </TabsContent>

        <TabsContent value="configuration" className="mt-6">
          <EventConfigForm
            eventId={event._id}
            status={event.status}
            config={event.config}
            canEdit={canEditEvent}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <CategoriesTab eventId={event._id} canEdit={canEditEvent} />
        </TabsContent>

        <TabsContent value="vendors" className="mt-6">
          <VendorsTab eventId={event._id} canEdit={canEditEvent} />
        </TabsContent>

        <TabsContent value="access" className="mt-6">
          <EventAccessTab eventId={event._id} />
        </TabsContent>

        <TabsContent value="guests" className="mt-6">
          <GuestsTab eventId={event._id} eventIdStr={eventId} />
        </TabsContent>

        {event.status === "live" && (
          <TabsContent value="sessions" className="mt-6">
            <ActiveSessionsTab eventId={event._id} />
          </TabsContent>
        )}

        {event.status === "live" && (
          <TabsContent value="live" className="mt-6">
            <LiveDashboard eventId={eventId} />
          </TabsContent>
        )}
      </Tabs>
    </PageTransition>
  );
}

function GuestsTab({ eventId, eventIdStr }: { eventId: Id<"events">; eventIdStr: string }) {
  const guestCount = useQuery(api.guests.countByEvent, { eventId });

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-card p-6 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold">Guest List</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Import and manage guest list for this event
            </p>
            {guestCount !== undefined && (
              <p className="mt-2 font-display text-2xl font-semibold">
                {guestCount.toLocaleString()}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  guests
                </span>
              </p>
            )}
          </div>
          <Button className="shrink-0 whitespace-nowrap" render={<Link to="/events/$eventId/guests" params={{ eventId: eventIdStr }} />}>
            <Users className="size-4" />
            Manage Guests
          </Button>
        </div>
      </div>
    </div>
  );
}
