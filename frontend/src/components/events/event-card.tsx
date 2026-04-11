import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { MoreVertical, Calendar, MapPin } from "lucide-react";
import { toast } from "sonner";

type EventStatus = "draft" | "active" | "live" | "completed" | "archived";

interface EventCardProps {
  event: {
    _id: Id<"events">;
    name: string;
    status: EventStatus;
    eventDate: number;
    venue?: string;
    description?: string;
  };
}

const statusStyles: Record<EventStatus, string> = {
  draft: "bg-secondary text-secondary-foreground border-warning/30",
  active: "border-primary text-primary bg-transparent",
  live: "bg-success text-success-foreground",
  completed: "bg-secondary text-secondary-foreground",
  archived: "bg-muted text-muted-foreground",
};

export function EventCard({ event }: EventCardProps) {
  const navigate = useNavigate();
  const removeEvent = useMutation(api.events.remove);

  const handleDelete = async () => {
    try {
      await removeEvent({ eventId: event._id });
      toast.success("Event deleted");
    } catch {
      toast.error("Failed to delete event");
    }
  };

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={() => navigate({ to: "/events/$eventId", params: { eventId: event._id } })}
    >
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <Badge className={statusStyles[event.status]} variant="outline">
          {event.status}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={() =>
                navigate({
                  to: "/events/$eventId",
                  params: { eventId: event._id },
                })
              }
            >
              View Details
            </DropdownMenuItem>
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
                      This will permanently delete this draft event and all its
                      categories, vendors, and stalls. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <h3 className="text-lg font-semibold">{event.name}</h3>
        <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" />
            {new Date(event.eventDate).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          {event.venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" />
              {event.venue}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Guests: --</p>
      </CardContent>
    </Card>
  );
}
