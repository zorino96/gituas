// Team invites. The link carries a random token; the database keeps only its
// SHA-256, so a leaked table cannot be used to join a desk.

import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITES_PER_DAY = 20;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export type InviteState = "ok" | "used" | "expired";

export function inviteState(invite: { acceptedAt: Date | null; expiresAt: Date }, now: Date = new Date()): InviteState {
  if (invite.acceptedAt) return "used";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "ok";
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/newsroom/join/${token}`;
}
