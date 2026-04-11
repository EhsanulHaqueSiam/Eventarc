import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
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
import { Check } from "lucide-react";
import { toast } from "sonner";

type EventStatus = "draft" | "active" | "live" | "completed" | "archived";

const STEPS: EventStatus[] = ["draft", "active", "live", "completed", "archived"];

const TRANSITIONS: Record<EventStatus, { label: string; next: EventStatus }[]> = {
  draft: [{ label: "Advance to Active", next: "active" }],
  active: [
    { label: "Go Live Early", next: "live" },
    { label: "Revert to Draft", next: "draft" },
  ],
  live: [{ label: "Complete Event", next: "completed" }],
  completed: [{ label: "Archive Event", next: "archived" }],
  archived: [],
};

interface LifecycleStepperProps {
  eventId: Id<"events">;
  eventName: string;
  status: EventStatus;
}

export function LifecycleStepper({ eventId, eventName, status }: LifecycleStepperProps) {
  const updateStatus = useMutation(api.events.updateStatus);
  const currentIndex = STEPS.indexOf(status);

  const handleTransition = async (newStatus: EventStatus) => {
    try {
      await updateStatus({ eventId, newStatus });
      toast.success(`Event transitioned to ${newStatus}`);
    } catch {
      toast.error("Failed to update event status");
    }
  };

  return (
    <div className="space-y-6">
      {/* Stepper visualization */}
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isPast = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div key={step} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-medium ${
                    isCurrent
                      ? "border-primary bg-primary text-primary-foreground"
                      : isPast
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                >
                  {isPast ? <Check className="size-4" /> : i + 1}
                </div>
                <span
                  className={`mt-2 text-xs capitalize ${
                    isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 ${
                    i < currentIndex ? "bg-primary" : "bg-muted-foreground/20"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {TRANSITIONS[status].map((t) => {
          if (t.next === "live") {
            return (
              <AlertDialog key={t.next}>
                <AlertDialogTrigger asChild>
                  <Button>{t.label}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Go live with &apos;{eventName}&apos;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will sync all event data to the scanning system. Once
                      live, the event cannot be reverted to draft.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleTransition(t.next)}>
                      Go Live
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          }
          return (
            <Button
              key={t.next}
              variant={t.next === "draft" ? "outline" : "default"}
              onClick={() => handleTransition(t.next)}
            >
              {t.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
