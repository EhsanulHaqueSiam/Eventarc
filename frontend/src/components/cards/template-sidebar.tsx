import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, MoreVertical, ImageIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface TemplateSidebarProps {
  eventId: Id<"events">;
  onSelect: (templateId: Id<"cardTemplates">) => void;
  activeTemplateId?: Id<"cardTemplates">;
}

export function TemplateSidebar({
  eventId,
  onSelect,
  activeTemplateId,
}: TemplateSidebarProps) {
  const templates = useQuery(api.cardTemplates.list, { eventId });
  const removeTemplate = useMutation(api.cardTemplates.remove);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"cardTemplates">;
    name: string;
  } | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await removeTemplate({ id: deleteTarget.id });
      toast.success("Template deleted");
    } catch {
      toast.error("Failed to delete template");
    }
    setDeleteTarget(null);
  };

  // Loading state
  if (templates === undefined) {
    return (
      <div className="flex w-[200px] flex-col gap-3 border-r p-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex w-[200px] flex-shrink-0 flex-col border-r">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-3">
        <span className="text-sm font-semibold">Templates</span>
        <Button variant="ghost" size="icon" className="size-7">
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Template list */}
      <ScrollArea className="flex-1">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <ImageIcon className="size-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No templates</p>
            <Button variant="outline" size="sm" className="mt-1">
              <Plus className="mr-1 size-3" />
              Create Template
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {templates.map((template) => (
              <TemplateCard
                key={template._id}
                id={template._id}
                name={template.name}
                backgroundUrl={template.backgroundImageUrl}
                isActive={template._id === activeTemplateId}
                onSelect={() => onSelect(template._id)}
                onDelete={() =>
                  setDeleteTarget({ id: template._id, name: template.name })
                }
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete template &apos;{deleteTarget?.name}&apos;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The template will be permanently deleted. Generated cards are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TemplateCard({
  name,
  backgroundUrl,
  isActive,
  onSelect,
  onDelete,
}: {
  id: Id<"cardTemplates">;
  name: string;
  backgroundUrl: string;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={`group cursor-pointer rounded-md border p-2 transition-colors hover:bg-accent/5 ${
        isActive ? "border-primary bg-accent/5" : "border-transparent"
      }`}
    >
      {/* Thumbnail */}
      <div className="mb-1.5 aspect-[4/3] overflow-hidden rounded-sm bg-muted">
        <img
          src={backgroundUrl}
          alt={name}
          className="size-full object-cover"
          loading="lazy"
        />
      </div>

      {/* Name + menu */}
      <div className="flex items-center justify-between">
        <span className="truncate text-xs font-medium">{name}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
            >
              <MoreVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
