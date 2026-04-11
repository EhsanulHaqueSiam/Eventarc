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
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        config: { qrStrategy, foodQrMode, foodQrTiming },
      });
      toast.success("Event created");
      setOpen(false);
      resetForm();
      navigate({ to: "/events/$eventId", params: { eventId } });
    } catch {
      toast.error("Failed to create event");
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
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
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

          <Separator />

          <div>
            <h4 className="mb-3 text-sm font-medium">QR Code Strategy</h4>
            <ToggleGroup
              type="single"
              value={qrStrategy}
              onValueChange={(v) => v && setQrStrategy(v as "unified" | "separate")}
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
                ? "Single QR code for both entry and food"
                : "Separate QR codes for entry and food"}
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium">Food QR Mode</h4>
            <ToggleGroup
              type="single"
              value={foodQrMode}
              onValueChange={(v) => v && setFoodQrMode(v as "guestLinked" | "anonymous")}
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
                ? "Food QR linked to specific guest for tracking"
                : "Anonymous food QR for general distribution"}
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium">Food QR Timing</h4>
            <ToggleGroup
              type="single"
              value={foodQrTiming}
              onValueChange={(v) => v && setFoodQrTiming(v as "preSent" | "postEntry")}
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
                ? "Food QR sent with invitation before event"
                : "Food QR generated after guest checks in"}
            </p>
          </div>
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
