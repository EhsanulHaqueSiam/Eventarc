import type { Id } from "convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LifecycleStepper } from "./lifecycle-stepper";

type EventStatus = "draft" | "active" | "live" | "completed" | "archived";

interface OverviewTabProps {
  event: {
    _id: Id<"events">;
    name: string;
    status: EventStatus;
    description?: string;
    createdAt: number;
    updatedAt: number;
  };
}

export function OverviewTab({ event }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Event Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          <LifecycleStepper
            eventId={event._id}
            eventName={event.name}
            status={event.status}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {event.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-sm">{event.description}</p>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Created</p>
            <p className="text-sm">{new Date(event.createdAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
            <p className="text-sm">{new Date(event.updatedAt).toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
