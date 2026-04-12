import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { Skeleton } from "@/components/ui/skeleton";
import { MoreVertical, Calendar, MapPin, Users } from "lucide-react";
import { OverviewTab } from "@/components/events/overview-tab";
import { EventConfigForm } from "@/components/events/event-config-form";
import { CategoriesTab } from "@/components/events/categories-tab";
import { VendorsTab } from "@/components/events/vendors-tab";
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
  const event = useQuery(api.events.getById, {
    eventId: eventId as Id<"events">,
  });
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
        <h2 className="text-lg font-semibold">Event not found</h2>
        <Link to="/events" className="mt-2 text-sm text-primary hover:underline">
          Back to events
        </Link>
      </div>
    );
  }

  const handleDelete = async () => {
    try {
      await removeEvent({ eventId: event._id });
      toast.success("Event deleted");
      navigate({ to: "/events" });
    } catch {
      toast.error("Failed to delete event");
    }
  };

  const handleStatusChange = async (newStatus: "live" | "completed" | "archived") => {
    try {
      await updateStatus({ eventId: event._id, newStatus });
      toast.success(`Event transitioned to ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
    }
  };

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
            <BreadcrumbPage>{event.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{event.name}</h1>
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {event.status === "active" && (
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
                      This will sync all event data to the scanning system.
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
            {event.status === "live" && (
              <DropdownMenuItem onClick={() => handleStatusChange("completed")}>
                Complete Event
              </DropdownMenuItem>
            )}
            {event.status === "completed" && (
              <DropdownMenuItem onClick={() => handleStatusChange("archived")}>
                Archive
              </DropdownMenuItem>
            )}
            {event.status === "draft" && (
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
                      This will permanently delete this event and all associated data.
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
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="guests">
            <Users className="mr-1 size-3.5" />
            Guests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab event={event} />
        </TabsContent>

        <TabsContent value="configuration" className="mt-6">
          <EventConfigForm
            eventId={event._id}
            status={event.status}
            config={event.config}
          />
        </TabsContent>

        <TabsContent value="categories" className="mt-6">
          <CategoriesTab eventId={event._id} />
        </TabsContent>

        <TabsContent value="vendors" className="mt-6">
          <VendorsTab eventId={event._id} />
        </TabsContent>

        <TabsContent value="guests" className="mt-6">
          <GuestsTab eventId={event._id} eventIdStr={eventId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GuestsTab({ eventId, eventIdStr }: { eventId: Id<"events">; eventIdStr: string }) {
  const guestCount = useQuery(api.guests.countByEvent, { eventId });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Guest List</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Import and manage guest list for this event
            </p>
            {guestCount !== undefined && (
              <p className="mt-2 text-2xl font-semibold">
                {guestCount.toLocaleString()}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  guests
                </span>
              </p>
            )}
          </div>
          <Button asChild>
            <Link to="/events/$eventId/guests" params={{ eventId: eventIdStr }}>
              <Users className="mr-2 size-4" />
              Manage Guests
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
