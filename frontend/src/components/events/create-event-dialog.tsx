import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

export function CreateEventDialog() {
  const navigate = useNavigate();
  const createEvent = useMutation(api.events.create);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const [qrStrategy, setQrStrategy] = useState<"unified" | "separate">("unified");
  const [foodQrMode, setFoodQrMode] = useState<"guestLinked" | "anonymous">("guestLinked");
  const [foodQrTiming, setFoodQrTiming] = useState<"preSent" | "postEntry">("preSent");
  const [allowAdditionalGuests, setAllowAdditionalGuests] = useState(false);
  const [maxAdditionalGuests, setMaxAdditionalGuests] = useState<number>(-1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isValid = name.trim().length > 0 && date.length > 0 && new Date(date) > new Date();

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      const eventId = await createEvent({
        name: name.trim(),
        eventDate: new Date(date).getTime(),
        venue: venue.trim() || undefined,
        description: description.trim() || undefined,
        config: {
          qrStrategy,
          foodQrMode,
          foodQrTiming,
          allowAdditionalGuests: allowAdditionalGuests || undefined,
          maxAdditionalGuests: allowAdditionalGuests ? maxAdditionalGuests : undefined,
        },
      });
      trackEvent("event_created", {
        eventId,
        qrStrategy,
        foodQrMode,
        foodQrTiming,
        allowAdditionalGuests,
      });
      toast.success("Event created");
      setOpen(false);
      resetForm();
      navigate({ to: "/events/$eventId", params: { eventId } });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create event";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDate("");
    setVenue("");
    setDescription("");
    setQrStrategy("unified");
    setFoodQrMode("guestLinked");
    setFoodQrTiming("preSent");
    setAllowAdditionalGuests(false);
    setMaxAdditionalGuests(-1);
    setShowAdvanced(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Create Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Event name"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Date *</label>
            <Input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Venue</label>
            <Input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Venue name"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Event description"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Collapsible advanced configuration */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showAdvanced ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            Advanced Configuration
            <span className="ml-auto text-xs text-muted-foreground/60">
              Defaults work for most events
            </span>
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-md border border-border bg-muted/30 p-4">
              <div>
                <h4 className="mb-2 text-sm font-medium">QR Code Strategy</h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  How many QR codes each guest receives on their invitation card
                </p>
                <ToggleGroup
                  multiple={false}
                  value={[qrStrategy]}
                  onValueChange={([val]) => val && setQrStrategy(val as "unified" | "separate")}
                  className="justify-start"
                >
                  <ToggleGroupItem value="unified" className="px-4">
                    Unified
                  </ToggleGroupItem>
                  <ToggleGroupItem value="separate" className="px-4">
                    Separate
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="mt-1 text-xs text-muted-foreground">
                  {qrStrategy === "unified"
                    ? "One QR code handles both entry gate and food stall scanning"
                    : "Guest gets two QR codes: one for entry, one for food"}
                </p>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Food QR Mode</h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  Whether food distribution is tracked per guest or anonymously
                </p>
                <ToggleGroup
                  multiple={false}
                  value={[foodQrMode]}
                  onValueChange={([val]) => val && setFoodQrMode(val as "guestLinked" | "anonymous")}
                  className="justify-start"
                >
                  <ToggleGroupItem value="guestLinked" className="px-4">
                    Guest-Linked
                  </ToggleGroupItem>
                  <ToggleGroupItem value="anonymous" className="px-4">
                    Anonymous
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="mt-1 text-xs text-muted-foreground">
                  {foodQrMode === "guestLinked"
                    ? "Track which guest received food -- prevents duplicate servings"
                    : "Count food servings without tracking individual guests"}
                </p>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Food QR Timing</h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  When food QR codes are generated and sent to guests
                </p>
                <ToggleGroup
                  multiple={false}
                  value={[foodQrTiming]}
                  onValueChange={([val]) => val && setFoodQrTiming(val as "preSent" | "postEntry")}
                  className="justify-start"
                >
                  <ToggleGroupItem value="preSent" className="px-4">
                    Pre-sent
                  </ToggleGroupItem>
                  <ToggleGroupItem value="postEntry" className="px-4">
                    Post-entry
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="mt-1 text-xs text-muted-foreground">
                  {foodQrTiming === "preSent"
                    ? "Food QR included on the invitation card sent before the event"
                    : "Food QR generated only after guest checks in at the entry gate"}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium">Allow Additional Guests</h4>
                    <p className="text-xs text-muted-foreground">
                      Entry scanners can record extra persons
                    </p>
                  </div>
                  <Switch
                    checked={allowAdditionalGuests}
                    onCheckedChange={setAllowAdditionalGuests}
                  />
                </div>
                {allowAdditionalGuests && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">
                        Limit per invite
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={maxAdditionalGuests === -1}
                          onChange={(e) => setMaxAdditionalGuests(e.target.checked ? -1 : 5)}
                          className="size-3.5 rounded accent-primary"
                        />
                        No limit
                      </label>
                    </div>
                    {maxAdditionalGuests !== -1 && (
                      <Input
                        type="number"
                        min={1}
                        value={maxAdditionalGuests}
                        onChange={(e) => setMaxAdditionalGuests(Math.max(1, Number(e.target.value)))}
                        className="mt-1 w-32"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
