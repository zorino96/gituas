import { db } from "@/lib/db";
import { monthKey } from "@/lib/billing/limits";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { SHOP_LIMITS, STORE_PLANS, VIDEOS_PER_DAY, planUsesOpus, type StorePlan } from "@/lib/shop/plans";

/** LITE: the script is written by Claude Haiku. PRO: Claude Opus art-directs it (only a plan that includes Opus makes PRO videos). */
export type VideoTier = "LITE" | "PRO";
export const VIDEO_TIERS: readonly VideoTier[] = ["LITE", "PRO"];

export { VIDEOS_PER_DAY };

/**
 * Videos one store's plan brings per month. Each one costs a model call and about five voice lines
 * (the voice is the larger part of the cost). What a workspace may make is the sum over its paid
 * stores (tenantLimits); the daily limit is the ceiling for everyone. Opus is the Opus plan's alone.
 */
export const VIDEO_LIMITS = Object.fromEntries(
  STORE_PLANS.map((p) => [p, planUsesOpus(p) ? { LITE: 0, PRO: SHOP_LIMITS[p].videosPerMonth } : { LITE: SHOP_LIMITS[p].videosPerMonth, PRO: 0 }]),
) as Record<StorePlan, Record<VideoTier, number>>;

export function isVideoTier(v: unknown): v is VideoTier {
  return v === "LITE" || v === "PRO";
}

/** The tier a plan's videos are made in: Opus where the plan has videos in that tier, else Haiku. */
export function defaultTierFor(plan: StorePlan): VideoTier {
  return VIDEO_LIMITS[plan].PRO > 0 ? "PRO" : "LITE";
}

// Usage rows are keyed by a plain id string: here the workspace id.
const metric = (tier: VideoTier) => `advideo_${tier.toLowerCase()}`;
const DAY_METRIC = "advideo_day";

/** The Baghdad calendar day, YYYY-MM-DD (the `month` column holds any period key). */
export function dayKey(now = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export async function videosUsed(scope: string, tier: VideoTier): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: scope, month: monthKey(), metric: metric(tier) } }, select: { count: true } });
  return row?.count ?? 0;
}

/** Videos this workspace started today (Baghdad), of every tier. */
export async function videosToday(scope: string, now = Date.now()): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: scope, month: dayKey(now), metric: DAY_METRIC } }, select: { count: true } });
  return row?.count ?? 0;
}

const bump = (scope: string, month: string, m: string, by: number) =>
  db.usage.upsert({
    where: { tenantId_month_metric: { tenantId: scope, month, metric: m } },
    create: { tenantId: scope, month, metric: m, count: by },
    update: { count: { increment: by } },
    select: { count: true },
  });

/**
 * Takes one video's place in the day and in the month, in one step each: the counters are raised first
 * and checked afterwards, so parallel requests cannot all read "room left" and all go through. A place
 * that was over a limit is given back at once.
 */
export async function claimVideoSlot(scope: string, tier: VideoTier, limits: { month: number; day: number }): Promise<{ ok: true } | { ok: false; error: "daily" | "limit" }> {
  const day = dayKey();
  const month = monthKey();
  const d = await bump(scope, day, DAY_METRIC, 1);
  if (d.count > limits.day) {
    await bump(scope, day, DAY_METRIC, -1);
    return { ok: false, error: "daily" };
  }
  const m = await bump(scope, month, metric(tier), 1);
  if (m.count > limits.month) {
    await bump(scope, month, metric(tier), -1);
    await bump(scope, day, DAY_METRIC, -1);
    return { ok: false, error: "limit" };
  }
  return { ok: true };
}

/**
 * Gives back the place of a video that never came out (by the day and month it was counted in).
 * `keepDay`: the voice was already paid for, so the day's try stays spent (the month's place still goes back):
 * a video that fails every time can cost its voice once a day, not once a click.
 */
export async function refundVideo(scope: string, tier: VideoTier, createdAt: Date = new Date(), opts: { keepDay?: boolean } = {}): Promise<void> {
  await db.usage.updateMany({ where: { tenantId: scope, month: monthKey(createdAt), metric: metric(tier), count: { gt: 0 } }, data: { count: { decrement: 1 } } });
  if (opts.keepDay) return;
  await db.usage.updateMany({ where: { tenantId: scope, month: dayKey(createdAt.getTime()), metric: DAY_METRIC, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

export interface Allowance {
  limit: number;
  used: number;
  left: number;
}

export function allowance(limit: number, used: number): Allowance {
  return { limit, used, left: Math.max(0, limit - used) };
}

/** What a workspace may make this month and today, with what it has used. */
export async function workspaceVideos(scope: string): Promise<{ LITE: Allowance; PRO: Allowance; today: { used: number; max: number } }> {
  const [lim, lite, pro, today] = await Promise.all([limitsOf(scope), videosUsed(scope, "LITE"), videosUsed(scope, "PRO"), videosToday(scope)]);
  return { LITE: allowance(lim.videos.LITE, lite), PRO: allowance(lim.videos.PRO, pro), today: { used: today, max: lim.videosPerDay } };
}
