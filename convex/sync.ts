import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const pushEventToGo = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    // TODO (Phase 4): Push full event/guest/vendor dataset to Go endpoint
    // D-03: On go-live, push everything to Go which populates Redis
    // D-23: Retry with exponential backoff (1s, 2s, 4s), log to sync_failures after 3 retries
    console.log(
      `[SYNC STUB] Would push event ${args.eventId} to Go microservice`,
    );
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
    // Fetch all food rules for the event
    const rules = await ctx.runQuery(
      "sync:getFoodRulesByEvent" as any,
      { eventId: args.eventId },
    );

    const goBackendUrl = process.env.GO_BACKEND_URL;
    if (!goBackendUrl) {
      console.error("[SYNC] GO_BACKEND_URL not configured");
      return;
    }

    const response = await fetch(`${goBackendUrl}/api/v1/sync/food-rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // HMAC auth handled by Go middleware
      },
      body: JSON.stringify({
        type: "food_rules",
        event_id: args.eventId,
        rules: rules.map(
          (r: {
            guestCategoryId: string;
            foodCategoryId: string;
            limit: number;
          }) => ({
            guest_category_id: r.guestCategoryId,
            food_category_id: r.foodCategoryId,
            limit: r.limit,
          }),
        ),
      }),
    });

    if (!response.ok) {
      console.error(
        `[SYNC] Food rules sync failed: ${response.status} ${response.statusText}`,
      );
      return;
    }

    console.log(
      `[SYNC] Food rules synced for event ${args.eventId} (${rules.length} rules)`,
    );
  },
});
