import { createHash, randomInt } from "node:crypto";

// Test codes: the owner mints one in his own terminal (gituas-private/codes.cjs), types it into Settings, and the workspace
// has no limits. Only the hash of a code is stored. This file is the part with no database, so it can be tested.

/** Letters and digits that cannot be mistaken for one another (no I, L, O, 0, 1). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** What was typed, in the one form codes are stored and compared in: capitals, no spaces, dashes or invisible characters. */
export function normalizeCode(raw: string): string {
  return raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\-_.\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .slice(0, 64);
}

/** A code looks like GT-XXXX-XXXX-XXXX-XXXX once normalised: GT plus 16 characters. */
export function looksLikeCode(raw: string): boolean {
  return /^GT[A-Z0-9]{16}$/.test(normalizeCode(raw));
}

export function hashCode(raw: string): string {
  return createHash("sha256").update(`gituas-redeem:${normalizeCode(raw)}`).digest("hex");
}

/** A fresh random code (about 78 bits), written in groups of four to be easy to read out. */
export function makeCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let part = "";
    for (let i = 0; i < 4; i++) part += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(part);
  }
  return `GT-${groups.join("-")}`;
}

export interface CodeRow {
  maxUses: number;
  uses: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** Why a code cannot be redeemed now (null = it can). The caller shows one message for all of them. */
export function codeProblem(row: CodeRow | null, now: Date): "unknown" | "revoked" | "expired" | "used" | null {
  if (!row) return "unknown";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.uses >= row.maxUses) return "used";
  return null;
}

/** A news desk has no UNLIMITED plan: it gets the top plan, paid up to this date. */
export const DESK_COMP_UNTIL = new Date("2099-12-31T00:00:00.000Z");
