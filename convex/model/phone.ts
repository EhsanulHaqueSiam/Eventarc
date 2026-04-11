// Bangladesh mobile phone regex
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
  // Normalize to 01XXXXXXXXX format (11 digits)
  if (cleaned.startsWith("+880")) return cleaned.slice(3);
  if (cleaned.startsWith("880")) return cleaned.slice(2);
  return cleaned;
}
