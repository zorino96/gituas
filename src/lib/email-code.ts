import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/** A code stops working after this long. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses allowed against one code before a new one must be sent. */
export const MAX_ATTEMPTS = 5;
/** Shortest gap between two codes to the same address. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Codes one address, or one connection, may be sent in an hour. */
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_SENDS_PER_IP_PER_HOUR = 10;

/** Six random digits, leading zeros kept. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * What the person typed, as six ASCII digits, or null. Kurdish keyboards
 * type Arabic-Indic (٠-٩) or Persian (۰-۹) digits, and people paste codes
 * with spaces in them.
 */
export function normalizeCode(raw: string): string | null {
  const ascii = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s-]/g, "");
  return /^\d{6}$/.test(ascii) ? ascii : null;
}

/**
 * Keyed hash of a code. Keyed with the server secret because a million
 * possible codes is nothing to brute-force from a leaked plain hash.
 */
export function hashCode(email: string, code: string, secret = process.env.AUTH_SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

/** Constant-time comparison against a stored hash; anything malformed fails. */
export function codeMatches(email: string, code: string, stored: string, secret = process.env.AUTH_SECRET): boolean {
  const expected = Buffer.from(stored, "hex");
  const actual = Buffer.from(hashCode(email, code, secret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
