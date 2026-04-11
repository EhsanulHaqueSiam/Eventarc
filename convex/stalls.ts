import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    categoryId: v.id("vendorCategories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const category = await ctx.db.get(args.categoryId);
    if (!category) {
      throw new Error("Vendor category not found");
    }

    const trimmedName = args.name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error("Stall name must be between 1 and 100 characters");
    }

    // Validate stall name uniqueness per event
    const existing = await ctx.db
      .query("stalls")
      .withIndex("by_event_name", (q) =>
        q.eq("eventId", category.eventId).eq("name", trimmedName),
      )
      .first();
    if (existing) {
      throw new Error(
        `Stall "${trimmedName}" already exists for this event`,
      );
    }

    return await ctx.db.insert("stalls", {
      eventId: category.eventId,
      categoryId: args.categoryId,
      name: trimmedName,
      isActive: true,
    });
  },
});

export const listByCategory = query({
  args: {
    categoryId: v.id("vendorCategories"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("stalls")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
  },
});

export const update = mutation({
  args: {
    stallId: v.id("stalls"),
    name: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const stall = await ctx.db.get(args.stallId);
    if (!stall) {
      throw new Error("Stall not found");
    }

    const patch: Record<string, unknown> = {};

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName || trimmedName.length > 100) {
        throw new Error("Stall name must be between 1 and 100 characters");
      }

      // Validate uniqueness per event (excluding current)
      const existing = await ctx.db
        .query("stalls")
        .withIndex("by_event_name", (q) =>
          q.eq("eventId", stall.eventId).eq("name", trimmedName),
        )
        .first();
      if (existing && existing._id !== args.stallId) {
        throw new Error(
          `Stall "${trimmedName}" already exists for this event`,
        );
      }

      patch.name = trimmedName;
    }

    if (args.isActive !== undefined) {
      patch.isActive = args.isActive;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.stallId, patch);
    }

    return args.stallId;
  },
});

export const remove = mutation({
  args: {
    stallId: v.id("stalls"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const stall = await ctx.db.get(args.stallId);
    if (!stall) {
      throw new Error("Stall not found");
    }

    await ctx.db.delete(args.stallId);
  },
});
