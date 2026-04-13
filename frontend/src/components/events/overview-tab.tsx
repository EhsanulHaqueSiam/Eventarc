import type { Id } from "convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LifecycleStepper } from "./lifecycle-stepper";
import { Check, Circle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

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
  canEdit: boolean;
}

const easeOutQuart = [0.25, 1, 0.5, 1] as const;

function SetupChecklist({ eventId, status }: { eventId: Id<"events">; status: EventStatus }) {
  const categories = useQuery(api.categories.listByEvent, { eventId });
  const vendorCategories = useQuery(api.vendorCategories.listByEvent, { eventId });
  const guestCount = useQuery(api.guests.countByEvent, { eventId });
  const shouldReduce = useReducedMotion();

  if (status === "live" || status === "completed" || status === "archived") return null;

  const steps = [
    {
      label: "Guest categories created",
      description: "Define categories like VIP, Staff, Press",
      done: (categories?.length ?? 0) > 0,
    },
    {
      label: "Vendors configured",
      description: "Add entry gates and food stall categories",
      done: (vendorCategories?.length ?? 0) > 0,
    },
    {
      label: "Guests imported",
      description: "Import guest list via CSV or add manually",
      done: (guestCount ?? 0) > 0,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Setup Progress</CardTitle>
          <span className="text-sm text-muted-foreground">
            {completedCount}/{steps.length} complete
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {allDone ? (
          <motion.p
            className="text-sm text-muted-foreground"
            initial={shouldReduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            All setup steps are complete. You can activate this event when ready.
          </motion.p>
        ) : (
          <ul className="space-y-3">
            {steps.map((step, i) => (
              <motion.li
                key={step.label}
                className="flex items-start gap-3"
                initial={shouldReduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.08, ease: easeOutQuart }}
              >
                {step.done ? (
                  <motion.div
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[oklch(0.72_0.19_142)]"
                    initial={shouldReduce ? false : { scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.25, delay: i * 0.08 + 0.15, ease: easeOutQuart }}
                  >
                    <Check className="size-3 text-white" />
                  </motion.div>
                ) : (
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/40" />
                )}
                <div>
                  <p className={`text-sm font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}>
                    {step.label}
                  </p>
                  {!step.done && (
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  )}
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ event, canEdit }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <SetupChecklist eventId={event._id} status={event.status} />

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
