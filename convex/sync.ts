import { internalAction } from "./_generated/server";
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
