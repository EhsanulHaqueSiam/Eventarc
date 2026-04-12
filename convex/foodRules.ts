import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Food rules CRUD for the admin-configured matrix of
 * guest categories x food categories -> limits.
 *
 * Each rule defines how many servings of a food category
 * a guest in a specific guest category is allowed.
 * limit = -1 means unlimited, 0 means not allowed, >0 is the cap.
 */

export const listByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("foodRules")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});

export const setRule = mutation({
  args: {
    eventId: v.id("events"),
    guestCategoryId: v.id("guestCategories"),
    foodCategoryId: v.id("vendorCategories"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    // Validate limit: must be -1 (unlimited) or >= 0
    if (args.limit < -1 || !Number.isInteger(args.limit)) {
      throw new Error(
        "Limit must be -1 (unlimited) or a non-negative integer",
      );
    }

    // Validate guestCategory belongs to this event
    const guestCat = await ctx.db.get(args.guestCategoryId);
    if (!guestCat || guestCat.eventId !== args.eventId) {
      throw new Error("Guest category not found for this event");
    }

    // Validate foodCategory belongs to this event and is under a "food" vendorType
    const foodCat = await ctx.db.get(args.foodCategoryId);
    if (!foodCat || foodCat.eventId !== args.eventId) {
      throw new Error("Food category not found for this event");
    }
    const vendorType = await ctx.db.get(foodCat.vendorTypeId);
    if (!vendorType || vendorType.name !== "food") {
      throw new Error("Category is not a food category");
    }

    // Check for existing rule (upsert)
    const existing = await ctx.db
      .query("foodRules")
      .withIndex("by_event_guest_food", (q) =>
        q
          .eq("eventId", args.eventId)
          .eq("guestCategoryId", args.guestCategoryId)
          .eq("foodCategoryId", args.foodCategoryId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { limit: args.limit });
      return existing._id;
    } else {
      return await ctx.db.insert("foodRules", {
        eventId: args.eventId,
        guestCategoryId: args.guestCategoryId,
        foodCategoryId: args.foodCategoryId,
        limit: args.limit,
      });
    }
  },
});

export const setBulkRules = mutation({
  args: {
    eventId: v.id("events"),
    rules: v.array(
      v.object({
        guestCategoryId: v.id("guestCategories"),
        foodCategoryId: v.id("vendorCategories"),
        limit: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Validate all limits
    for (const rule of args.rules) {
      if (rule.limit < -1 || !Number.isInteger(rule.limit)) {
        throw new Error(
          "All limits must be -1 (unlimited) or non-negative integers",
        );
      }
    }

    // Delete existing rules for this event
    const existing = await ctx.db
      .query("foodRules")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const rule of existing) {
      await ctx.db.delete(rule._id);
    }

    // Insert new rules
    for (const rule of args.rules) {
      await ctx.db.insert("foodRules", {
        eventId: args.eventId,
        guestCategoryId: rule.guestCategoryId,
        foodCategoryId: rule.foodCategoryId,
        limit: rule.limit,
      });
    }
  },
});

export const deleteRule = mutation({
  args: { ruleId: v.id("foodRules") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.ruleId);
  },
});
