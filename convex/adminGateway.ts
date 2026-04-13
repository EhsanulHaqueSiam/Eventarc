import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { signPayload } from "./lib/hmac";

async function ensureAuthenticated(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
}

async function ensureEventAccess(
  ctx: ActionCtx,
  eventId: Id<"events">,
  mode: "read" | "edit",
) {
  await ensureAuthenticated(ctx);

  const event = await ctx.runQuery(api.events.getById, {
    eventId,
  });
  if (!event) {
    throw new Error("Event not found");
  }

  if (mode === "edit") {
    const access = await ctx.runQuery(api.eventPermissions.myEventAccess, {
      eventId,
    });
    if (!access.canEdit) {
      throw new Error("You do not have edit access to this event");
    }
  }
}

async function signedGatewayFetch<T>({
  url,
  method,
  bodyObject,
  hmacSecret,
}: {
  url: string;
  method: "GET" | "POST";
  bodyObject?: unknown;
  hmacSecret: string;
}): Promise<T> {
  const body = bodyObject ? JSON.stringify(bodyObject) : "";
  const timestamp = new Date().toISOString();
  const signature = await signPayload(hmacSecret, timestamp, body);

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
      "X-Timestamp": timestamp,
    },
    ...(method === "POST" ? { body } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gateway request failed: ${response.status} ${errorText}`,
    );
  }

  return (await response.json()) as T;
}

function getGoApiUrl(): string {
  const url = process.env.GO_API_URL ?? process.env.GO_BACKEND_URL;
  if (!url) {
    throw new Error(
      "Go backend URL is not configured. Set GO_API_URL (preferred) or GO_BACKEND_URL in Convex env.",
    );
  }
  return url;
}

const compositeResponseValidator = v.object({
  status: v.string(),
});

const compositeProgressValidator = v.object({
  total: v.number(),
  done: v.number(),
  failed: v.number(),
});

const smsSendResponseValidator = v.object({
  status: v.string(),
});

const smsProgressValidator = v.object({
  total: v.number(),
  queued: v.number(),
  sent: v.number(),
  delivered: v.number(),
  failed: v.number(),
  balanceError: v.optional(v.boolean()),
});

export const triggerCardCompositing = action({
  args: {
    eventId: v.id("events"),
    templateId: v.id("cardTemplates"),
  },
  returns: compositeResponseValidator,
  handler: async (ctx, args) => {
    await ensureEventAccess(ctx, args.eventId, "edit");

    const template = await ctx.runQuery(api.cardTemplates.get, {
      id: args.templateId,
    });
    if (!template || template.eventId !== args.eventId) {
      throw new Error("Template not found for this event");
    }
    if (!template.backgroundImageKey) {
      throw new Error("Template background is missing");
    }
    if (!template.backgroundImageUrl) {
      throw new Error("Template background URL is unavailable");
    }

    const goApiUrl = getGoApiUrl();
    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
      throw new Error("HMAC_SECRET environment variable not configured");
    }

    const baseQrSize = 150;
    const width = Math.max(
      1,
      Math.round(baseQrSize * template.qrOverlay.scaleX),
    );
    const height = Math.max(
      1,
      Math.round(baseQrSize * template.qrOverlay.scaleY),
    );

    return await signedGatewayFetch<{
      status: string;
    }>({
      url: `${goApiUrl}/api/v1/events/${args.eventId}/cards/composite`,
      method: "POST",
      bodyObject: {
        templateId: args.templateId,
        backgroundImageKey: template.backgroundImageKey,
        backgroundImageUrl: template.backgroundImageUrl,
        qrOverlay: {
          left: Math.round(template.qrOverlay.left),
          top: Math.round(template.qrOverlay.top),
          width,
          height,
        },
      },
      hmacSecret,
    });
  },
});

export const getCardCompositingProgress = action({
  args: {
    eventId: v.id("events"),
  },
  returns: compositeProgressValidator,
  handler: async (ctx, args) => {
    await ensureEventAccess(ctx, args.eventId, "read");

    const goApiUrl = process.env.GO_API_URL ?? process.env.GO_BACKEND_URL;
    const hmacSecret = process.env.HMAC_SECRET;
    if (!goApiUrl || !hmacSecret) {
      return { total: 0, done: 0, failed: 0 };
    }

    return await signedGatewayFetch<{
      total: number;
      done: number;
      failed: number;
    }>({
      url: `${goApiUrl}/api/v1/events/${args.eventId}/cards/progress`,
      method: "GET",
      hmacSecret,
    });
  },
});

export const triggerSmsSend = action({
  args: {
    eventId: v.id("events"),
    messageTemplate: v.string(),
  },
  returns: smsSendResponseValidator,
  handler: async (ctx, args) => {
    await ensureEventAccess(ctx, args.eventId, "edit");

    if (!args.messageTemplate.trim()) {
      throw new Error("Message template is required");
    }

    const recipients = await ctx.runQuery(api.guests.listSmsRecipients, {
      eventId: args.eventId,
    });
    if (recipients.length === 0) {
      throw new Error(
        "No guests with card URLs found. Generate invitation cards first.",
      );
    }

    const goApiUrl = getGoApiUrl();
    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
      throw new Error("HMAC_SECRET environment variable not configured");
    }

    return await signedGatewayFetch<{
      status: string;
    }>({
      url: `${goApiUrl}/api/v1/events/${args.eventId}/sms/send`,
      method: "POST",
      bodyObject: {
        messageTemplate: args.messageTemplate,
        guests: recipients.map((recipient) => ({
          guestId: recipient.guestId,
          name: recipient.name,
          phone: recipient.phone,
          cardUrl: recipient.cardUrl,
        })),
      },
      hmacSecret,
    });
  },
});

export const triggerSmsRetryFailed = action({
  args: {
    eventId: v.id("events"),
    messageTemplate: v.string(),
  },
  returns: smsSendResponseValidator,
  handler: async (ctx, args) => {
    await ensureEventAccess(ctx, args.eventId, "edit");

    if (!args.messageTemplate.trim()) {
      throw new Error("Message template is required");
    }

    const recipients = await ctx.runQuery(api.smsDeliveries.listFailedRecipients, {
      eventId: args.eventId,
    });
    if (recipients.length === 0) {
      throw new Error("No failed SMS deliveries to retry.");
    }

    const goApiUrl = getGoApiUrl();
    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
      throw new Error("HMAC_SECRET environment variable not configured");
    }

    return await signedGatewayFetch<{
      status: string;
    }>({
      url: `${goApiUrl}/api/v1/events/${args.eventId}/sms/send`,
      method: "POST",
      bodyObject: {
        messageTemplate: args.messageTemplate,
        guests: recipients.map((recipient) => ({
          guestId: recipient.guestId,
          name: recipient.name,
          phone: recipient.phone,
          cardUrl: recipient.cardUrl,
        })),
      },
      hmacSecret,
    });
  },
});

export const getSmsProgress = action({
  args: {
    eventId: v.id("events"),
  },
  returns: smsProgressValidator,
  handler: async (ctx, args) => {
    await ensureEventAccess(ctx, args.eventId, "read");

    const goApiUrl = process.env.GO_API_URL ?? process.env.GO_BACKEND_URL;
    const hmacSecret = process.env.HMAC_SECRET;
    if (!goApiUrl || !hmacSecret) {
      return {
        total: 0,
        queued: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
        balanceError: false,
      };
    }

    return await signedGatewayFetch<{
      total: number;
      queued: number;
      sent: number;
      delivered: number;
      failed: number;
      balanceError?: boolean;
    }>({
      url: `${goApiUrl}/api/v1/events/${args.eventId}/sms/progress`,
      method: "GET",
      hmacSecret,
    });
  },
});
