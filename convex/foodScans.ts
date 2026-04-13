import { v } from "convex/values";
import { query } from "./_generated/server";
import { ensureEventReadAccess } from "./authz";

export const listByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await ensureEventReadAccess(ctx, args.eventId);

    return await ctx.db
      .query("foodScans")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});
