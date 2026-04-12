import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    eventId: v.id("events"),
    stallId: v.id("stalls"),
    vendorCategoryId: v.id("vendorCategories"),
    vendorTypeId: v.id("vendorTypes"),
    stallName: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("deviceSessions", {
      eventId: args.eventId,
      stallId: args.stallId,
      vendorCategoryId: args.vendorCategoryId,
      vendorTypeId: args.vendorTypeId,
      stallName: args.stallName,
      token: args.token,
      status: "active",
      lastHeartbeat: Date.now(),
      scanCount: 0,
      createdAt: Date.now(),
    });
  },
});

export const listByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deviceSessions")
      .withIndex("by_event_status", (q) =>
        q.eq("eventId", args.eventId).eq("status", "active"),
      )
      .collect();
  },
});

export const listAll = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deviceSessions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});

export const revoke = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("deviceSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (session) {
      await ctx.db.patch(session._id, { status: "revoked" });
    }
  },
});

export const heartbeat = mutation({
  args: { token: v.string(), scanCount: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("deviceSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (session) {
      await ctx.db.patch(session._id, {
        lastHeartbeat: Date.now(),
        scanCount: args.scanCount,
      });
    }
  },
});
