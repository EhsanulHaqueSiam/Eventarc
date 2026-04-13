import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { signPayload } from "./lib/hmac";

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

type EventSyncPayload = {
  type: "event_full";
  event_id: string;
  event: {
    id: string;
    name: string;
    status: string;
    qr_strategy: "unified" | "separate";
    food_qr_mode: "guestLinked" | "anonymous";
    food_qr_timing: "preSent" | "postEntry";
    allow_additional_guests: boolean;
    max_additional_guests: number;
  };
  guest_categories: Array<{
    id: string;
    name: string;
  }>;
  food_categories: Array<{
    id: string;
    name: string;
  }>;
  stalls: Array<{
    id: string;
    name: string;
    category_id: string;
    is_active: boolean;
  }>;
  guests: Array<{
    id: string;
    name: string;
    category_id: string;
    category_label: string;
    phone: string;
    status: string;
    photo_url: string;
  }>;
  counters: {
    total_invited: number;
  };
};

const syncDatasetValidator = v.object({
  event: v.union(
    v.object({
      _id: v.id("events"),
      name: v.string(),
      status: v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("live"),
        v.literal("completed"),
        v.literal("archived"),
      ),
      config: v.object({
        qrStrategy: v.union(v.literal("unified"), v.literal("separate")),
        foodQrMode: v.union(v.literal("guestLinked"), v.literal("anonymous")),
        foodQrTiming: v.union(v.literal("preSent"), v.literal("postEntry")),
        allowAdditionalGuests: v.optional(v.boolean()),
        maxAdditionalGuests: v.optional(v.number()),
      }),
    }),
    v.null(),
  ),
  guestCategories: v.array(
    v.object({
      _id: v.id("guestCategories"),
      name: v.string(),
    }),
  ),
  foodCategories: v.array(
    v.object({
      _id: v.id("vendorCategories"),
      name: v.string(),
    }),
  ),
  stalls: v.array(
    v.object({
      _id: v.id("stalls"),
      name: v.string(),
      categoryId: v.id("vendorCategories"),
      isActive: v.boolean(),
    }),
  ),
  guests: v.array(
    v.object({
      _id: v.id("guests"),
      name: v.string(),
      phone: v.string(),
      categoryId: v.id("guestCategories"),
      status: v.union(
        v.literal("invited"),
        v.literal("smsSent"),
        v.literal("smsDelivered"),
        v.literal("checkedIn"),
      ),
      photoUrl: v.optional(v.string()),
    }),
  ),
});

