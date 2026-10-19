// The order tiles on Today: counts and sums from the database (GROUP BY), nothing else. Labelled for what they are: "ordered, not
// collected" is what buyers asked for and has not been delivered and paid for yet; it is never called sales or earnings.

import { db } from "@/lib/db";

const DAY = 86_400_000;
/** The statuses of an order that is asked for but not yet in the buyer's hands. */
export const OPEN_STATUSES = ["NEW", "CONFIRMED", "SENT"] as const;

export interface OrderTiles {
  /** Orders recorded in the last 7 days that count (not cancelled, not returned). */
  week: number;
  /** The same, by where the order came from. */
  bySource: { comments: number; messages: number; byHand: number };
  /** Delivered in the last 7 days. */
  delivered: number;
  /** Open orders of any age: how many, and their ordered value by currency in minor units (dinars and dollars are never added together). */
  open: { count: number; valueMinor: Record<string, number> };
}

export async function loadOrderTiles(tenantId: string, now = Date.now()): Promise<OrderTiles | null> {
  try {
    const since = new Date(now - 7 * DAY);
    const [open, recorded, delivered] = await Promise.all([
      db.order.groupBy({ by: ["currency"], where: { tenantId, status: { in: [...OPEN_STATUSES] } }, _count: { _all: true }, _sum: { amountMinor: true } }),
      db.order.groupBy({ by: ["source"], where: { tenantId, createdAt: { gt: since }, status: { notIn: ["CANCELLED", "RETURNED"] } }, _count: { _all: true } }),
      db.order.count({ where: { tenantId, status: "DELIVERED", updatedAt: { gt: since } } }),
    ]);
    const by = (source: string): number => recorded.find((r) => r.source === source)?._count._all ?? 0;
    const bySource = { comments: by("COMMENT"), messages: by("DM"), byHand: by("MANUAL") };
    const valueMinor: Record<string, number> = {};
    for (const r of open) if ((r._sum.amountMinor ?? 0) > 0) valueMinor[r.currency] = r._sum.amountMinor ?? 0;
    return {
      week: recorded.reduce((n, r) => n + r._count._all, 0),
      bySource,
      delivered,
      open: { count: open.reduce((n, r) => n + r._count._all, 0), valueMinor },
    };
  } catch (e) {
    console.error("[tiles] read failed:", e instanceof Error ? e.name : "unknown error");
    return null;
  }
}
