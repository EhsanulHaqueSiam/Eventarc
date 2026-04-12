// Bangladesh mobile phone regex -- MUST match convex/model/phone.ts exactly
// Valid: 01XXXXXXXXX (11 digits) or +8801XXXXXXXXX or 8801XXXXXXXXX
// Operators: 013, 014, 015, 016, 017, 018, 019
export const BD_PHONE_REGEX = /^(?:\+?880)?01[3-9]\d{8}$/;

export function validateBDPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  return BD_PHONE_REGEX.test(cleaned);
}

export function normalizePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  if (!BD_PHONE_REGEX.test(cleaned)) return null;
  if (cleaned.startsWith("+880")) return cleaned.slice(3);
  if (cleaned.startsWith("880")) return cleaned.slice(2);
  return cleaned;
}

/** Detect if search input looks like a phone number */
export function looksLikePhone(input: string): boolean {
  const trimmed = input.trim();
  return /^[+\d]/.test(trimmed) && /\d{3,}/.test(trimmed);
}
