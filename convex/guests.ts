import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import {
  validateGuestData,
  checkPhoneDuplicate,
} from "./model/guests";

// ============================================================
// MUTATIONS
// ============================================================

export const create = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    phone: v.string(),
    categoryId: v.id("guestCategories"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    const category = await ctx.db.get(args.categoryId);
    if (!category || category.eventId !== args.eventId)
      throw new Error("Category not found for this event");

    const { errors, normalizedPhone } = validateGuestData({
      name: args.name,
      phone: args.phone,
    });
    if (errors.length > 0)
      throw new Error(errors.map((e) => e.message).join("; "));
    if (!normalizedPhone) throw new Error("Invalid phone number");

    const isDuplicate = await checkPhoneDuplicate(
      ctx,
      args.eventId,
      normalizedPhone,
    );
    if (isDuplicate)
      throw new Error(
        "A guest with this phone number already exists in this event",
      );

    const now = Date.now();
    return await ctx.db.insert("guests", {
      eventId: args.eventId,
      name: args.name.trim(),
      phone: normalizedPhone,
      categoryId: args.categoryId,
      status: "invited",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    guestId: v.id("guests"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    categoryId: v.optional(v.id("guestCategories")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error("Guest not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName || trimmedName.length > 200)
        throw new Error("Name must be between 1 and 200 characters");
      patch.name = trimmedName;
    }

    if (args.phone !== undefined) {
      const { normalizedPhone } = validateGuestData({
        name: guest.name,
        phone: args.phone,
      });
      if (!normalizedPhone)
        throw new Error("Invalid Bangladesh phone number");
      const isDuplicate = await checkPhoneDuplicate(
        ctx,
        guest.eventId,
        normalizedPhone,
        args.guestId,
      );
      if (isDuplicate)
        throw new Error(
          "A guest with this phone number already exists in this event",
        );
      patch.phone = normalizedPhone;
    }

    if (args.categoryId !== undefined) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.eventId !== guest.eventId)
        throw new Error("Category not found for this event");
      patch.categoryId = args.categoryId;
    }

    await ctx.db.patch(args.guestId, patch);
    return args.guestId;
  },
});

export const remove = mutation({
  args: { guestId: v.id("guests") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error("Guest not found");

    await ctx.db.delete(args.guestId);
  },
});

// ============================================================
// QUERIES
// ============================================================

export const getById = query({
  args: { guestId: v.id("guests") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.guestId);
  },
});

const guestStatusValidator = v.union(
  v.literal("invited"),
  v.literal("smsSent"),
  v.literal("smsDelivered"),
  v.literal("checkedIn"),
);

export const listByEvent = query({
  args: {
    eventId: v.id("events"),
    paginationOpts: paginationOptsValidator,
    status: v.optional(guestStatusValidator),
    categoryId: v.optional(v.id("guestCategories")),
  },
  handler: async (ctx, args) => {
    // When filtering by status, use the compound index
    if (args.status) {
      const result = await ctx.db
        .query("guests")
        .withIndex("by_event_status", (q) =>
          q.eq("eventId", args.eventId).eq("status", args.status!),
        )
        .order("desc")
        .paginate(args.paginationOpts);

      // Post-filter by category if needed
      if (args.categoryId) {
        return {
          ...result,
          page: result.page.filter(
            (g) => g.categoryId === args.categoryId,
          ),
        };
      }
      return result;
    }

    // Default: all guests for event, ordered by creation time desc
    const result = await ctx.db
      .query("guests")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .order("desc")
      .paginate(args.paginationOpts);

    // Post-filter by category if needed
    if (args.categoryId) {
      return {
        ...result,
        page: result.page.filter(
          (g) => g.categoryId === args.categoryId,
        ),
      };
    }

    return result;
  },
});

export const searchByName = query({
  args: {
    eventId: v.id("events"),
    searchText: v.string(),
    status: v.optional(guestStatusValidator),
    categoryId: v.optional(v.id("guestCategories")),
  },
  handler: async (ctx, args) => {
    if (!args.searchText.trim()) return [];

    return await ctx.db
      .query("guests")
      .withSearchIndex("search_name", (q) => {
        let search = q
          .search("name", args.searchText)
          .eq("eventId", args.eventId);
        if (args.status) search = search.eq("status", args.status);
        if (args.categoryId)
          search = search.eq("categoryId", args.categoryId);
        return search;
      })
      .take(50);
  },
});

