import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Internal query to fetch event data for QR generation.
 * Not exposed publicly — only called from actions within this file.
 */
export const getEventForQR = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.eventId);
  },
});

/**
 * Internal mutation to update QR generation status on an event.
 * Called after triggering Go API and when generation completes.
 */
export const updateQRGenerationStatus = internalMutation({
  args: {
    eventId: v.id("events"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    jobId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      qrGenerationStatus: args.status,
      updatedAt: Date.now(),
    };
    if (args.jobId !== undefined) {
      patch.qrJobId = args.jobId;
    }
    await ctx.db.patch(args.eventId, patch);
  },
});

/**
 * Public query to check QR generation status for the frontend dashboard.
 * Returns the current generation status and job ID for polling.
 */
export const getQRGenerationStatus = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return null;
    return {
      status: event.qrGenerationStatus ?? null,
      jobId: event.qrJobId ?? null,
    };
  },
});

/**
 * Trigger bulk QR code generation for all guests in an event.
 * Makes an HMAC-signed HTTP request to the Go API which enqueues
 * background tasks via asynq.
 *
 * Called by admin from the event management UI.
 */
export const triggerGeneration = action({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    // 1. Read event from DB
    const event = await ctx.runQuery(internal.qr.getEventForQR, {
      eventId: args.eventId,
    });
    if (!event) {
      throw new Error("Event not found");
    }

    // 2. Validate event state
    if (event.status === "draft") {
      throw new Error(
        "Cannot generate QR codes for a draft event. Set event to active first.",
      );
    }
    if (event.qrGenerationStatus === "running") {
      throw new Error(
        "QR generation is already in progress for this event.",
      );
    }

    // 3. Build HMAC-signed request to Go API
    const goApiUrl = process.env.GO_API_URL;
    if (!goApiUrl) {
      throw new Error("GO_API_URL environment variable not configured");
    }
    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
      throw new Error("HMAC_SECRET environment variable not configured");
    }

    const body = JSON.stringify({
      eventId: args.eventId,
      qrStrategy: event.config.qrStrategy,
      foodQrMode: event.config.foodQrMode,
      foodQrTiming: event.config.foodQrTiming,
    });

    const timestamp = new Date().toISOString();

    // HMAC-SHA256 signing (matching Go middleware pattern)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hmacSecret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(timestamp + body),
    );
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // 4. Call Go API
    const response = await fetch(`${goApiUrl}/api/v1/qr/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `QR generation trigger failed: ${response.status} ${error}`,
      );
    }

    const result = (await response.json()) as {
      jobId: string;
      status: string;
    };

    // 5. Update event with job info
    await ctx.runMutation(internal.qr.updateQRGenerationStatus, {
      eventId: args.eventId,
      status: "pending",
      jobId: result.jobId,
    });

    return { jobId: result.jobId, status: "pending" };
  },
});

/**
 * Internal action to trigger incremental QR generation for newly added guests.
 * Called when guests are added after the initial bulk generation (D-05).
 *
 * Uses the same HMAC-signed HTTP pattern as triggerGeneration but includes
 * specific guest IDs so only those guests get QR codes generated.
 */
export const triggerIncrementalGeneration = internalAction({
  args: {
    eventId: v.id("events"),
    guestIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.runQuery(internal.qr.getEventForQR, {
      eventId: args.eventId,
    });
    if (!event) return;

    const goApiUrl = process.env.GO_API_URL;
    const hmacSecret = process.env.HMAC_SECRET;
    if (!goApiUrl || !hmacSecret) return;

    const body = JSON.stringify({
      eventId: args.eventId,
      guestIds: args.guestIds,
      qrStrategy: event.config.qrStrategy,
      foodQrMode: event.config.foodQrMode,
      foodQrTiming: event.config.foodQrTiming,
    });

    const timestamp = new Date().toISOString();
    const encoder = new TextEncoder();
    const keyData = encoder.encode(hmacSecret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(timestamp + body),
    );
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await fetch(`${goApiUrl}/api/v1/qr/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
      body,
    });
  },
});
