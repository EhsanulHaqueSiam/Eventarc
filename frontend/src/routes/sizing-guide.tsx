import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sizing-guide")({
  component: SizingGuidePage,
});

function SizingGuidePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Infrastructure Sizing Guide</h1>
      <p className="text-muted-foreground mt-2">
        Sizing guide placeholder - will be implemented in Task 2.
      </p>
    </div>
  );
}
