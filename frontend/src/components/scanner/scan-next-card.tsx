import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X } from "lucide-react";

interface ScanNextCardProps {
  wasConfirmed: boolean;
  onScanNext: () => void;
}

export function ScanNextCard({ wasConfirmed, onScanNext }: ScanNextCardProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <Card className="w-[min(90vw,400px)] shadow-lg">
        <CardContent className="space-y-4 p-6 text-center">
          {wasConfirmed ? (
            <div className="flex items-center justify-center gap-2 text-[oklch(0.72_0.19_142)]">
              <Check className="size-5" />
              <span className="text-base font-medium">Confirmed</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <X className="size-5" />
              <span className="text-base font-medium">Dismissed</span>
            </div>
          )}
          <Button
            className="h-14 w-full text-base font-semibold"
            onClick={onScanNext}
            autoFocus
          >
            Scan Next
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
