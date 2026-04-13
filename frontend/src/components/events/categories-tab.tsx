import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

interface CategoriesTabProps {
  eventId: Id<"events">;
  canEdit?: boolean;
}

export function CategoriesTab({ eventId, canEdit = true }: CategoriesTabProps) {
  const categories = useQuery(api.categories.listByEvent, { eventId });
  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const removeCategory = useMutation(api.categories.remove);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<Id<"guestCategories"> | null>(null);
  const [editName, setEditName] = useState("");

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await createCategory({ eventId, name: newName.trim() });
      toast.success("Category added");
      setNewName("");
      setIsAdding(false);
    } catch {
      toast.error("Failed to add category");
    }
  };

  const handleUpdate = async (categoryId: Id<"guestCategories">) => {
    if (!editName.trim()) return;
    try {
      await updateCategory({ categoryId, name: editName.trim() });
      toast.success("Category updated");
      setEditingId(null);
    } catch {
      toast.error("Failed to update category");
    }
  };

  const handleRemove = async (categoryId: Id<"guestCategories">) => {
    try {
      await removeCategory({ categoryId });
      toast.success("Category removed");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to remove category";
      if (msg.includes("Cannot delete the default")) {
        toast.error("Cannot delete the default category");
      } else {
        toast.error(msg);
      }
    }
  };

  if (!categories) {
    return <p className="text-muted-foreground">Loading categories...</p>;
  }

  const hasCustomCategories = categories.some((c) => !c.isDefault);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category Name</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-24">Guests</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((cat) => (
            <TableRow key={cat._id}>
              <TableCell>
                {editingId === cat._id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 w-48"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdate(cat._id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => handleUpdate(cat._id)}
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span>{cat.name}</span>
                )}
              </TableCell>
              <TableCell>
                {cat.isDefault && <Badge variant="secondary">Default</Badge>}
              </TableCell>
              <TableCell className="text-muted-foreground">--</TableCell>
              <TableCell className="text-right">
                {canEdit && (
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => {
                      setEditingId(cat._id);
                      setEditName(cat.name);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {!cat.isDefault && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove &apos;{cat.name}&apos;?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Guests in this category will need to be reassigned.
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRemove(cat._id)}
                            className="bg-destructive text-destructive-foreground"
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {!hasCustomCategories && (
        <div className="rounded-xl bg-muted/30 py-8 text-center">
          <p className="text-sm font-medium">Only the default category is active</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Add custom categories to group guests with different privileges, such as VIP, Staff, or Press.
          </p>
        </div>
      )}

      {canEdit && (isAdding ? (
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name"
            className="h-9 w-60"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") setIsAdding(false);
            }}
            autoFocus
          />
          <Button size="sm" onClick={handleAdd}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setIsAdding(true)}>
          <Plus className="mr-2 size-4" />
          Add Category
        </Button>
      ))}
    </div>
  );
}
