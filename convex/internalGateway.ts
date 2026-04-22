import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { signPayload, timingSafeEqual } from "./lib/hmac";

const MAX_DRIFT_MS = 5 * 60 * 1000;

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function verifyAndParseBody(req: Request): Promise<
  | { ok: true; bodyText: string; json: unknown }
  | { ok: false; response: Response }
> {
  const hmacSecret = process.env.HMAC_SECRET;
  if (!hmacSecret) {
    return {
      ok: false,
      response: jsonResponse(500, {
        error: {
          code: "missing_hmac_secret",
          message: "HMAC_SECRET is not configured",
        },
      }),
    };
  }

  const signature = req.headers.get("X-Signature");
  const timestamp = req.headers.get("X-Timestamp");
  if (!signature || !timestamp) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: {
          code: "missing_signature",
          message: "Missing X-Signature or X-Timestamp",
        },
      }),
    };
  }

  const requestTime = new Date(timestamp).getTime();
  if (!Number.isFinite(requestTime)) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: {
          code: "invalid_timestamp",
          message: "X-Timestamp is invalid",
        },
      }),
    };
  }

  if (Math.abs(Date.now() - requestTime) > MAX_DRIFT_MS) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: {
          code: "expired_signature",
          message: "Request timestamp is outside allowed window",
        },
      }),
    };
  }

  const bodyText = await req.text();
  const expectedSignature = await signPayload(hmacSecret, timestamp, bodyText);
  if (!timingSafeEqual(expectedSignature, signature.toLowerCase())) {
    return {
      ok: false,
      response: jsonResponse(401, {
        error: {
          code: "invalid_signature",
          message: "Signature verification failed",
        },
      }),
    };
  }

  let parsed: unknown;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: {
          code: "invalid_body",
          message: "Invalid JSON payload",
        },
      }),
    };
  }

  return {
    ok: true,
    bodyText,
    json: parsed,
  };
}

export const syncGuestCard = httpAction(async (ctx, req) => {
  const verified = await verifyAndParseBody(req);
  if (!verified.ok) {
    return verified.response;
  }

  const body = verified.json as {
    event_id?: string;
    guest_id?: string;
    card_image_url?: string;
    card_image_key?: string;
  };

  if (
    !body.event_id ||
    !body.guest_id ||
    !body.card_image_url ||
    !body.card_image_key
  ) {
    return jsonResponse(400, {
      error: {
        code: "missing_fields",
        message:
          "event_id, guest_id, card_image_url, and card_image_key are required",
      },
    });
  }

  await ctx.runMutation(internal.guests.internalSetCardImage, {
    eventId: body.event_id as Id<"events">,
    guestId: body.guest_id as Id<"guests">,
    cardImageUrl: body.card_image_url,
    cardImageKey: body.card_image_key,
  });

  return jsonResponse(200, {
    status: "ok",
  });
});

export const syncGuestCheckIn = httpAction(async (ctx, req) => {
  const verified = await verifyAndParseBody(req);
  if (!verified.ok) {
    return verified.response;
  }

  const body = verified.json as {
    event_id?: string;
    guest_id?: string;
    checked_in_at?: string;
  };

  if (!body.event_id || !body.guest_id) {
    return jsonResponse(400, {
      error: {
        code: "missing_fields",
        message: "event_id and guest_id are required",
      },
    });
  }

  const checkedInAt = body.checked_in_at
    ? Date.parse(body.checked_in_at)
    : undefined;

  await ctx.runMutation(internal.guests.internalMarkCheckedIn, {
    eventId: body.event_id as Id<"events">,
    guestId: body.guest_id as Id<"guests">,
    checkedInAt: Number.isFinite(checkedInAt) ? checkedInAt : undefined,
  });

  return jsonResponse(200, {
    status: "ok",
  });
});

export const syncSMSStatus = httpAction(async (ctx, req) => {
  const verified = await verifyAndParseBody(req);
  if (!verified.ok) {
    return verified.response;
  }

  const body = verified.json as {
    event_id?: string;
    guest_id?: string;
    phone?: string;
    status?: "queued" | "sending" | "sent" | "delivered" | "failed";
    provider_request_id?: string;
    failure_reason?: string;
    last_attempt_at?: string;
  };

  if (!body.event_id || !body.guest_id || !body.phone || !body.status) {
    return jsonResponse(400, {
      error: {
        code: "missing_fields",
        message: "event_id, guest_id, phone, and status are required",
      },
    });
  }

  const lastAttemptAt = body.last_attempt_at
    ? Date.parse(body.last_attempt_at)
    : undefined;

  await ctx.runMutation(internal.smsDeliveries.internalSyncStatus, {
    eventId: body.event_id as Id<"events">,
    guestId: body.guest_id as Id<"guests">,
    phone: body.phone,
    status: body.status,
    providerRequestId: body.provider_request_id,
    failureReason: body.failure_reason,
    lastAttemptAt: Number.isFinite(lastAttemptAt) ? lastAttemptAt : undefined,
  });

  return jsonResponse(200, { status: "ok" });
});

export const syncFoodConsumption = httpAction(async (ctx, req) => {
  const verified = await verifyAndParseBody(req);
  if (!verified.ok) {
    return verified.response;
  }

  const body = verified.json as {
    event_id?: string;
    idempotency_key?: string;
    guest_id?: string;
    food_category_id?: string;
    stall_id?: string;
    scanned_at?: string;
    device_id?: string;
    guest_category?: string;
    is_anonymous?: boolean;
    consumption_count?: number;
    status?: "valid" | "limit_reached" | "rejected";
  };

  if (
    !body.event_id ||
    !body.idempotency_key ||
    !body.guest_id ||
    !body.food_category_id ||
    !body.stall_id ||
    !body.device_id
  ) {
    return jsonResponse(400, {
      error: {
        code: "missing_fields",
        message:
          "event_id, idempotency_key, guest_id, food_category_id, stall_id, and device_id are required",
      },
    });
  }

  const scannedAt = body.scanned_at ? Date.parse(body.scanned_at) : Date.now();
  if (!Number.isFinite(scannedAt)) {
    return jsonResponse(400, {
      error: {
        code: "invalid_scanned_at",
        message: "scanned_at must be a valid ISO timestamp",
      },
    });
  }

  await ctx.runMutation(internal.guests.internalRecordFoodConsumption, {
    eventId: body.event_id as Id<"events">,
    idempotencyKey: body.idempotency_key,
    guestId: body.guest_id,
    foodCategoryId: body.food_category_id as Id<"vendorCategories">,
    stallId: body.stall_id as Id<"stalls">,
    scannedAt,
    deviceId: body.device_id,
    guestCategory: body.guest_category,
    isAnonymous: Boolean(body.is_anonymous),
    consumptionCount:
      typeof body.consumption_count === "number"
        ? body.consumption_count
        : 0,
    status: body.status ?? "valid",
  });

  return jsonResponse(200, {
    status: "ok",
  });
});
