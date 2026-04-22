import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

const statusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("failed"),
);

export const listByEvent = query({
  args: {
    eventId: v.id("events"),
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("smsDeliveries")
        .withIndex("by_event_status", (q) =>
          q.eq("eventId", args.eventId).eq("status", args.status!),
        )
        .collect();
    }
    return await ctx.db
      .query("smsDeliveries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});

export const countByStatus = query({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    const deliveries = await ctx.db
      .query("smsDeliveries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const counts = {
      queued: 0,
      sending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      total: deliveries.length,
    };

    for (const d of deliveries) {
      counts[d.status]++;
    }

    return counts;
  },
});

export const create = mutation({
  args: {
    eventId: v.id("events"),
    guestId: v.id("guests"),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("smsDeliveries", {
      eventId: args.eventId,
      guestId: args.guestId,
      phone: args.phone,
      status: "queued",
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("smsDeliveries"),
    status: statusValidator,
    providerRequestId: v.optional(v.string()),
    lastAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("SMS delivery record not found");
    }

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.providerRequestId !== undefined) {
      updates.providerRequestId = args.providerRequestId;
    }
    if (args.lastAttemptAt !== undefined) {
      updates.lastAttemptAt = args.lastAttemptAt;
    }

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

export const markDelivered = mutation({
  args: {
    id: v.id("smsDeliveries"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("SMS delivery record not found");
    }

    await ctx.db.patch(args.id, {
      status: "delivered",
      deliveredAt: Date.now(),
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

export const markFailed = mutation({
  args: {
    id: v.id("smsDeliveries"),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error("SMS delivery record not found");
    }

    await ctx.db.patch(args.id, {
      status: "failed",
      failureReason: args.failureReason,
      retryCount: existing.retryCount + 1,
      updatedAt: Date.now(),
    });
    return args.id;
  },
});

// internalSyncStatus is called from the Go SMS worker (via the signed
// /internal/sync/sms-status httpAction) whenever an SMS transitions to a
// terminal state (sent, delivered, failed). Without this, Convex would
// remain stuck on "queued" and the admin dashboard would show stale data
// after Redis is flushed.
//
// Lookup is by (eventId, guestId) because Go does not know the Convex _id.
// If multiple rows exist for the same guest (retry scenarios), the most
// recent one is updated.
export const internalSyncStatus = internalMutation({
  args: {
    eventId: v.id("events"),
    guestId: v.id("guests"),
    phone: v.string(),
    status: statusValidator,
    providerRequestId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    lastAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deliveries = await ctx.db
      .query("smsDeliveries")
      .withIndex("by_guest", (q) => q.eq("guestId", args.guestId))
      .collect();

    // Filter to this event and sort by createdAt desc to grab the latest.
    const row = deliveries
      .filter((d) => d.eventId === args.eventId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!row) {
      // No row exists yet — create one so we don't drop the status update.
      const now = Date.now();
      await ctx.db.insert("smsDeliveries", {
        eventId: args.eventId,
        guestId: args.guestId,
        phone: args.phone,
        status: args.status,
        providerRequestId: args.providerRequestId,
        failureReason: args.failureReason,
        lastAttemptAt: args.lastAttemptAt,
        deliveredAt: args.status === "delivered" ? now : undefined,
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.providerRequestId !== undefined) {
      patch.providerRequestId = args.providerRequestId;
    }
    if (args.failureReason !== undefined) {
      patch.failureReason = args.failureReason;
    }
    if (args.lastAttemptAt !== undefined) {
      patch.lastAttemptAt = args.lastAttemptAt;
    }
    if (args.status === "delivered") {
      patch.deliveredAt = Date.now();
    }
    if (args.status === "failed") {
      patch.retryCount = row.retryCount + 1;
    }
    await ctx.db.patch(row._id, patch);
  },
});
