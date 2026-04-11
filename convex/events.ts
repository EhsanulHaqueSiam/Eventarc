import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateTransition, isConfigLocked } from "./model/events";
import { createDefaultCategory } from "./model/categories";

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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

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
      createdBy: identity.subject,
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
    return await ctx.db.get(args.eventId);
  },
});

export const list = query({
  args: {
    status: v.optional(statusValidator),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("events")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .collect();
    }
    return await ctx.db.query("events").order("desc").collect();
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    if (isConfigLocked(event.status)) {
      throw new Error("Cannot modify configuration after event goes live");
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

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

    // TODO (Plan 03): When transitioning to "live":
    // ctx.scheduler.runAfter(0, internal.sync.pushEventToGo, { eventId: args.eventId })

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
      console.log(
        `[AUTO GO-LIVE] Event ${args.eventId} transitioned to live at scheduled time`,
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    if (event.status !== "draft") {
      throw new Error(
        "Can only delete draft events. Archive completed events instead.",
      );
    }

    // Cascade delete guestCategories
    const categories = await ctx.db
      .query("guestCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    for (const category of categories) {
      await ctx.db.delete(category._id);
    }

    // Delete the event
    await ctx.db.delete(args.eventId);
  },
});
