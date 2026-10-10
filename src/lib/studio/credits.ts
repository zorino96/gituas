// Studio credits: a monthly allowance that comes with the shop plans. One picture is one credit.
// Taken before a generation starts, given back when it fails or moderation blocks it, so a shop
// only pays for pictures it got. Counted in Usage (metric "studio") per UTC month.

import { monthKey } from "@/lib/billing/limits";
import { db } from "@/lib/db";
import type { StorePlan } from "@/lib/shop/plans";

const METRIC = "studio";

/** Credits a month per store plan. */
export const STUDIO_CREDITS: Record<StorePlan, number> = { FREE: 5, MERCHANT: 40, PRO: 150 };

/** What one generation costs, in credits. */
export const COST = { IMAGE: 1 } as const;

/**
 * A workspace's monthly credits: every paid store brings its plan's credits; a workspace with
 * only free stores gets the free allowance once (more free stores do not add more).
 */
export function monthlyCredits(plans: readonly StorePlan[]): number {
  const paid = plans.filter((p) => p !== "FREE").reduce((n, p) => n + (STUDIO_CREDITS[p] ?? 0), 0);
  return paid || (plans.length ? STUDIO_CREDITS.FREE : 0);
}

async function allowance(tenantId: string): Promise<number> {
  const stores = await db.store.findMany({ where: { tenantId }, select: { plan: true } });
  return monthlyCredits(stores.map((s) => s.plan as StorePlan));
}

const key = (tenantId: string, month: string) => ({ tenantId_month_metric: { tenantId, month, metric: METRIC } });

export async function creditsLeft(tenantId: string, now = new Date()): Promise<{ left: number; total: number }> {
  const [total, row] = await Promise.all([allowance(tenantId), db.usage.findUnique({ where: key(tenantId, monthKey(now)), select: { count: true } })]);
  return { left: Math.max(0, total - (row?.count ?? 0)), total };
}

/** Take `n` credits if that many are left. Atomic: two generations at once cannot both take the last one. */
export async function takeCredits(tenantId: string, n: number, now = new Date()): Promise<boolean> {
  const month = monthKey(now);
  const total = await allowance(tenantId);
  if (total < n) return false;
  await db.usage.upsert({ where: key(tenantId, month), create: { tenantId, month, metric: METRIC, count: 0 }, update: {} });
  const r = await db.usage.updateMany({
    where: { tenantId, month, metric: METRIC, count: { lte: total - n } },
    data: { count: { increment: n } },
  });
  return r.count === 1;
}

/** Give back credits taken in the month of `takenAt` (never below zero). */
export async function refundCredits(tenantId: string, n: number, takenAt: Date): Promise<void> {
  await db.usage.updateMany({
    where: { tenantId, month: monthKey(takenAt), metric: METRIC, count: { gte: n } },
    data: { count: { decrement: n } },
  });
}
