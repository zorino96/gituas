// A place in a workspace's day and month for something that costs money each time (an AI picture).
// The counters are raised first and checked afterwards, so parallel requests cannot all read "room
// left" and all go through; a place that was over a limit is given back at once. Kept in `Usage`.

import { db } from "@/lib/db";
import { monthKey } from "@/lib/billing/limits";

export interface SlotMetric {
  /** Counted per calendar month (YYYY-MM). */
  month: string;
  /** Counted per Baghdad day (YYYY-MM-DD). */
  day: string;
}

/** The Baghdad calendar day, YYYY-MM-DD. */
export function baghdadDay(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

const bump = (scope: string, period: string, metric: string, by: number) =>
  db.usage.upsert({
    where: { tenantId_month_metric: { tenantId: scope, month: period, metric } },
    create: { tenantId: scope, month: period, metric, count: by },
    update: { count: { increment: by } },
    select: { count: true },
  });

/** The periods a claimed place was counted in (a refund must go to the same ones, even after midnight). */
export interface ClaimedSlot {
  month: string;
  day: string;
}

export async function claimSlot(
  scope: string,
  m: SlotMetric,
  limits: { month: number; day: number },
): Promise<({ ok: true } & ClaimedSlot) | { ok: false; error: "daily" | "limit" }> {
  if (limits.month <= 0 || limits.day <= 0) return { ok: false, error: "limit" };
  const day = baghdadDay();
  const month = monthKey();
  const d = await bump(scope, day, m.day, 1);
  if (d.count > limits.day) {
    await bump(scope, day, m.day, -1);
    return { ok: false, error: "daily" };
  }
  const mo = await bump(scope, month, m.month, 1);
  if (mo.count > limits.month) {
    await bump(scope, month, m.month, -1);
    await bump(scope, day, m.day, -1);
    return { ok: false, error: "limit" };
  }
  return { ok: true, month, day };
}

/**
 * Takes up to `wanted` units of a per-day allowance (stories sent to the AI, attempts) and says how many it got.
 * Raised first and checked after, like claimSlot, so parallel runs cannot both take the same last units.
 */
export async function takeDaily(scope: string, metric: string, wanted: number, cap: number): Promise<number> {
  if (wanted <= 0 || cap <= 0) return 0;
  const day = baghdadDay();
  const after = (await bump(scope, day, metric, wanted)).count;
  const over = after - cap;
  if (over <= 0) return wanted;
  const granted = Math.max(0, wanted - over);
  await bump(scope, day, metric, -(wanted - granted));
  return granted;
}

/** Gives a place back (the picture could not be made), to the periods it was claimed in. */
export async function refundSlot(scope: string, m: SlotMetric, at?: ClaimedSlot): Promise<void> {
  await db.usage.updateMany({ where: { tenantId: scope, month: at?.month ?? monthKey(), metric: m.month, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
  await db.usage.updateMany({ where: { tenantId: scope, month: at?.day ?? baghdadDay(), metric: m.day, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

export async function slotsUsed(scope: string, m: SlotMetric): Promise<{ month: number; day: number }> {
  const [mo, d] = await Promise.all([
    db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: scope, month: monthKey(), metric: m.month } }, select: { count: true } }),
    db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: scope, month: baghdadDay(), metric: m.day } }, select: { count: true } }),
  ]);
  return { month: mo?.count ?? 0, day: d?.count ?? 0 };
}

/** The counters of AI pictures. */
export const IMAGE_SLOTS: SlotMetric = { month: "ai_image", day: "ai_image_day" };
