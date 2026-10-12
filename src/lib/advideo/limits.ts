import { db } from "@/lib/db";
import { monthKey } from "@/lib/billing/limits";
import type { StorePlan } from "@/lib/shop/plans";

/** LITE: the script is written by Claude Haiku. PRO: Claude Opus 5.5 art-directs it. */
export type VideoTier = "LITE" | "PRO";
export const VIDEO_TIERS: readonly VideoTier[] = ["LITE", "PRO"];

/** Videos a store may make per month, by its plan. Each one costs a model call and about five voice lines. */
export const VIDEO_LIMITS: Record<StorePlan, Record<VideoTier, number>> = {
  FREE: { LITE: 2, PRO: 0 },
  MERCHANT: { LITE: 30, PRO: 4 },
  PRO: { LITE: 60, PRO: 20 },
};

export function isVideoTier(v: unknown): v is VideoTier {
  return v === "LITE" || v === "PRO";
}

// Usage rows are keyed by a plain id string; a store id (a cuid) cannot collide with a tenant id.
const metric = (tier: VideoTier) => `advideo_${tier.toLowerCase()}`;

export async function videosUsed(storeId: string, tier: VideoTier): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: storeId, month: monthKey(), metric: metric(tier) } }, select: { count: true } });
  return row?.count ?? 0;
}

/** +1 when a video is created, -1 when one that never came out is given back. */
export async function countVideo(storeId: string, tier: VideoTier, delta: 1 | -1 = 1): Promise<void> {
  const month = monthKey();
  if (delta === -1) {
    await db.usage.updateMany({ where: { tenantId: storeId, month, metric: metric(tier), count: { gt: 0 } }, data: { count: { decrement: 1 } } });
    return;
  }
  await db.usage.upsert({
    where: { tenantId_month_metric: { tenantId: storeId, month, metric: metric(tier) } },
    create: { tenantId: storeId, month, metric: metric(tier), count: 1 },
    update: { count: { increment: 1 } },
  });
}

export interface Allowance {
  limit: number;
  used: number;
  left: number;
}

export function allowance(plan: StorePlan, tier: VideoTier, used: number): Allowance {
  const limit = VIDEO_LIMITS[plan][tier];
  return { limit, used, left: Math.max(0, limit - used) };
}
