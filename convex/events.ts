import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateTransition, isConfigLocked } from "./model/events";
import { createDefaultCategory } from "./model/categories";
import {
  ensureAdminAccess,
  ensureEventEditAccess,
  ensureEventReadAccess,
  isAdminUser,
} from "./authz";

const eventConfigValidator = v.object({
  qrStrategy: v.union(v.literal("unified"), v.literal("separate")),
  foodQrMode: v.union(v.literal("guestLinked"), v.literal("anonymous")),
  foodQrTiming: v.union(v.literal("preSent"), v.literal("postEntry")),
});

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("live"),
  v.literal("completed"),
  v.literal("archived"),
);

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    venue: v.optional(v.string()),
    eventDate: v.number(),
    endDate: v.optional(v.number()),
    config: eventConfigValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ensureAdminAccess(ctx);

    // Validate name
    if (!args.name.trim() || args.name.length > 200) {
      throw new Error("Event name must be between 1 and 200 characters");
    }

    // Validate eventDate is in the future
    if (args.eventDate <= Date.now()) {
      throw new Error("Event date must be in the future");
    }

    // Validate endDate if provided
    if (args.endDate !== undefined && args.endDate < args.eventDate) {
      throw new Error("End date must be on or after the event date");
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("events", {
      name: args.name.trim(),
      description: args.description,
      venue: args.venue,
      eventDate: args.eventDate,
      endDate: args.endDate,
      status: "draft",
      config: args.config,
      guestCount: 0,
      createdBy: identity.tokenIdentifier,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create default "General" category (D-11)
    await createDefaultCategory(ctx, eventId);

    return eventId;
  },
});

export const getById = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await ensureEventReadAccess(ctx, args.eventId);
    return await ctx.db.get(args.eventId);
  },
});

export const list = query({
  args: {
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    // Scanner setup needs public access to live events only.
    if (!identity && args.status !== "live") {
      throw new Error("Authentication required");
    }

    if (!identity) {
      return await ctx.db
        .query("events")
        .withIndex("by_status", (q) => q.eq("status", "live"))
        .order("desc")
        .collect();
    }

    const admin = await isAdminUser(ctx, identity.tokenIdentifier);
    const events = args.status
      ? await ctx.db
          .query("events")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .collect()
      : await ctx.db.query("events").order("desc").collect();

    if (admin) {
      return events;
    }

    const permissions = await ctx.db
      .query("eventPermissions")
      .withIndex("by_userTokenIdentifier", (q) =>
        q.eq("userTokenIdentifier", identity.tokenIdentifier),
      )
      .collect();
    const allowedEventIds = new Set(permissions.map((permission) => permission.eventId));
    return events.filter((event) => allowedEventIds.has(event._id));
  },
});

export const update = mutation({
  args: {
    eventId: v.id("events"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    venue: v.optional(v.string()),
    eventDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureEventEditAccess(ctx, args.eventId);

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    // Validate name if provided
    if (args.name !== undefined) {
      if (!args.name.trim() || args.name.length > 200) {
        throw new Error("Event name must be between 1 and 200 characters");
      }
    }

    // Validate dates if provided
    if (args.eventDate !== undefined && args.endDate !== undefined) {
      if (args.endDate < args.eventDate) {
        throw new Error("End date must be on or after the event date");
      }
    } else if (args.endDate !== undefined && args.endDate < event.eventDate) {
      throw new Error("End date must be on or after the event date");
    } else if (
      args.eventDate !== undefined &&
      event.endDate !== undefined &&
      event.endDate < args.eventDate
    ) {
      throw new Error("End date must be on or after the event date");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.description !== undefined) patch.description = args.description;
    if (args.venue !== undefined) patch.venue = args.venue;
    if (args.eventDate !== undefined) patch.eventDate = args.eventDate;
    if (args.endDate !== undefined) patch.endDate = args.endDate;

    await ctx.db.patch(args.eventId, patch);
    return args.eventId;
  },
});

export const updateConfig = mutation({
  args: {
    eventId: v.id("events"),
    config: eventConfigValidator,
  },
  handler: async (ctx, args) => {
    await ensureEventEditAccess(ctx, args.eventId);

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    if (isConfigLocked(event.status)) {
      throw new Error("Cannot modify configuration after event goes live");
    }

    // If QR codes have been generated and config changes, mark for regeneration
    if (event.qrGenerationStatus === "complete") {
      await ctx.db.patch(args.eventId, {
        qrGenerationStatus: undefined,
        qrJobId: undefined,
        config: args.config,
        updatedAt: Date.now(),
      });
      return args.eventId;
    }

    await ctx.db.patch(args.eventId, {
      config: args.config,
      updatedAt: Date.now(),
    });

    return args.eventId;
  },
});

export const updateStatus = mutation({
  args: {
    eventId: v.id("events"),
    newStatus: statusValidator,
  },
  handler: async (ctx, args) => {
    await ensureEventEditAccess(ctx, args.eventId);

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    validateTransition(event.status, args.newStatus);

    await ctx.db.patch(args.eventId, {
      status: args.newStatus,
      updatedAt: Date.now(),
    });

    // D-08: Schedule auto go-live when transitioning draft -> active
    if (event.status === "draft" && args.newStatus === "active") {
      await ctx.scheduler.runAt(
        event.eventDate,
        internal.events.autoGoLive,
        { eventId: args.eventId },
      );
    }

    // D-09: When transitioning to "live", trigger full Redis data sync
    if (args.newStatus === "live") {
      await ctx.scheduler.runAfter(0, internal.sync.pushEventToGo, {
        eventId: args.eventId,
      });
      await ctx.scheduler.runAfter(0, internal.sync.syncFoodRules, {
        eventId: args.eventId,
      });
    }

    return args.eventId;
  },
});

export const autoGoLive = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      console.log(
        `[AUTO GO-LIVE] Event ${args.eventId} not found, skipping`,
      );
      return;
    }

    // Idempotent: only transition if event is still in "active" status
    if (event.status === "active") {
      await ctx.db.patch(args.eventId, {
        status: "live",
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.sync.pushEventToGo, {
        eventId: args.eventId,
      });
      await ctx.scheduler.runAfter(0, internal.sync.syncFoodRules, {
        eventId: args.eventId,
      });
      console.log(
        `[AUTO GO-LIVE] Event ${args.eventId} transitioned to live and scheduled sync jobs`,
      );
    } else {
      console.log(
        `[AUTO GO-LIVE] Event ${args.eventId} is in "${event.status}" status, not transitioning`,
      );
    }
  },
});