export const searchByPhone = query({
  args: {
    eventId: v.id("events"),
    searchText: v.string(),
    status: v.optional(guestStatusValidator),
    categoryId: v.optional(v.id("guestCategories")),
  },
  handler: async (ctx, args) => {
    if (!args.searchText.trim()) return [];

    return await ctx.db
      .query("guests")
      .withSearchIndex("search_phone", (q) => {
        let search = q
          .search("phone", args.searchText)
          .eq("eventId", args.eventId);
        if (args.status) search = search.eq("status", args.status);
        if (args.categoryId)
          search = search.eq("categoryId", args.categoryId);
        return search;
      })
      .take(50);
  },
});

export const countByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const guests = await ctx.db
      .query("guests")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    return guests.length;
  },
});

// ============================================================
// IMPORT PIPELINE
// ============================================================

/**
 * Pre-import duplicate check. Client sends all unique phones from the CSV,
 * server returns which ones already exist in the event.
 * Used in wizard Step 4 (Resolve Duplicates) before actual import.
 */
export const checkDuplicatePhones = query({
  args: {
    eventId: v.id("events"),
    phones: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const duplicates: Array<{
      phone: string;
      existingGuestId: string;
      existingName: string;
    }> = [];

    for (const phone of args.phones) {
      const existing = await ctx.db
        .query("guests")
        .withIndex("by_event_phone", (q) =>
          q.eq("eventId", args.eventId).eq("phone", phone),
        )
        .first();

      if (existing) {
        duplicates.push({
          phone,
          existingGuestId: existing._id,
          existingName: existing.name,
        });
      }
    }

    return duplicates;
  },
});

/**
 * Import a batch of validated, deduplicated guests.
 * Called by client in chunks of ~500 rows.
 * Returns per-batch results for progress tracking.
 */
export const importBatch = mutation({
  args: {
    eventId: v.id("events"),
    guests: v.array(
      v.object({
        name: v.string(),
        phone: v.string(),
        categoryId: v.id("guestCategories"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const event = await ctx.db.get(args.eventId);
    if (!event) throw new Error("Event not found");

    const now = Date.now();
    let inserted = 0;
    const errors: Array<{ index: number; phone: string; reason: string }> =
      [];

    for (let i = 0; i < args.guests.length; i++) {
      const guest = args.guests[i];

      // Validate phone format (defense-in-depth; client should pre-validate)
      const { errors: validationErrors, normalizedPhone } =
        validateGuestData({
          name: guest.name,
          phone: guest.phone,
        });

      if (validationErrors.length > 0 || !normalizedPhone) {
        errors.push({
          index: i,
          phone: guest.phone,
          reason:
            validationErrors.map((e) => e.message).join("; ") ||
            "Invalid phone",
        });
        continue;
      }

      // Check for duplicate in DB
      const isDuplicate = await checkPhoneDuplicate(
        ctx,
        args.eventId,
        normalizedPhone,
      );
      if (isDuplicate) {
        errors.push({
          index: i,
          phone: normalizedPhone,
          reason: "Phone number already exists in this event",
        });
        continue;
      }

      // Verify category belongs to this event
      const category = await ctx.db.get(guest.categoryId);
      if (!category || category.eventId !== args.eventId) {
        errors.push({
          index: i,
          phone: normalizedPhone,
          reason: "Invalid category for this event",
        });
        continue;
      }

      await ctx.db.insert("guests", {
        eventId: args.eventId,
        name: guest.name.trim(),
        phone: normalizedPhone,
        categoryId: guest.categoryId,
        status: "invited",
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }

    return { inserted, errors, total: args.guests.length };
  },
});

/**
 * Replace an existing guest's data during import duplicate resolution.
 * Called when admin chooses "Replace" for a duplicate.
 */
export const replaceGuest = mutation({
  args: {
    guestId: v.id("guests"),
    name: v.string(),
    phone: v.string(),
    categoryId: v.id("guestCategories"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error("Guest not found");

    const { errors, normalizedPhone } = validateGuestData({
      name: args.name,
      phone: args.phone,
    });
    if (errors.length > 0 || !normalizedPhone)
      throw new Error(
        errors.map((e) => e.message).join("; ") || "Invalid data",
      );

    await ctx.db.patch(args.guestId, {
      name: args.name.trim(),
      phone: normalizedPhone,
      categoryId: args.categoryId,
      updatedAt: Date.now(),
    });
    return args.guestId;
  },
});
