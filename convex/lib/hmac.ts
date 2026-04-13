/**
 * Shared HMAC-SHA256 signing utilities for Convex actions.
 *
 * Used by adminGateway.ts, sync.ts, and internalGateway.ts to sign
 * or verify requests between Convex and the Go backend.
 */

/**
 * Signs a payload with HMAC-SHA256 using the Web Crypto API.
 * Returns the hex-encoded signature string.
 */
export async function signPayload(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
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

  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison for HMAC signatures.
 * Prevents timing side-channel attacks by always comparing every byte
 * regardless of where a mismatch occurs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}
