import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  validateGuestData,
  checkPhoneDuplicate,
} from "./model/guests";
import {
  ensureEventEditAccess,
  ensureEventReadAccess,
} from "./authz";

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
    await ensureEventEditAccess(ctx, args.eventId);

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
    const guestId = await ctx.db.insert("guests", {
      eventId: args.eventId,
      name: args.name.trim(),
      phone: normalizedPhone,
      categoryId: args.categoryId,
      status: "invited",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.eventId, {
      guestCount: (event.guestCount ?? 0) + 1,
      updatedAt: now,
    });

    return guestId;
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
    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error("Guest not found");
    await ensureEventEditAccess(ctx, guest.eventId);

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
    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error("Guest not found");
    await ensureEventEditAccess(ctx, guest.eventId);

    await ctx.db.delete(args.guestId);
    const event = await ctx.db.get(guest.eventId);
    if (event) {
      await ctx.db.patch(guest.eventId, {
        guestCount: Math.max((event.guestCount ?? 0) - 1, 0),
        updatedAt: Date.now(),
      });
    }
  },
});

export const internalSetCardImage = internalMutation({
  args: {
    eventId: v.id("events"),
    guestId: v.id("guests"),
    cardImageUrl: v.string(),
    cardImageKey: v.string(),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db.get(args.guestId);
    if (!guest) {
      throw new Error("Guest not found");
    }
    if (guest.eventId !== args.eventId) {
      throw new Error("Guest does not belong to this event");
    }

    await ctx.db.patch(args.guestId, {
      cardImageUrl: args.cardImageUrl,
      cardImageKey: args.cardImageKey,
      updatedAt: Date.now(),
    });
    return args.guestId;
  },
});

export const internalMarkCheckedIn = internalMutation({
  args: {
    eventId: v.id("events"),
    guestId: v.id("guests"),
    checkedInAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const guest = await ctx.db.get(args.guestId);
    if (!guest) {
      throw new Error("Guest not found");
    }
    if (guest.eventId !== args.eventId) {
      throw new Error("Guest does not belong to this event");
    }
    if (guest.status === "checkedIn") {
      return args.guestId;
    }

    await ctx.db.patch(args.guestId, {
      status: "checkedIn",
      updatedAt: args.checkedInAt ?? Date.now(),
    });
    return args.guestId;
  },
});

export const internalRecordFoodConsumption = internalMutation({
  args: {
    eventId: v.id("events"),
    idempotencyKey: v.string(),
    guestId: v.string(),
    foodCategoryId: v.id("vendorCategories"),
    stallId: v.id("stalls"),
    scannedAt: v.number(),
    deviceId: v.string(),
    guestCategory: v.optional(v.string()),
    isAnonymous: v.boolean(),
    consumptionCount: v.number(),
    status: v.union(
      v.literal("valid"),
      v.literal("limit_reached"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("foodScans")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      return existing._id;
    }

    const event = await ctx.db.get(args.eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    const foodCategory = await ctx.db.get(args.foodCategoryId);
    if (!foodCategory || foodCategory.eventId !== args.eventId) {
      throw new Error("Food category not found for this event");
    }

    const stall = await ctx.db.get(args.stallId);
    if (!stall || stall.eventId !== args.eventId) {
      throw new Error("Stall not found for this event");
    }

    if (!args.isAnonymous) {
      const guest = await ctx.db.get(args.guestId as Id<"guests">);
      if (!guest || guest.eventId !== args.eventId) {
        throw new Error("Guest not found for this event");
      }
    }

    return await ctx.db.insert("foodScans", {
      idempotencyKey: args.idempotencyKey,
      eventId: args.eventId,
      guestId: args.guestId,
      foodCategoryId: args.foodCategoryId,
      stallId: args.stallId,
      scannedAt: args.scannedAt,
      deviceId: args.deviceId,
      guestCategory: args.guestCategory,
      isAnonymous: args.isAnonymous,
      consumptionCount: args.consumptionCount,
      status: args.status,
      createdAt: Date.now(),
    });
  },
});

// ============================================================
// QUERIES
// ============================================================

export const getById = query({
  args: { guestId: v.id("guests") },
  handler: async (ctx, args) => {
    const guest = await ctx.db.get(args.guestId);
    if (!guest) {
      return null;
    }
    await ensureEventReadAccess(ctx, guest.eventId);
    return guest;
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
    await ensureEventReadAccess(ctx, args.eventId);
    // Guard against oversized client requests (Convex enforces max page size).
    const safePaginationOpts = {
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 500)),
      cursor: args.paginationOpts.cursor,
    };

    // When filtering by status, use the compound index
    if (args.status) {
      const result = await ctx.db
        .query("guests")
        .withIndex("by_event_status", (q) =>
          q.eq("eventId", args.eventId).eq("status", args.status!),
        )
        .order("desc")
        .paginate(safePaginationOpts);

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
      .paginate(safePaginationOpts);

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
    await ensureEventReadAccess(ctx, args.eventId);

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
    await ensureEventReadAccess(ctx, args.eventId);

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
    await ensureEventReadAccess(ctx, args.eventId);

    const event = await ctx.db.get(args.eventId);
    if (!event) return 0;
    return event.guestCount ?? 0;
  },
});

export const listSmsRecipients = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await ensureEventReadAccess(ctx, args.eventId);

    // Paginated iteration to avoid crashing on large guest tables (60K+).
    const recipients: Array<{
      guestId: Id<"guests">;
      name: string;
      phone: string;
      cardUrl: string;
    }> = [];
    let isDone = false;
    let cursor: string | null = null;

    while (!isDone) {
      const page = await ctx.db
        .query("guests")
        .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
        .paginate({ numItems: 500, cursor: cursor as string | null });

      for (const guest of page.page) {
        if (guest.cardImageUrl) {
          recipients.push({
            guestId: guest._id,
            name: guest.name,
            phone: guest.phone,
            cardUrl: guest.cardImageUrl,
          });
        }
      }

      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    return recipients;
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
    await ensureEventReadAccess(ctx, args.eventId);

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
    await ensureEventEditAccess(ctx, args.eventId);

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

    if (inserted > 0) {
      await ctx.db.patch(args.eventId, {
        guestCount: (event.guestCount ?? 0) + inserted,
        updatedAt: now,
      });
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
    const guest = await ctx.db.get(args.guestId);
    if (!guest) throw new Error("Guest not found");
    await ensureEventEditAccess(ctx, guest.eventId);

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
