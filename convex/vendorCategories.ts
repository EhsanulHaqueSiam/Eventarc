import { v } from "convex/values";
import { query } from "./_generated/server";

export const listByVendorType = query({
  args: { vendorTypeId: v.id("vendorTypes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vendorCategories")
      .withIndex("by_vendorType", (q) =>
        q.eq("vendorTypeId", args.vendorTypeId),
      )
      .collect();
  },
});

export const listByEvent = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vendorCategories")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .collect();
  },
});
