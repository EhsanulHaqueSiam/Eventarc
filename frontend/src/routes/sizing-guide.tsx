import { createFileRoute } from "@tanstack/react-router";
import { SizingGuide } from "@/components/sizing-guide";

export const Route = createFileRoute("/sizing-guide")({
  component: SizingGuidePage,
});

function SizingGuidePage() {
  return <SizingGuide />;
}
