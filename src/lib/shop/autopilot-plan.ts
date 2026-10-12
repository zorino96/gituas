// The shop autopilot's choices, pure so they can be tested: whether a store is due now,
// and which product it posts. The engine (./autopilot.ts) does the reading and posting.

import { baghdadHour } from "@/lib/news/autopilot-settings";
import type { StorePlan } from "./plans";

export const SHOP_AUTO_MODES = ["OFF", "DRAFT", "PUBLISH"] as const;
export type ShopAutoMode = (typeof SHOP_AUTO_MODES)[number];
export const AUTO_PER_DAY = { min: 1, max: 3 } as const;

/** A product is posted again only after this long. */
export const REPOST_AFTER_MS = 7 * 86_400_000;
/** Evening, then midday and night: when Kurdish shoppers scroll, until the shop has its own numbers. */
const DEFAULT_HOURS = [20, 13, 22];
/** One post per slot: a tick inside the same slot hour never posts twice. */
export const SLOT_GUARD_MS = 90 * 60_000;

export function isShopAutoMode(v: unknown): v is ShopAutoMode {
  return typeof v === "string" && (SHOP_AUTO_MODES as readonly string[]).includes(v);
}

/** Posting without a person is a paid feature; a free shop only gets the post prepared. */
export function effectiveMode(mode: string, plan: StorePlan | string): ShopAutoMode {
  if (!isShopAutoMode(mode)) return "OFF";
  return mode === "PUBLISH" && plan === "FREE" ? "DRAFT" : mode;
}

/** The Baghdad hours to post at: the hours buyers write most, else the default evening slots. */
export function slotHours(buyerHours: number[], perDay: number): number[] {
  const n = Math.min(Math.max(perDay, AUTO_PER_DAY.min), AUTO_PER_DAY.max);
  const picked = [...buyerHours];
  for (const h of DEFAULT_HOURS) if (picked.length < n && !picked.includes(h)) picked.push(h);
  return picked.slice(0, n).sort((a, b) => a - b);
}

/** Whether the store should post now: inside one of its slot hours, and not already posted in this slot. */
export function isDue(lastAt: Date | null, hours: number[], now: number): boolean {
  if (!hours.includes(baghdadHour(now))) return false;
  return !lastAt || now - lastAt.getTime() >= SLOT_GUARD_MS;
}

export interface AutoProduct {
  id: string;
  name: string;
  photos: string[];
  autoPostedAt: Date | null;
  inStock: boolean;
}

/**
 * What to post: a product with a photo and something in stock, not posted in the last 7 days.
 * The products buyers order most come first, then the one posted longest ago (never posted first).
 */
export function pickProduct(products: AutoProduct[], bestSellers: string[], now: number): AutoProduct | null {
  const rank = (p: AutoProduct) => {
    const i = bestSellers.indexOf(p.name);
    return i === -1 ? bestSellers.length : i;
  };
  const ready = products.filter((p) => p.inStock && p.photos.length > 0 && (!p.autoPostedAt || now - p.autoPostedAt.getTime() >= REPOST_AFTER_MS));
  ready.sort((a, b) => rank(a) - rank(b) || (a.autoPostedAt?.getTime() ?? 0) - (b.autoPostedAt?.getTime() ?? 0));
  return ready[0] ?? null;
}
