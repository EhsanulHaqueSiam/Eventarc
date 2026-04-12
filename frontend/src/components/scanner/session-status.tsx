import { Badge } from "@/components/ui/badge";

interface SessionStatusProps {
  isConnected: boolean;
}

export function SessionStatus({ isConnected }: SessionStatusProps) {
  return (
    <Badge variant="outline" className="gap-1.5 border-white/30 text-white">
      <span
        className={`inline-block size-2 rounded-full ${
          isConnected ? "bg-[oklch(0.72_0.19_142)]" : "bg-destructive"
        }`}
      />
      {isConnected ? "Connected" : "Disconnected"}
    </Badge>
  );
}
