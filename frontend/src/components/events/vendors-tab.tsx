import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FoodRulesMatrix } from "./food-rules-matrix";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Plus, Trash2, Settings } from "lucide-react";
import { toast } from "sonner";

interface VendorsTabProps {
  eventId: Id<"events">;
  canEdit?: boolean;
}

export function VendorsTab({ eventId, canEdit = true }: VendorsTabProps) {
  const vendorData = useQuery(api.vendors.listByEvent, { eventId });
  const createCategory = useMutation(api.vendors.createCategory);
  const removeVendorCategory = useMutation(api.vendors.removeCategory);
  const createStall = useMutation(api.stalls.create);
  const updateStall = useMutation(api.stalls.update);
  const removeStall = useMutation(api.stalls.remove);

  const [addingType, setAddingType] = useState<"entry" | "food" | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<{
    _id: Id<"vendorCategories">;
    name: string;
  } | null>(null);
  const [newStallName, setNewStallName] = useState("");
  const [addingStall, setAddingStall] = useState(false);

  const foodCategories = vendorData?.food.categories ?? [];

  const handleAddCategory = async (type: "entry" | "food") => {
    if (!newCategoryName.trim()) return;
    try {
      await createCategory({ eventId, type, name: newCategoryName.trim() });
      toast.success("Vendor category added");
      setNewCategoryName("");
      setAddingType(null);
    } catch {
      toast.error("Failed to add vendor category");
    }
  };

  const handleRemoveCategory = async (categoryId: Id<"vendorCategories">) => {
    try {
      await removeVendorCategory({ categoryId });
      toast.success("Vendor category removed");
    } catch {
      toast.error("Failed to remove vendor category");
    }
  };

  const handleAddStall = async () => {
    if (!selectedCategory || !newStallName.trim()) return;
    try {
      await createStall({ categoryId: selectedCategory._id, name: newStallName.trim() });
      toast.success("Stall added");
      setNewStallName("");
      setAddingStall(false);
    } catch {
      toast.error("Failed to add stall");
    }
  };

  const handleRemoveStall = async (stallId: Id<"stalls">) => {
    try {
      await removeStall({ stallId });
      toast.success("Stall removed");
    } catch {
      toast.error("Failed to remove stall");
    }
  };

  const handleToggleStall = async (stallId: Id<"stalls">, isActive: boolean) => {
    try {
      await updateStall({ stallId, isActive: !isActive });
    } catch {
      toast.error("Failed to update stall");
    }
  };

  if (!vendorData) {
    return <p className="text-muted-foreground">Loading vendors...</p>;
  }

  const renderSection = (type: "entry" | "food", label: string) => {
    const section = vendorData[type];
    return (
      <div className="space-y-4">
        <h3 className="font-display text-lg font-semibold">{label}</h3>

        {section.categories.length === 0 ? (
          <div className="rounded-xl bg-muted/30 py-8 text-center">
            <p className="text-sm font-medium">No {type} categories yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add a category to start managing {type} vendor stalls and scanning stations.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {section.categories.map((cat) => (
              <Card key={cat._id}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">{cat.name}</CardTitle>
                  {canEdit && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="size-7 text-destructive">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove &apos;{cat.name}&apos;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          All stalls in this category will also be removed. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleRemoveCategory(cat._id)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {cat.stalls.length} stall{cat.stalls.length !== 1 ? "s" : ""}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setSelectedCategory({ _id: cat._id, name: cat.name })}
                  >
                    <Settings className="mr-2 size-3.5" />
                    Manage Stalls
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {canEdit && (addingType === type ? (
          <div className="flex items-center gap-2">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={`${type === "entry" ? "Entry" : "Food"} category name`}
              className="h-9 w-60"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCategory(type);
                if (e.key === "Escape") setAddingType(null);
              }}
              autoFocus
            />
            <Button size="sm" onClick={() => handleAddCategory(type)}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingType(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAddingType(type)}>
            <Plus className="size-4" />
            Add {label.replace(" Vendors", "")} Category
          </Button>
        ))}
      </div>
    );
  };

  // Find stalls for selected category
  const selectedCategoryStalls = selectedCategory
    ? [
        ...(vendorData.entry.categories.find((c) => c._id === selectedCategory._id)?.stalls ?? []),
        ...(vendorData.food.categories.find((c) => c._id === selectedCategory._id)?.stalls ?? []),
      ]
    : [];

  return (
    <div className="space-y-8">
      {renderSection("entry", "Entry Vendors")}
      {renderSection("food", "Food Vendors")}

      <FoodRulesMatrix eventId={eventId} foodCategories={foodCategories} />

      {/* Stall management sheet */}
      <Sheet
        open={!!selectedCategory}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCategory(null);
            setAddingStall(false);
            setNewStallName("");
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-[400px]">
          <SheetHeader>
            <SheetTitle>{selectedCategory?.name} Stalls</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {selectedCategoryStalls.length === 0 && !addingStall ? (
              <div className="py-6 text-center">
                <p className="text-sm font-medium">No stalls yet</p>
                <p className="mx-auto mt-1 max-w-[250px] text-sm text-muted-foreground">
                  Add stalls to create scanning stations operators can connect to during the event.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedCategoryStalls.map((stall) => (
                    <TableRow key={stall._id}>
                      <TableCell>{stall.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={stall.isActive ? "default" : "secondary"}
                          className="cursor-pointer"
                          onClick={() => handleToggleStall(stall._id, stall.isActive)}
                        >
                          {stall.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
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
                              <AlertDialogTitle>Remove &apos;{stall.name}&apos;?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This stall will no longer be available as a scanning point.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleRemoveStall(stall._id)}
                                className="bg-destructive text-destructive-foreground"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {canEdit && addingStall && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <div className="flex items-center gap-2">
                          <Input
                            value={newStallName}
                            onChange={(e) => setNewStallName(e.target.value)}
                            placeholder="Stall name"
                            className="h-8"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddStall();
                              if (e.key === "Escape") setAddingStall(false);
                            }}
                            autoFocus
                          />
                          <Button size="sm" onClick={handleAddStall}>
                            Add
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAddingStall(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}

            {canEdit && !addingStall && (
              <div className="px-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingStall(true)}
                >
                  <Plus className="size-4" />
                  Add Stall
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