export const remove = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await ensureAdminAccess(ctx);

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    if (event.status !== "draft") {
      throw new Error(
        "Can only delete draft events. Archive completed events instead.",
      );
    }

    // Cascade delete all child records.
    // Order: leaf tables first (foodScans, smsDeliveries, foodRules,
    // deviceSessions, cardTemplates), then guests (large, chunked),
    // then config tables, then the event itself.

    // 1. foodScans (references guests and stalls)
    const foodScans = await ctx.db
      .query("foodScans")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const fs of foodScans) {
      await ctx.db.delete(fs._id);
    }

    // 2. smsDeliveries (references guests)
    const smsDeliveries = await ctx.db
      .query("smsDeliveries")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const sms of smsDeliveries) {
      await ctx.db.delete(sms._id);
    }

    // 3. foodRules (references guestCategories and vendorCategories)
    const foodRules = await ctx.db
      .query("foodRules")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const fr of foodRules) {
      await ctx.db.delete(fr._id);
    }

    // 4. deviceSessions (references stalls and vendorTypes)
    const deviceSessions = await ctx.db
      .query("deviceSessions")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const ds of deviceSessions) {
      await ctx.db.delete(ds._id);
    }

    // 5. cardTemplates (references events only)
    const cardTemplates = await ctx.db
      .query("cardTemplates")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const ct of cardTemplates) {
      await ctx.db.delete(ct._id);
    }

    // 6. guests (large table -- chunked deletion with safety cap)
    let totalGuestsDeleted = 0;
    const MAX_GUEST_DELETES = 8000;
    let hasMore = true;
    while (hasMore) {
      const guestBatch = await ctx.db
        .query("guests")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .take(500);

      if (guestBatch.length === 0) {
        hasMore = false;
        break;
      }

      for (const guest of guestBatch) {
        await ctx.db.delete(guest._id);
        totalGuestsDeleted++;
      }

      if (totalGuestsDeleted >= MAX_GUEST_DELETES) {
        throw new Error(
          `Event has too many guests (${totalGuestsDeleted}+) for single-mutation deletion. Contact admin.`,
        );
      }
    }

    // 7. guestCategories
    const categories = await ctx.db
      .query("guestCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const category of categories) {
      await ctx.db.delete(category._id);
    }

    // 8. stalls
    const stalls = await ctx.db
      .query("stalls")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const stall of stalls) {
      await ctx.db.delete(stall._id);
    }

    // 9. vendorCategories
    const vendorCategories = await ctx.db
      .query("vendorCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const vc of vendorCategories) {
      await ctx.db.delete(vc._id);
    }

    // 10. vendorTypes
    const vendorTypes = await ctx.db
      .query("vendorTypes")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const vt of vendorTypes) {
      await ctx.db.delete(vt._id);
    }

    // 11. Delete the event itself
    await ctx.db.delete(args.eventId);
  },
});
