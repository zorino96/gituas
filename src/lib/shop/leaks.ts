// "Who wrote and has no order recorded": the owner's leak card. Counts only, from the database, of buyers who sent a direct message
// about a product and have no order in Gituas.
//
// What this is NOT: a count of lost sales. A buyer with no order recorded here may have ordered by phone, in the shop, on WhatsApp
// or from another account; the word is "no order recorded", never "lost". No buyer text, name or id leaves this file: only numbers.

import { db } from "@/lib/db";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A buyer who wrote less than this long ago is "hot": the conversation is still alive. */
export const HOT_MS = 24 * HOUR;
/** Older than this, a conversation is history, not a leak. */
export const WINDOW_MS = 7 * DAY;
/** The most message rows read; more than this and the counts are shown as "at least". */
export const ROW_CAP = 4_000;

export interface LeakRow {
  storeId: string | null;
  authorId: string | null;
  createdAt: Date;
  boundProductId: string | null;
}

export interface Leaks {
  /** Buyers whose last message about a product is under 24 hours old and have no order recorded. */
  hot: number;
  /** The same, but their last message is 24 hours to 7 days old: the conversation went quiet. */
  quiet: number;
  /** The read hit its row cap: the true numbers are at least these. */
  capped: boolean;
}

/**
 * Pure: the buyers among `rows` (inbound direct messages of the last 7 days) who wrote about a product, have no order and are not
 * being handled by the owner by hand. One buyer counts once, by their latest message.
 */
export function classifyLeaks(rows: readonly LeakRow[], ordered: ReadonlySet<string>, handled: ReadonlySet<string>, now: number): Omit<Leaks, "capped"> {
  const byBuyer = new Map<string, { last: number; product: boolean }>();
  for (const r of rows) {
    if (!r.authorId) continue;
    if (ordered.has(r.authorId) || handled.has(r.authorId)) continue;
    const age = now - r.createdAt.getTime();
    if (age < 0 || age > WINDOW_MS) continue;
    const key = `${r.storeId ?? ""}:${r.authorId}`;
    const seen = byBuyer.get(key) ?? { last: 0, product: false };
    seen.last = Math.max(seen.last, r.createdAt.getTime());
    seen.product = seen.product || !!r.boundProductId;
    byBuyer.set(key, seen);
  }
  let hot = 0;
  let quiet = 0;
  for (const b of byBuyer.values()) {
    if (!b.product) continue;
    if (now - b.last < HOT_MS) hot++;
    else quiet++;
  }
  return { hot, quiet };
}

/**
 * The leak counts of a workspace. Direct messages only (a comment is public and an order from it is opened on its own); spam and
 * abuse and rows marked as history are left out, and so is a thread the owner took over by hand. Never throws: null when unreadable.
 */
export async function loadLeaks(tenantId: string, now = Date.now()): Promise<Leaks | null> {
  try {
    const since = new Date(now - WINDOW_MS);
    const rows = await db.conversationMessage.findMany({
      where: {
        store: { tenantId },
        channelType: "DM",
        direction: "INBOUND",
        authorId: { not: null },
        createdAt: { gt: since },
        // A null never matches a "not" filter in SQL, so each exclusion is written as "is empty or is not that".
        AND: [{ OR: [{ commentType: null }, { commentType: { notIn: ["SPAM", "ABUSE"] } }] }, { OR: [{ outcomeReason: null }, { outcomeReason: { not: "history" } }] }],
      },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
      // No text column is read: only who (an opaque id), when, and whether a product was bound.
      select: { storeId: true, authorId: true, createdAt: true, boundProductId: true },
    });
    const ids = [...new Set(rows.map((r) => r.authorId).filter((id): id is string => !!id))].slice(0, 2_000);
    if (!ids.length) return { hot: 0, quiet: 0, capped: false };
    const [orders, pauses] = await Promise.all([
      db.order.findMany({ where: { tenantId, buyerKey: { in: ids }, createdAt: { gt: since } }, select: { buyerKey: true } }),
      db.threadPause.findMany({ where: { tenantId, threadKey: { in: ids } }, select: { threadKey: true } }),
    ]);
    const ordered = new Set(orders.map((o) => o.buyerKey).filter((k): k is string => !!k));
    const handled = new Set(pauses.map((p) => p.threadKey));
    return { ...classifyLeaks(rows, ordered, handled, now), capped: rows.length >= ROW_CAP };
  } catch (e) {
    console.error("[leaks] read failed:", e instanceof Error ? e.name : "unknown error");
    return null;
  }
}
