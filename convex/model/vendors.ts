import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function ensureVendorTypes(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<{ entryTypeId: Id<"vendorTypes">; foodTypeId: Id<"vendorTypes"> }> {
  const existing = await ctx.db
    .query("vendorTypes")
    .withIndex("by_event", (q) => q.eq("eventId", eventId))
    .collect();

  let entryType = existing.find((t) => t.name === "entry");
  let foodType = existing.find((t) => t.name === "food");

  let entryTypeId: Id<"vendorTypes">;
  let foodTypeId: Id<"vendorTypes">;

  if (entryType) {
    entryTypeId = entryType._id;
  } else {
    entryTypeId = await ctx.db.insert("vendorTypes", {
      eventId,
      name: "entry",
    });
  }

  if (foodType) {
    foodTypeId = foodType._id;
  } else {
    foodTypeId = await ctx.db.insert("vendorTypes", {
      eventId,
      name: "food",
    });
  }

  return { entryTypeId, foodTypeId };
}

export async function validateVendorCategoryName(
  ctx: MutationCtx,
  eventId: Id<"events">,
  name: string,
  excludeId?: Id<"vendorCategories">,
): Promise<void> {
  const existing = await ctx.db
    .query("vendorCategories")
    .withIndex("by_event_name", (q) =>
      q.eq("eventId", eventId).eq("name", name),
    )
    .first();
  if (existing && existing._id !== excludeId) {
    throw new Error(
      `Vendor category "${name}" already exists for this event`,
    );
  }
}
