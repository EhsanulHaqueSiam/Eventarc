import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  events: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    venue: v.optional(v.string()),
    eventDate: v.number(),
    endDate: v.optional(v.number()),
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
    }),
    // QR generation tracking (Phase 3)
    qrGenerationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("complete"),
        v.literal("failed"),
      ),
    ),
    qrJobId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_createdBy", ["createdBy"]),

  guestCategories: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    isDefault: v.boolean(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_name", ["eventId", "name"]),

  vendorTypes: defineTable({
    eventId: v.id("events"),
    name: v.union(v.literal("entry"), v.literal("food")),
  })
    .index("by_event", ["eventId"])
    .index("by_event_name", ["eventId", "name"]),

  vendorCategories: defineTable({
    eventId: v.id("events"),
    vendorTypeId: v.id("vendorTypes"),
    name: v.string(),
  })
    .index("by_event", ["eventId"])
    .index("by_vendorType", ["vendorTypeId"])
    .index("by_event_name", ["eventId", "name"]),

  stalls: defineTable({
    eventId: v.id("events"),
    categoryId: v.id("vendorCategories"),
    name: v.string(),
    isActive: v.boolean(),
  })
    .index("by_event", ["eventId"])
    .index("by_category", ["categoryId"])
    .index("by_event_name", ["eventId", "name"]),

  guests: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    phone: v.string(), // Normalized to 01XXXXXXXXX format
    categoryId: v.id("guestCategories"),
    status: v.union(
      v.literal("invited"),
      v.literal("smsSent"),
      v.literal("smsDelivered"),
      v.literal("checkedIn"),
    ),
    // QR generation fields (Phase 3)
    qrGenerated: v.optional(v.boolean()),
    qrUrls: v.optional(
      v.object({
        entry: v.optional(v.string()),
        food: v.optional(v.string()),
        unified: v.optional(v.string()),
      }),
    ),
    // Card compositing fields (Phase 8)
    cardImageUrl: v.optional(v.string()), // CDN URL of composite card
    cardImageKey: v.optional(v.string()), // R2 object key
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_event_phone", ["eventId", "phone"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["eventId", "categoryId", "status"],
    })
    .searchIndex("search_phone", {
      searchField: "phone",
      filterFields: ["eventId", "categoryId", "status"],
    }),

  smsDeliveries: defineTable({
    eventId: v.id("events"),
    guestId: v.id("guests"),
    phone: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    providerRequestId: v.optional(v.string()),
    retryCount: v.number(),
    lastAttemptAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_guest", ["guestId"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_providerRequestId", ["providerRequestId"]),

  deviceSessions: defineTable({
    eventId: v.id("events"),
    stallId: v.id("stalls"),
    vendorCategoryId: v.id("vendorCategories"),
    vendorTypeId: v.id("vendorTypes"),
    stallName: v.string(),
    token: v.string(), // Opaque token (stored in Go/Redis, mirrored here for admin view)
    status: v.union(v.literal("active"), v.literal("revoked")),
    lastHeartbeat: v.number(),
    scanCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_status", ["eventId", "status"])
    .index("by_token", ["token"]),

  cardTemplates: defineTable({
    eventId: v.id("events"),
    name: v.string(),
    backgroundImageUrl: v.string(),
    backgroundImageKey: v.string(),
    canvasWidth: v.number(),
    canvasHeight: v.number(),
    qrOverlay: v.object({
      left: v.number(),
      top: v.number(),
      scaleX: v.number(),
      scaleY: v.number(),
      angle: v.number(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_event", ["eventId"]),
});
