import { v } from "convex/values";
import { query } from "./_generated/server";

export const listByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vendorTypes")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});