export const getEventSyncDataset = internalQuery({
  args: { eventId: v.id("events") },
  returns: syncDatasetValidator,
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      return {
        event: null,
        guestCategories: [],
        foodCategories: [],
        stalls: [],
        guests: [],
      };
    }

    const guestCategories = await ctx.db
      .query("guestCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const vendorTypes = await ctx.db
      .query("vendorTypes")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const foodType = vendorTypes.find((type) => type.name === "food");

    const vendorCategories = await ctx.db
      .query("vendorCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
    const foodCategories = foodType
      ? vendorCategories.filter((category) => category.vendorTypeId === foodType._id)
      : [];

    const stalls = await ctx.db
      .query("stalls")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    const guests = await ctx.db
      .query("guests")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();

    return {
      event: {
        _id: event._id,
        name: event.name,
        status: event.status,
        config: {
          qrStrategy: event.config.qrStrategy,
          foodQrMode: event.config.foodQrMode,
          foodQrTiming: event.config.foodQrTiming,
          allowAdditionalGuests: event.config.allowAdditionalGuests,
          maxAdditionalGuests: event.config.maxAdditionalGuests,
        },
      },
      guestCategories: guestCategories.map((category) => ({
        _id: category._id,
        name: category.name,
      })),
      foodCategories: foodCategories.map((category) => ({
        _id: category._id,
        name: category.name,
      })),
      stalls: stalls.map((stall) => ({
        _id: stall._id,
        name: stall.name,
        categoryId: stall.categoryId,
        isActive: stall.isActive,
      })),
      guests: guests.map((guest) => ({
        _id: guest._id,
        name: guest.name,
        phone: guest.phone,
        categoryId: guest.categoryId,
        status: guest.status,
        photoUrl: guest.photoUrl,
      })),
    };
  },
});

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const pushEventToGo = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const dataset: {
      event: {
        _id: string;
        name: string;
        status: "draft" | "active" | "live" | "completed" | "archived";
        config: {
          qrStrategy: "unified" | "separate";
          foodQrMode: "guestLinked" | "anonymous";
          foodQrTiming: "preSent" | "postEntry";
          allowAdditionalGuests?: boolean;
          maxAdditionalGuests?: number;
        };
      } | null;
      guestCategories: Array<{ _id: string; name: string }>;
      foodCategories: Array<{ _id: string; name: string }>;
      stalls: Array<{
        _id: string;
        name: string;
        categoryId: string;
        isActive: boolean;
      }>;
      guests: Array<{
        _id: string;
        name: string;
        phone: string;
        categoryId: string;
        status: "invited" | "smsSent" | "smsDelivered" | "checkedIn";
        photoUrl?: string;
      }>;
    } = await ctx.runQuery(internal.sync.getEventSyncDataset, {
      eventId: args.eventId,
    });

    if (!dataset.event) {
      console.warn(`[SYNC] Event ${args.eventId} not found, skipping pushEventToGo`);
      return;
    }

    const goBackendUrl = process.env.GO_API_URL ?? process.env.GO_BACKEND_URL;
    if (!goBackendUrl) {
      console.error("[SYNC] GO backend URL not configured");
      return;
    }

    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
      console.error("[SYNC] HMAC_SECRET not configured");
      return;
    }

    const categoryNameById = new Map(
      dataset.guestCategories.map((category) => [category._id, category.name]),
    );

    const payload: EventSyncPayload = {
      type: "event_full",
      event_id: args.eventId,
      event: {
        id: dataset.event._id,
        name: dataset.event.name,
        status: dataset.event.status,
        qr_strategy: dataset.event.config.qrStrategy,
        food_qr_mode: dataset.event.config.foodQrMode,
        food_qr_timing: dataset.event.config.foodQrTiming,
        allow_additional_guests: dataset.event.config.allowAdditionalGuests ?? false,
        max_additional_guests: dataset.event.config.maxAdditionalGuests ?? 0,
      },
      guest_categories: dataset.guestCategories.map((category) => ({
        id: category._id,
        name: category.name,
      })),
      food_categories: dataset.foodCategories.map((category) => ({
        id: category._id,
        name: category.name,
      })),
      stalls: dataset.stalls.map((stall) => ({
        id: stall._id,
        name: stall.name,
        category_id: stall.categoryId,
        is_active: stall.isActive,
      })),
      guests: dataset.guests.map((guest) => ({
        id: guest._id,
        name: guest.name,
        category_id: guest.categoryId,
        category_label: categoryNameById.get(guest.categoryId) ?? "",
        phone: guest.phone,
        status: guest.status,
        photo_url: guest.photoUrl ?? "",
      })),
      counters: {
        total_invited: dataset.guests.length,
      },
    };

    const body = JSON.stringify(payload);

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      const timestamp = new Date().toISOString();
      const signature = await signPayload(hmacSecret, timestamp, body);

      const response = await fetch(`${goBackendUrl}/api/v1/sync/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Timestamp": timestamp,
        },
        body,
      });

      if (response.ok) {
        console.log(
          `[SYNC] Event dataset synced for ${args.eventId} (guests=${payload.guests.length}, stalls=${payload.stalls.length}, foodCategories=${payload.food_categories.length})`,
        );
        return;
      }

      const details = await response.text();
      const isLastAttempt = attempt === RETRY_DELAYS_MS.length - 1;
      console.error(
        `[SYNC] Event sync attempt ${attempt + 1} failed for ${args.eventId}: ${response.status} ${details}`,
      );

      if (isLastAttempt) {
        throw new Error(
          `[SYNC] Event sync failed after ${attempt + 1} attempts: ${response.status} ${details}`,
        );
      }

      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  },
});

// Internal query to fetch food rules (used by syncFoodRules action)
export const getFoodRulesByEvent = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("foodRules")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});

export const syncFoodRules = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const rules: Array<{
      guestCategoryId: string;
      foodCategoryId: string;
      limit: number;
    }> = await ctx.runQuery(internal.sync.getFoodRulesByEvent, {
      eventId: args.eventId,
    });

    const goBackendUrl = process.env.GO_API_URL ?? process.env.GO_BACKEND_URL;
    if (!goBackendUrl) {
      console.error("[SYNC] GO backend URL not configured");
      return;
    }

    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
      console.error("[SYNC] HMAC_SECRET not configured");
      return;
    }

    const body = JSON.stringify({
      type: "food_rules",
      event_id: args.eventId,
      rules: rules.map((r) => ({
        guest_category_id: r.guestCategoryId,
        food_category_id: r.foodCategoryId,
        limit: r.limit,
      })),
    });
    const timestamp = new Date().toISOString();
    const signature = await signPayload(hmacSecret, timestamp, body);

    const response = await fetch(`${goBackendUrl}/api/v1/sync/food-rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
      body,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `[SYNC] Food rules sync failed: ${response.status} ${details}`,
      );
    }

    console.log(
      `[SYNC] Food rules synced for event ${args.eventId} (${rules.length} rules)`,
    );
  },
});
