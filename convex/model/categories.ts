import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function createDefaultCategory(
  ctx: MutationCtx,
  eventId: Id<"events">,
): Promise<Id<"guestCategories">> {
  return await ctx.db.insert("guestCategories", {
    eventId,
    name: "General",
    isDefault: true,
  });
}

export async function validateCategoryName(
  ctx: MutationCtx,
  eventId: Id<"events">,
  name: string,
  excludeId?: Id<"guestCategories">,
): Promise<void> {
  const existing = await ctx.db
    .query("guestCategories")
    .withIndex("by_event_name", (q) =>
      q.eq("eventId", eventId).eq("name", name),
    )
    .first();
  if (existing && existing._id !== excludeId) {
    throw new Error(`Category "${name}" already exists for this event`);
  }
}
