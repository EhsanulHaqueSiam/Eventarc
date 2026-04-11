import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ensureVendorTypes,
  validateVendorCategoryName,
} from "./model/vendors";

export const createCategory = mutation({
  args: {
    eventId: v.id("events"),
    type: v.union(v.literal("entry"), v.literal("food")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    const trimmedName = args.name.trim();
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error(
        "Vendor category name must be between 1 and 100 characters",
      );
    }

    // Ensure vendor types exist for this event
    const { entryTypeId, foodTypeId } = await ensureVendorTypes(
      ctx,
      args.eventId,
    );
    const vendorTypeId =
      args.type === "entry" ? entryTypeId : foodTypeId;

    // Validate name uniqueness per event
    await validateVendorCategoryName(ctx, args.eventId, trimmedName);

    return await ctx.db.insert("vendorCategories", {
      eventId: args.eventId,
      vendorTypeId,
      name: trimmedName,
    });
  },
});

export const listByEvent = query({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    const vendorTypes = await ctx.db
      .query("vendorTypes")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const categories = await ctx.db
      .query("vendorCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const stalls = await ctx.db
      .query("stalls")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const entryType = vendorTypes.find((t) => t.name === "entry");
    const foodType = vendorTypes.find((t) => t.name === "food");

    const buildCategories = (typeId: string | undefined) => {
      if (!typeId) return [];
      return categories
        .filter((c) => c.vendorTypeId === typeId)
        .map((c) => ({
          ...c,
          stalls: stalls.filter((s) => s.categoryId === c._id),
        }));
    };

    return {
      entry: {
        typeId: entryType?._id ?? null,
        categories: buildCategories(entryType?._id),
      },
      food: {
        typeId: foodType?._id ?? null,
        categories: buildCategories(foodType?._id),
      },
    };
  },
});

export const removeCategory = mutation({
  args: {
    categoryId: v.id("vendorCategories"),
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

    // Cascade delete all stalls under this category
    const stalls = await ctx.db
      .query("stalls")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .collect();
    for (const stall of stalls) {
      await ctx.db.delete(stall._id);
    }

    await ctx.db.delete(args.categoryId);
  },
});

export const updateCategory = mutation({
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
      throw new Error(
        "Vendor category name must be between 1 and 100 characters",
      );
    }

    await validateVendorCategoryName(
      ctx,
      category.eventId,
      trimmedName,
      args.categoryId,
    );

    await ctx.db.patch(args.categoryId, { name: trimmedName });
    return args.categoryId;
  },
});
