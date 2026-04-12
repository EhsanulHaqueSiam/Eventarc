import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cardTemplates")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});

export const get = query({
  args: {
    id: v.id("cardTemplates"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    backgroundImageUrl: v.string(),
    backgroundImageKey: v.string(),
    canvasWidth: v.number(),
    canvasHeight: v.number(),
    qrOverlay: v.object({
      left: v.number(),
      top: v.number(),
      scaleX: v.number(),
      scaleY: v.number(),
      angle: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    // Validate event exists
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    if (!args.name.trim()) {
      throw new Error("Template name is required");
    }

    const now = Date.now();
    return await ctx.db.insert("cardTemplates", {
      eventId: args.eventId,
      name: args.name.trim(),
      backgroundImageUrl: args.backgroundImageUrl,
      backgroundImageKey: args.backgroundImageKey,
      canvasWidth: args.canvasWidth,
      canvasHeight: args.canvasHeight,
      qrOverlay: args.qrOverlay,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("cardTemplates"),
    name: v.optional(v.string()),
    backgroundImageUrl: v.optional(v.string()),
    backgroundImageKey: v.optional(v.string()),
    canvasWidth: v.optional(v.number()),
    canvasHeight: v.optional(v.number()),
    qrOverlay: v.optional(
      v.object({
        left: v.number(),
        top: v.number(),
        scaleX: v.number(),
        scaleY: v.number(),
        angle: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Card template not found");
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      if (!args.name.trim()) {
        throw new Error("Template name is required");
      }
      updates.name = args.name.trim();
    }
    if (args.backgroundImageUrl !== undefined) {
      updates.backgroundImageUrl = args.backgroundImageUrl;
    }
    if (args.backgroundImageKey !== undefined) {
      updates.backgroundImageKey = args.backgroundImageKey;
    }
    if (args.canvasWidth !== undefined) {
      updates.canvasWidth = args.canvasWidth;
    }
    if (args.canvasHeight !== undefined) {
      updates.canvasHeight = args.canvasHeight;
    }
    if (args.qrOverlay !== undefined) {
      updates.qrOverlay = args.qrOverlay;
    }

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

export const remove = mutation({
  args: {
    id: v.id("cardTemplates"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("Card template not found");
    }

    await ctx.db.delete(args.id);
    return args.id;
  },
});
