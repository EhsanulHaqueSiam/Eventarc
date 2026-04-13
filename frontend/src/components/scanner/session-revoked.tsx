import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldX } from "lucide-react";

interface SessionRevokedProps {
  onSelectNewStation: () => void;
}

export function SessionRevoked({ onSelectNewStation }: SessionRevokedProps) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-background px-4"
      aria-live="assertive"
    >
      <Card className="w-full max-w-md bg-[oklch(0.97_0.03_27)] shadow-lg">
        <CardContent className="space-y-4 p-8 text-center">
          <ShieldX className="mx-auto size-12 text-destructive" />
          <h2 className="text-2xl font-semibold text-foreground">
            Session Revoked
          </h2>
          <p className="text-base text-muted-foreground">
            This scanning session has been revoked by an administrator. Please
            contact your event coordinator.
          </p>
          <Button
            className="h-14 w-full text-base font-semibold"
            onClick={onSelectNewStation}
          >
            Select New Station
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
