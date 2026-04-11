import { normalizePhone } from "./phone";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const GUEST_STATUSES = [
  "invited",
  "smsSent",
  "smsDelivered",
  "checkedIn",
] as const;
export type GuestStatus = (typeof GUEST_STATUSES)[number];

export interface GuestInput {
  name: string;
  phone: string;
  categoryId: Id<"guestCategories">;
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateGuestData(input: { name: string; phone: string }): {
  errors: ValidationError[];
  normalizedPhone: string | null;
} {
  const errors: ValidationError[] = [];
  const trimmedName = input.name.trim();

  if (!trimmedName) {
    errors.push({ field: "name", message: "Name is required" });
  } else if (trimmedName.length > 200) {
    errors.push({
      field: "name",
      message: "Name must be under 200 characters",
    });
  }

  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone) {
    errors.push({
      field: "phone",
      message:
        "Invalid Bangladesh phone number. Expected: 01XXXXXXXXX or +8801XXXXXXXXX",
    });
  }

  return { errors, normalizedPhone };
}

export async function checkPhoneDuplicate(
  ctx: MutationCtx,
  eventId: Id<"events">,
  phone: string,
  excludeGuestId?: Id<"guests">,
): Promise<boolean> {
  const existing = await ctx.db
    .query("guests")
    .withIndex("by_event_phone", (q) =>
      q.eq("eventId", eventId).eq("phone", phone),
    )
    .first();
  if (!existing) return false;
  if (excludeGuestId && existing._id === excludeGuestId) return false;
  return true;
}
