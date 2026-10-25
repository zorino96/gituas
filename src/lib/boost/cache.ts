// Saved post analyses, so a shop sees them again without paying the AI again, and the daily
// allowance per plan. One small JSON file per shop on Vercel Blob, at a path made from an HMAC of
// the shop id (shop ids appear in public media links). No database table needed.

import { createHmac } from "node:crypto";
import { head, put } from "@/lib/storage";
import { db } from "@/lib/db";
import type { PostAdvice } from "@/lib/orders/post-advice";

export interface SavedAnalysis {
  at: string;
  advice: PostAdvice;
  basedOn: { likes: number | null; comments: number; messages: number; orders: number };
}

export interface BoostCache {
  /** Baghdad day the counter belongs to (YYYY-MM-DD). */
  day: string;
  used: number;
  posts: Record<string, SavedAnalysis>;
}

/** Analyses a shop may run per day, by its best store plan. */
export const DAILY_ANALYSES: Record<string, number> = { FREE: 1, MERCHANT: 4, PRO: 8, MAX: 20, UNLIMITED: 500 };
/** A post analysed less than this long ago is shown from the cache; the button asks again only after it. */
export const REANALYSE_MS = 6 * 60 * 60 * 1000;
const KEEP = 120;

export function baghdadDay(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function cachePath(tenantId: string, secret = process.env.AUTH_SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const k = createHmac("sha256", secret).update(`boost:${tenantId}`).digest("hex").slice(0, 24);
  return `merchant/${tenantId}/boost/${k}.json`;
}

export const postKey = (platform: string, id: string) => `${platform}:${id}`;

export function emptyCache(now = Date.now()): BoostCache {
  return { day: baghdadDay(now), used: 0, posts: {} };
}

/** A new day resets the counter; the saved analyses stay. */
export function rollDay(c: BoostCache, now = Date.now()): BoostCache {
  const day = baghdadDay(now);
  return c.day === day ? c : { ...c, day, used: 0 };
}

/** Keep the newest KEEP analyses so the file stays small. */
export function withAnalysis(c: BoostCache, key: string, a: SavedAnalysis): BoostCache {
  const posts = { ...c.posts, [key]: a };
  const keys = Object.keys(posts).sort((x, y) => posts[y].at.localeCompare(posts[x].at));
  return { ...c, used: c.used + 1, posts: Object.fromEntries(keys.slice(0, KEEP).map((k) => [k, posts[k]])) };
}

export async function readBoostCache(tenantId: string): Promise<BoostCache> {
  try {
    const meta = await head(cachePath(tenantId));
    const res = await fetch(`${meta.url}?v=${meta.uploadedAt.getTime()}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return emptyCache();
    const c = (await res.json()) as Partial<BoostCache>;
    return rollDay({ day: c.day ?? baghdadDay(), used: c.used ?? 0, posts: c.posts ?? {} });
  } catch {
    return emptyCache();
  }
}

export async function writeBoostCache(tenantId: string, c: BoostCache): Promise<void> {
  await put(cachePath(tenantId), JSON.stringify(c), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
}

/** The best plan among the workspace's stores decides how many analyses a day it gets. */
export async function dailyAllowance(tenantId: string): Promise<number> {
  const stores = await db.store.findMany({ where: { tenantId }, select: { plan: true } });
  return Math.max(DAILY_ANALYSES.FREE, ...stores.map((s) => DAILY_ANALYSES[s.plan] ?? DAILY_ANALYSES.FREE));
}
