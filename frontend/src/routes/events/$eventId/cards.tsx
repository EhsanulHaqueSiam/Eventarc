import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import { CardEditor } from "@/components/cards/card-editor";
import { TemplateSidebar } from "@/components/cards/template-sidebar";
import { CompositingStatus } from "@/components/cards/compositing-status";
import { SMSDashboard } from "@/components/cards/sms-dashboard";
import { useState } from "react";
import { toast } from "sonner";
import type { OverlayConfig } from "@/hooks/use-card-editor";

export const Route = createFileRoute("/events/$eventId/cards")({
  component: CardsPage,
});

function CardsPage() {
  const { eventId } = Route.useParams();
  const event = useQuery(api.events.getById, {
    eventId: eventId as Id<"events">,
  });
  const createTemplate = useMutation(api.cardTemplates.create);
  const [activeTab, setActiveTab] = useState("editor");
  const [activeTemplateId, setActiveTemplateId] = useState<
    Id<"cardTemplates"> | undefined
  >();

  if (event === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (event === null) {
    return (
      <div className="py-16 text-center">
        <h2 className="font-display text-lg font-semibold">Event not found</h2>
        <Link to="/events" className="mt-2 text-sm text-primary hover:underline">
          Back to events
        </Link>
      </div>
    );
  }

  const handleSaveTemplate = async (overlayConfig: OverlayConfig) => {
    try {
      await createTemplate({
        eventId: event._id,
        name: `Template ${new Date().toLocaleDateString()}`,
        backgroundImageUrl: "", // Will be set when full upload flow is wired
        backgroundImageKey: "",
        canvasWidth: 800,
        canvasHeight: 600,
        qrOverlay: overlayConfig,
      });
      toast.success("Template saved");
    } catch {
      toast.error("Failed to save template");
    }
  };

  const handleGenerateCards = () => {
    // Will trigger POST to Go backend once compositing endpoint is wired
    toast.info("Card generation will be triggered via the Go backend");
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/events">Events</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/events/$eventId" params={{ eventId }}>
                {event.name}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Invitation Card Editor</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Page heading */}
      <h1 className="font-display text-2xl font-semibold">Invitation Card Editor</h1>

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="sms">Send SMS</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-6">
          <div className="flex gap-0 rounded-lg border">
            <TemplateSidebar
              eventId={event._id}
              onSelect={setActiveTemplateId}
              activeTemplateId={activeTemplateId}
            />
            <div className="flex-1 p-4">
              <CardEditor
                eventId={eventId}
                onSave={handleSaveTemplate}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="generate" className="mt-6">
          <CompositingStatus
            eventId={eventId}
            onGenerate={handleGenerateCards}
          />
        </TabsContent>

        <TabsContent value="sms" className="mt-6">
          <SMSDashboard eventId={eventId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
