import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface FoodRulesMatrixProps {
  eventId: Id<"events">;
  foodCategories: Array<{ _id: Id<"vendorCategories">; name: string }>;
}

export function FoodRulesMatrix({
  eventId,
  foodCategories,
}: FoodRulesMatrixProps) {
  const guestCategoriesQuery = useQuery(api.categories.listByEvent, { eventId });
  const foodRules = useQuery(api.foodRules.listByEvent, { eventId });
  const setBulkRules = useMutation(api.foodRules.setBulkRules);
  const guestCategories = guestCategoriesQuery ?? [];

  const [ruleDraft, setRuleDraft] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const ruleDefaults = useMemo(() => {
    const defaults: Record<string, string> = {};
    if (!foodRules) return defaults;
    for (const rule of foodRules) {
      defaults[`${rule.guestCategoryId}:${rule.foodCategoryId}`] = String(
        rule.limit,
      );
    }
    return defaults;
  }, [foodRules]);

  useEffect(() => {
    setRuleDraft(ruleDefaults);
  }, [ruleDefaults]);

  const handleChange = (
    guestCategoryId: Id<"guestCategories">,
    foodCategoryId: Id<"vendorCategories">,
    value: string,
  ) => {
    if (!/^-?\d*$/.test(value)) return;
    const key = `${guestCategoryId}:${foodCategoryId}`;
    setRuleDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (guestCategories.length === 0) return;

    const rules: Array<{
      guestCategoryId: Id<"guestCategories">;
      foodCategoryId: Id<"vendorCategories">;
      limit: number;
    }> = [];

    for (const guestCategory of guestCategories) {
      for (const foodCategory of foodCategories) {
        const key = `${guestCategory._id}:${foodCategory._id}`;
        const raw = ruleDraft[key]?.trim() ?? "";
        if (raw === "") continue;
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < -1) {
          toast.error(
            `Invalid limit for ${guestCategory.name} → ${foodCategory.name}. Use -1, 0, or a positive integer.`,
          );
          return;
        }
        rules.push({
          guestCategoryId: guestCategory._id,
          foodCategoryId: foodCategory._id,
          limit: parsed,
        });
      }
    }

    setIsSaving(true);
    try {
      await setBulkRules({ eventId, rules });
      toast.success("Food service limits saved");
    } catch {
      toast.error("Failed to save food limits");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Food Limits (Per Category)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Leave blank for no limit. Use -1 for unlimited, 0 to block, or 1+ for
          max servings per person.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {foodCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add at least one food category to configure limits.
          </p>
        ) : guestCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add guest categories to configure per-category food limits.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Food Category</TableHead>
                  {guestCategories.map((gc) => (
                    <TableHead key={gc._id}>{gc.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {foodCategories.map((fc) => (
                  <TableRow key={fc._id}>
                    <TableCell className="font-medium">{fc.name}</TableCell>
                    {guestCategories.map((gc) => {
                      const key = `${gc._id}:${fc._id}`;
                      return (
                        <TableCell key={key}>
                          <Input
                            value={ruleDraft[key] ?? ""}
                            onChange={(e) =>
                              handleChange(gc._id, fc._id, e.target.value)
                            }
                            placeholder="No rule"
                            className="h-8 w-24"
                            inputMode="numeric"
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving || foodCategories.length === 0}
          >
            {isSaving ? "Saving..." : "Save Food Limits"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
