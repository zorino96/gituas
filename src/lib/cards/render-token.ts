// The card render page (/newsroom/card-render/[id]) has no session: the headless
// browser that screenshots it carries this short-lived token instead.
// token = "<expiryUnix>.<hex>", hex = HMAC-SHA256(AUTH_SECRET, "<draftId>.<expiryUnix>").
import { createHmac, timingSafeEqual } from "node:crypto";

/** A token opens its one draft's card for at most this long. */
export const RENDER_TOKEN_TTL_SEC = 5 * 60;

const mac = (draftId: string, expiry: number, secret: string) => createHmac("sha256", secret).update(`${draftId}.${expiry}`).digest("hex");

/** A fresh token for one draft. Throws when the server secret is missing: nothing can be rendered without it. */
export function signRenderToken(draftId: string, nowMs = Date.now(), secret = process.env.AUTH_SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const expiry = Math.floor(nowMs / 1000) + RENDER_TOKEN_TTL_SEC;
  return `${expiry}.${mac(draftId, expiry, secret)}`;
}

/**
 * True only for an untampered token of this very draft that has not run out. Fails closed:
 * no secret, a malformed token, an expiry in the past or further away than a token can
 * be issued for are all refused.
 */
export function verifyRenderToken(draftId: string, token: unknown, nowMs = Date.now(), secret = process.env.AUTH_SECRET): boolean {
  if (!secret || !draftId || typeof token !== "string") return false;
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return false;
  const expiry = Number(m[1]);
  const now = Math.floor(nowMs / 1000);
  if (expiry <= now || expiry - now > RENDER_TOKEN_TTL_SEC) return false;
  const given = Buffer.from(m[2], "hex");
  const expected = Buffer.from(mac(draftId, expiry, secret), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
