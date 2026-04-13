import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureEventEditAccess, ensureEventReadAccess } from "./authz";

export const getByEvent = query({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    await ensureEventReadAccess(ctx, args.eventId);
    return await ctx.db
      .query("smsTemplates")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();
  },
});

export const upsertForEvent = mutation({
  args: {
    eventId: v.id("events"),
    messageTemplate: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ensureEventEditAccess(ctx, args.eventId);
    const trimmedTemplate = args.messageTemplate.trim();
    if (!trimmedTemplate) {
      throw new Error("Message template is required");
    }

    const existing = await ctx.db
      .query("smsTemplates")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        messageTemplate: trimmedTemplate,
        updatedByTokenIdentifier: identity.tokenIdentifier,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("smsTemplates", {
      eventId: args.eventId,
      messageTemplate: trimmedTemplate,
      updatedByTokenIdentifier: identity.tokenIdentifier,
      createdAt: now,
      updatedAt: now,
    });
  },
});
