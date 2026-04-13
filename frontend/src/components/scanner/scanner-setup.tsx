import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CascadingSelect } from "./cascading-select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ShieldCheck, UtensilsCrossed } from "lucide-react";

interface ScannerSetupProps {
  onSessionCreated: () => void;
  fixedEventId?: string;
  createSession: (params: {
    stallId: string;
    eventId: string;
    vendorCategoryId: string;
    vendorTypeId: string;
    vendorType: "entry" | "food";
    stallName: string;
    eventName?: string;
  }) => Promise<boolean>;
}

export function ScannerSetup({
  onSessionCreated,
  fixedEventId,
  createSession,
}: ScannerSetupProps) {
  const [selectedEventState, setSelectedEventState] = useState<string | null>(
    fixedEventId ?? null,
  );
  const [selectedVendorType, setSelectedVendorType] = useState<string | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedStall, setSelectedStall] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const selectedEvent = fixedEventId ?? selectedEventState;

  // Fetch live events (used for central scanner and fixed-event validation/name)
  const liveEvents = useQuery(api.events.list, { status: "live" });
  const fixedEvent = useMemo(
    () =>
      fixedEventId
        ? liveEvents?.find((event) => event._id === fixedEventId) ?? null
        : null,
    [fixedEventId, liveEvents],
  );
  const isFixedEventInvalid =
    Boolean(fixedEventId) &&
    Array.isArray(liveEvents) &&
    !liveEvents.some((event) => event._id === fixedEventId);
  const canQueryVendorTypes = Boolean(
    selectedEvent && (!fixedEventId || fixedEvent),
  );

  // Fetch vendor types for selected event
  const vendorTypes = useQuery(
    api.vendorTypes.listByEvent,
    canQueryVendorTypes
      ? { eventId: selectedEvent as Id<"events"> }
      : "skip",
  );

  // Fetch categories for selected vendor type
  const categories = useQuery(
    api.vendorCategories.listByVendorType,
    selectedVendorType
      ? { vendorTypeId: selectedVendorType as Id<"vendorTypes"> }
      : "skip",
  );

  // Fetch stalls for selected category
  const stalls = useQuery(
    api.stalls.listByCategory,
    selectedCategory
      ? { categoryId: selectedCategory as Id<"vendorCategories"> }
      : "skip",
  );

  const selectedVendorTypeName = vendorTypes?.find(
    (vt) => vt._id === selectedVendorType,
  )?.name;
  const allSelected =
    selectedEvent &&
    selectedVendorType &&
    selectedVendorTypeName &&
    selectedCategory &&
    selectedStall;

  const selectedStallName =
    stalls?.find((s) => s._id === selectedStall)?.name ?? "";

  const handleEventChange = (value: string) => {
    setSelectedEventState(value);
    setSelectedVendorType(null);
    setSelectedCategory(null);
    setSelectedStall(null);
  };

  const handleVendorTypeChange = (value: string) => {
    setSelectedVendorType(value);
    setSelectedCategory(null);
    setSelectedStall(null);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setSelectedStall(null);
  };

  const selectedEventName = fixedEvent?.name
    ?? liveEvents?.find((e) => e._id === selectedEvent)?.name
    ?? "";

  const handleStartScanning = async () => {
    if (!allSelected || !selectedVendorTypeName) return;
    if (selectedVendorTypeName !== "entry" && selectedVendorTypeName !== "food") {
      toast.error("Invalid station type selected.");
      return;
    }
    setIsCreating(true);
    try {
      const success = await createSession({
        stallId: selectedStall,
        eventId: selectedEvent,
        vendorCategoryId: selectedCategory,
        vendorTypeId: selectedVendorType,
        vendorType: selectedVendorTypeName,
        stallName: selectedStallName,
        eventName: selectedEventName,
      });
      if (success) {
        onSessionCreated();
      } else {
        toast.error("Couldn't connect to station. Check your connection and try again.");
      }
    } catch {
      toast.error("Couldn't connect to station. Check your connection and try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const stationTypeCards = [
    {
      id: vendorTypes?.find((vt) => vt.name === "entry")?._id ?? null,
      type: "entry",
      title: "Entry Volunteer",
      subtitle: "Go to Entry Gate",
      Icon: ShieldCheck,
    },
    {
      id: vendorTypes?.find((vt) => vt.name === "food")?._id ?? null,
      type: "food",
      title: "Food Volunteer",
      subtitle: "Go to Food Stall",
      Icon: UtensilsCrossed,
    },
  ] as const;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          EventArc
        </h1>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center font-display text-2xl font-semibold">
            Select Your Station
          </CardTitle>
          <p className="text-center text-base text-muted-foreground">
            Choose your assigned scanning station to begin
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {fixedEventId ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Event</label>
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                {fixedEvent ? (
                  <span className="font-medium">{fixedEvent.name}</span>
                ) : isFixedEventInvalid ? (
                  <span className="text-destructive">
                    Invalid scanner link or event is not live
                  </span>
                ) : (
                  <span className="text-muted-foreground">Loading event...</span>
                )}
              </div>
            </div>
          ) : (
            <CascadingSelect
              label="Event"
              placeholder="Select an event"
              options={liveEvents?.map((e) => ({ value: e._id, label: e.name }))}
              value={selectedEvent}
              onChange={handleEventChange}
            />
          )}

          {!!selectedEvent && !isFixedEventInvalid && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Station Type</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {stationTypeCards.map((card) => {
                  if (!card.id) return null;
                  const isSelected = selectedVendorType === card.id;
                  return (
                    <button
                      key={card.type}
                      type="button"
                      onClick={() => handleVendorTypeChange(card.id!)}
                      className={cn(
                        "rounded-xl border bg-card p-4 text-left transition-all",
                        "hover:border-primary/60 hover:shadow-sm",
                        isSelected && "border-primary ring-2 ring-primary/20",
                      )}
                    >
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                        <card.Icon className="size-6" />
                      </div>
                      <p className="font-semibold text-foreground">{card.title}</p>
                      <p className="text-sm text-muted-foreground">{card.subtitle}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <CascadingSelect
            label="Category"
            placeholder="Select category"
            options={categories?.map((c) => ({
              value: c._id,
              label: c.name,
            }))}
            value={selectedCategory}
            onChange={handleCategoryChange}
            visible={!!selectedVendorType}
          />

          <CascadingSelect
            label="Stall"
            placeholder="Select stall"
            options={stalls?.map((s) => ({
              value: s._id,
              label: s.name,
            }))}
            value={selectedStall}
            onChange={(v) => setSelectedStall(v)}
            visible={!!selectedCategory}
          />

          <Button
            className="mt-4 h-14 w-full text-base font-semibold"
            disabled={!allSelected || isCreating}
            onClick={handleStartScanning}
          >
            {isCreating ? "Creating Session..." : "Start Scanning"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
