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
import { motion, useReducedMotion } from "motion/react";
import { trackEvent } from "@/lib/analytics";

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

const easeOutQuart = [0.25, 1, 0.5, 1] as const;

interface LifecycleStepperProps {
  eventId: Id<"events">;
  eventName: string;
  status: EventStatus;
}

export function LifecycleStepper({ eventId, eventName, status }: LifecycleStepperProps) {
  const updateStatus = useMutation(api.events.updateStatus);
  const currentIndex = STEPS.indexOf(status);
  const shouldReduce = useReducedMotion();

  const handleTransition = async (newStatus: EventStatus) => {
    try {
      await updateStatus({ eventId, newStatus });
      trackEvent(`event_transition_${newStatus}`, {
        eventId,
        fromStatus: status,
        toStatus: newStatus,
      });
      toast.success(`Event transitioned to ${newStatus}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not transition to ${newStatus}. Try again.`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stepper visualization */}
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isPast = i < currentIndex;
          const isCurrent = i === currentIndex;
          const delay = shouldReduce ? 0 : i * 0.1;

          return (
            <motion.div
              key={step}
              className="flex flex-1 items-center"
              initial={shouldReduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay, ease: easeOutQuart }}
            >
              <div className="flex flex-col items-center">
                <motion.div
                  className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors duration-300 ${
                    isCurrent
                      ? "border-primary bg-primary text-primary-foreground"
                      : isPast
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-muted-foreground/30 text-muted-foreground"
                  }`}
                  animate={
                    isCurrent && !shouldReduce
                      ? {
                          boxShadow: [
                            "0 0 0 0px oklch(0.205 0 0 / 0)",
                            "0 0 0 6px oklch(0.205 0 0 / 0.08)",
                            "0 0 0 0px oklch(0.205 0 0 / 0)",
                          ],
                        }
                      : {}
                  }
                  transition={
                    isCurrent
                      ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
                      : {}
                  }
                >
                  {isPast ? (
                    <motion.div
                      initial={shouldReduce ? false : { scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.25, delay: delay + 0.15, ease: easeOutQuart }}
                    >
                      <Check className="size-4" />
                    </motion.div>
                  ) : (
                    i + 1
                  )}
                </motion.div>
                <span
                  className={`mt-2 text-xs capitalize ${
                    isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {step}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="relative mx-2 h-0.5 flex-1 bg-muted-foreground/20">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-primary"
                    initial={shouldReduce ? { width: isPast ? "100%" : "0%" } : { width: "0%" }}
                    animate={{ width: isPast ? "100%" : "0%" }}
                    transition={{ duration: 0.5, delay: delay + 0.2, ease: easeOutQuart }}
                  />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Action buttons */}
      <motion.div
        className="flex flex-wrap gap-2"
        initial={shouldReduce ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.6, ease: easeOutQuart }}
      >
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
          if (t.next === "draft") {
            return (
              <AlertDialog key={t.next}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline">{t.label}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revert &apos;{eventName}&apos; to draft?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will move the event back to draft status. Any configured vendors and stalls will be preserved, but the event will need to be re-activated before going live.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleTransition(t.next)}>
                      Revert to Draft
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            );
          }
          return (
            <Button
              key={t.next}
              onClick={() => handleTransition(t.next)}
            >
              {t.label}
            </Button>
          );
        })}
      </motion.div>
    </div>
  );
}
