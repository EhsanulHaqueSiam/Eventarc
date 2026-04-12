import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { validateBDPhone } from "@/lib/phone";

interface AddGuestDialogProps {
  eventId: Id<"events">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddGuestDialog({
  eventId,
  open,
  onOpenChange,
}: AddGuestDialogProps) {
  const createGuest = useMutation(api.guests.create);
  const categories = useQuery(api.categories.listByEvent, { eventId });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Set default category when categories load
  const defaultCategoryId =
    categoryId ||
    categories?.find((c) => c.isDefault)?._id ||
    categories?.[0]?._id ||
    "";

  const resetForm = () => {
    setName("");
    setPhone("");
    setCategoryId("");
    setErrors({});
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) {
      newErrors.name = "Name is required";
    } else if (name.trim().length > 200) {
      newErrors.name = "Name must be under 200 characters";
    }
    if (!phone.trim()) {
      newErrors.phone = "Phone is required";
    } else if (!validateBDPhone(phone)) {
      newErrors.phone =
        "Invalid Bangladesh phone number. Expected: 01XXXXXXXXX or +8801XXXXXXXXX";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      await createGuest({
        eventId,
        name: name.trim(),
        phone: phone.trim(),
        categoryId: (defaultCategoryId as Id<"guestCategories">),
      });
      toast.success("Guest added");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to add guest";
      if (msg.includes("phone number already exists")) {
        setErrors((prev) => ({
          ...prev,
          phone: "A guest with this phone number already exists in this event",
        }));
      } else {
        toast.error(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) resetForm();
        onOpenChange(newOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Guest</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name)
                  setErrors((prev) => ({ ...prev, name: "" }));
              }}
              placeholder="Guest name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phone</label>
            <Input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (errors.phone)
                  setErrors((prev) => ({ ...prev, phone: "" }));
              }}
              placeholder="01XXXXXXXXX"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Bangladesh format: 01XXXXXXXXX
            </p>
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone}</p>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Category</label>
            <Select
              value={defaultCategoryId}
              onValueChange={setCategoryId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories?.map((cat) => (
                  <SelectItem key={cat._id} value={cat._id}>
                    {cat.name}
                    {cat.isDefault && " (Default)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Adding..." : "Add Guest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
