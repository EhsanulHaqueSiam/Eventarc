import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CascadingSelect } from "./cascading-select";
import { toast } from "sonner";

interface ScannerSetupProps {
  onSessionCreated: () => void;
  createSession: (params: {
    stallId: string;
    eventId: string;
    vendorCategoryId: string;
    vendorTypeId: string;
    stallName: string;
  }) => Promise<boolean>;
}

export function ScannerSetup({
  onSessionCreated,
  createSession,
}: ScannerSetupProps) {
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [selectedVendorType, setSelectedVendorType] = useState<string | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedStall, setSelectedStall] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Fetch live events only
  const events = useQuery(api.events.list, { status: "live" });

  // Fetch vendor types for selected event
  const vendorTypes = useQuery(
    api.vendorTypes.listByEvent,
    selectedEvent ? { eventId: selectedEvent as Id<"events"> } : "skip",
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

  const allSelected =
    selectedEvent && selectedVendorType && selectedCategory && selectedStall;

  // Find stall name for the selected stall
  const selectedStallName =
    stalls?.find((s) => s._id === selectedStall)?.name ?? "";

  const handleEventChange = (value: string) => {
    setSelectedEvent(value);
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

  const handleStartScanning = async () => {
    if (!allSelected) return;
    setIsCreating(true);
    try {
      const success = await createSession({
        stallId: selectedStall,
        eventId: selectedEvent,
        vendorCategoryId: selectedCategory,
        vendorTypeId: selectedVendorType,
        stallName: selectedStallName,
      });
      if (success) {
        onSessionCreated();
      } else {
        toast.error("Failed to create session. Please try again.");
      }
    } catch {
      toast.error("Failed to create session. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          EventArc
        </h1>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-semibold">
            Select Your Station
          </CardTitle>
          <p className="text-center text-base text-muted-foreground">
            Choose your assigned scanning station to begin
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <CascadingSelect
            label="Event"
            placeholder="Select an event"
            options={events?.map((e) => ({ value: e._id, label: e.name }))}
            value={selectedEvent}
            onChange={handleEventChange}
          />

          <CascadingSelect
            label="Vendor Type"
            placeholder="Select vendor type"
            options={vendorTypes?.map((vt) => ({
              value: vt._id,
              label: vt.name === "entry" ? "Entry" : "Food",
            }))}
            value={selectedVendorType}
            onChange={handleVendorTypeChange}
            visible={!!selectedEvent}
          />

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
