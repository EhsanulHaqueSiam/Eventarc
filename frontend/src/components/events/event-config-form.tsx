import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock } from "lucide-react";
import { toast } from "sonner";

type EventStatus = "draft" | "active" | "live" | "completed" | "archived";

interface EventConfigFormProps {
  eventId: Id<"events">;
  status: EventStatus;
  config: {
    qrStrategy: "unified" | "separate";
    foodQrMode: "guestLinked" | "anonymous";
    foodQrTiming: "preSent" | "postEntry";
  };
}

export function EventConfigForm({ eventId, status, config }: EventConfigFormProps) {
  const updateConfig = useMutation(api.events.updateConfig);
  const [qrStrategy, setQrStrategy] = useState(config.qrStrategy);
  const [foodQrMode, setFoodQrMode] = useState(config.foodQrMode);
  const [foodQrTiming, setFoodQrTiming] = useState(config.foodQrTiming);
  const [isSaving, setIsSaving] = useState(false);

  const isLocked = status === "live" || status === "completed" || status === "archived";
  const hasChanges =
    qrStrategy !== config.qrStrategy ||
    foodQrMode !== config.foodQrMode ||
    foodQrTiming !== config.foodQrTiming;

  useEffect(() => {
    setQrStrategy(config.qrStrategy);
    setFoodQrMode(config.foodQrMode);
    setFoodQrTiming(config.foodQrTiming);
  }, [config]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateConfig({
        eventId,
        config: { qrStrategy, foodQrMode, foodQrTiming },
      });
      toast.success("Configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setQrStrategy(config.qrStrategy);
    setFoodQrMode(config.foodQrMode);
    setFoodQrTiming(config.foodQrTiming);
  };

  return (
    <div className="space-y-6">
      {isLocked && (
        <Alert>
          <Lock className="size-4" />
          <AlertDescription>
            Configuration is locked once the event is live. These settings
            cannot be modified.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>QR Code Strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            value={qrStrategy}
            onValueChange={(v) => !isLocked && v && setQrStrategy(v as "unified" | "separate")}
            disabled={isLocked}
            className="justify-start"
          >
            <ToggleGroupItem value="unified" className="px-4">
              Unified
            </ToggleGroupItem>
            <ToggleGroupItem value="separate" className="px-4">
              Separate
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-sm text-muted-foreground">
            {qrStrategy === "unified"
              ? "Single QR code serves both entry and food scanning"
              : "Separate QR codes for entry verification and food distribution"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Food QR Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            value={foodQrMode}
            onValueChange={(v) => !isLocked && v && setFoodQrMode(v as "guestLinked" | "anonymous")}
            disabled={isLocked}
            className="justify-start"
          >
            <ToggleGroupItem value="guestLinked" className="px-4">
              Guest-Linked
            </ToggleGroupItem>
            <ToggleGroupItem value="anonymous" className="px-4">
              Anonymous
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-sm text-muted-foreground">
            {foodQrMode === "guestLinked"
              ? "Each food QR is tied to a specific guest for per-person tracking"
              : "Food QRs are anonymous and can be used by anyone"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Food QR Timing</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            value={foodQrTiming}
            onValueChange={(v) => !isLocked && v && setFoodQrTiming(v as "preSent" | "postEntry")}
            disabled={isLocked}
            className="justify-start"
          >
            <ToggleGroupItem value="preSent" className="px-4">
              Pre-sent
            </ToggleGroupItem>
            <ToggleGroupItem value="postEntry" className="px-4">
              Post-entry
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-2 text-sm text-muted-foreground">
            {foodQrTiming === "preSent"
              ? "Food QR is sent with the invitation card before the event"
              : "Food QR is generated after the guest checks in at entry"}
          </p>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      {hasChanges && !isLocked && (
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-background py-4">
          <Button variant="outline" onClick={handleDiscard}>
            Discard Changes
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Configuration"}
          </Button>
        </div>
      )}
    </div>
  );
}
