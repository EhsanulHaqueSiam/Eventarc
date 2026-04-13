import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
    allowAdditionalGuests?: boolean;
    maxAdditionalGuests?: number;
  };
  canEdit?: boolean;
}

export function EventConfigForm({ eventId, status, config, canEdit = true }: EventConfigFormProps) {
  const updateConfig = useMutation(api.events.updateConfig);
  const [qrStrategy, setQrStrategy] = useState(config.qrStrategy);
  const [foodQrMode, setFoodQrMode] = useState(config.foodQrMode);
  const [foodQrTiming, setFoodQrTiming] = useState(config.foodQrTiming);
  const [allowAdditionalGuests, setAllowAdditionalGuests] = useState(Boolean(config.allowAdditionalGuests));
  const [maxAdditionalGuests, setMaxAdditionalGuests] = useState<number>(config.maxAdditionalGuests ?? 5);
  const [isSaving, setIsSaving] = useState(false);

  const isLocked = !canEdit || status === "live" || status === "completed" || status === "archived";
  const currentAllowAdditionalGuests = Boolean(config.allowAdditionalGuests);
  const currentMaxAdditionalGuests = config.maxAdditionalGuests ?? 5;
  const hasChanges =
    qrStrategy !== config.qrStrategy ||
    foodQrMode !== config.foodQrMode ||
    foodQrTiming !== config.foodQrTiming ||
    allowAdditionalGuests !== currentAllowAdditionalGuests ||
    (allowAdditionalGuests && maxAdditionalGuests !== currentMaxAdditionalGuests);

  useEffect(() => {
    setQrStrategy(config.qrStrategy);
    setFoodQrMode(config.foodQrMode);
    setFoodQrTiming(config.foodQrTiming);
    setAllowAdditionalGuests(Boolean(config.allowAdditionalGuests));
    setMaxAdditionalGuests(config.maxAdditionalGuests ?? 5);
  }, [config]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateConfig({
        eventId,
        config: {
          qrStrategy,
          foodQrMode,
          foodQrTiming,
          allowAdditionalGuests: allowAdditionalGuests || undefined,
          maxAdditionalGuests: allowAdditionalGuests ? maxAdditionalGuests : undefined,
        },
      });
      toast.success("Event settings saved");
    } catch {
      toast.error("Couldn't save settings. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setQrStrategy(config.qrStrategy);
    setFoodQrMode(config.foodQrMode);
    setFoodQrTiming(config.foodQrTiming);
    setAllowAdditionalGuests(Boolean(config.allowAdditionalGuests));
    setMaxAdditionalGuests(config.maxAdditionalGuests ?? 5);
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
            multiple={false}
            value={[qrStrategy]}
            onValueChange={([val]) => !isLocked && val && setQrStrategy(val as "unified" | "separate")}
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
            multiple={false}
            value={[foodQrMode]}
            onValueChange={([val]) => !isLocked && val && setFoodQrMode(val as "guestLinked" | "anonymous")}
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
            multiple={false}
            value={[foodQrTiming]}
            onValueChange={([val]) => !isLocked && val && setFoodQrTiming(val as "preSent" | "postEntry")}
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

      <Card>
        <CardHeader>
          <CardTitle>Entry Additional Guests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Allow Additional Guests</p>
              <p className="text-sm text-muted-foreground">
                Entry vendors can record how many extra people arrived with the invited guest.
              </p>
            </div>
            <Switch
              checked={allowAdditionalGuests}
              onCheckedChange={(checked) => {
                if (isLocked) return;
                setAllowAdditionalGuests(checked);
                if (checked && maxAdditionalGuests === 0) {
                  setMaxAdditionalGuests(5);
                }
              }}
              disabled={isLocked}
            />
          </div>

          {allowAdditionalGuests && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <ToggleGroup
                multiple={false}
                value={[maxAdditionalGuests < 0 ? "unlimited" : "limited"]}
                onValueChange={([val]) => {
                  if (isLocked || !val) return;
                  if (val === "unlimited") {
                    setMaxAdditionalGuests(-1);
                    return;
                  }
                  setMaxAdditionalGuests((prev) => (prev < 1 ? 1 : prev));
                }}
                disabled={isLocked}
                className="justify-start"
              >
                <ToggleGroupItem value="limited" className="px-4">
                  Set Limit
                </ToggleGroupItem>
                <ToggleGroupItem value="unlimited" className="px-4">
                  No Limit
                </ToggleGroupItem>
              </ToggleGroup>

              {maxAdditionalGuests >= 0 && (
                <div className="w-40">
                  <p className="mb-1 text-xs text-muted-foreground">
                    Maximum additional guests per invite
                  </p>
                  <Input
                    type="number"
                    min={1}
                    value={maxAdditionalGuests}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(parsed) || parsed < 1) {
                        setMaxAdditionalGuests(1);
                        return;
                      }
                      setMaxAdditionalGuests(parsed);
                    }}
                    disabled={isLocked}
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {maxAdditionalGuests < 0
                  ? "Guests can bring any number of additional people."
                  : `Each invite allows up to ${maxAdditionalGuests} additional guests.`}
              </p>
            </div>
          )}
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
