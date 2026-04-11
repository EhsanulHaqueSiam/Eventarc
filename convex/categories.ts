import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { validateCategoryName } from "./model/categories";

export const create = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    // Validate event exists
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    // Validate name
    const trimmedName = args.name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error("Category name must be between 1 and 100 characters");
    }

    // Check uniqueness
    await validateCategoryName(ctx, args.eventId, trimmedName);

    return await ctx.db.insert("guestCategories", {
      eventId: args.eventId,
      name: trimmedName,
      isDefault: false,
    });
  },
});

export const listByEvent = query({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    const categories = await ctx.db
      .query("guestCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    // Sort with default first, then alphabetically
    return categories.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

export const update = mutation({
  args: {
    categoryId: v.id("guestCategories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const category = await ctx.db.get(args.categoryId);
    if (!category) {
      throw new Error("Category not found");
    }

    const trimmedName = args.name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error("Category name must be between 1 and 100 characters");
    }

    // Check uniqueness within event (excluding current category)
    await validateCategoryName(
      ctx,
      category.eventId,
      trimmedName,
      args.categoryId,
    );

    await ctx.db.patch(args.categoryId, { name: trimmedName });
    return args.categoryId;
  },
});

export const remove = mutation({
  args: {
    categoryId: v.id("guestCategories"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const category = await ctx.db.get(args.categoryId);
    if (!category) {
      throw new Error("Category not found");
    }

    if (category.isDefault === true) {
      throw new Error("Cannot delete the default category");
    }

    await ctx.db.delete(args.categoryId);
  },
});
