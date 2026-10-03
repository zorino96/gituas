import { db } from "@/lib/db";
import { nrNewsCkb, type NrNewsText } from "@/lib/i18n/nr/news.ckb";
import { NEWS_LIMITS, type Metric } from "./plans";
import { newsroomAccess } from "./trial";

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export class LimitReached extends Error {
  constructor(
    readonly metric: Metric,
    readonly limit: number,
    /** True when the newsroom's trial is over and nothing is paid — not a quota, a freeze. */
    readonly frozen = false,
  ) {
    super(`${metric} limit of ${limit} reached`);
    this.name = "LimitReached";
  }
}

type LimitText = Pick<NrNewsText["actions"], "limitDraft" | "limitImprove" | "limitPublish" | "frozen">;

/** The message for a LimitReached, in the given newsroom wording (Sorani by default). */
export function limitMessage(e: LimitReached, t: LimitText = nrNewsCkb.actions): string {
  if (e.frozen) return t.frozen;
  const byMetric: Record<Metric, (max: number) => string> = { draft: t.limitDraft, improve: t.limitImprove, publish: t.limitPublish };
  return byMetric[e.metric](e.limit);
}

/**
 * Throws LimitReached when this month's count has reached the plan's quota, when the tenant does
 * not exist, or (frozen) when a newsroom's trial is over and no paid plan is running.
 */
export async function assertWithin(tenantId: string, metric: Metric): Promise<void> {
  const [tenant, row] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, kind: true, planPaidUntil: true, trialEndsAt: true } }),
    db.usage.findUnique({ where: { tenantId_month_metric: { tenantId, month: monthKey(), metric } }, select: { count: true } }),
  ]);
  if (!tenant) throw new LimitReached(metric, 0);
  if (!newsroomAccess(tenant, new Date()).active) throw new LimitReached(metric, 0, true);
  const limit = NEWS_LIMITS[tenant.plan][metric];
  if ((row?.count ?? 0) >= limit) throw new LimitReached(metric, limit);
}

/**
 * The error to show when a newsroom is frozen (trial over, nothing paid), or null when it may still
 * write. Only the freeze: no quota is checked. Call it for every write path of a NEWS workspace —
 * publishing, scheduling, AI — not only the ones that count usage. A missing tenant reads as frozen.
 */
export async function newsroomFrozenError(tenantId: string, t: Pick<LimitText, "frozen"> = nrNewsCkb.actions): Promise<string | null> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  return tenant && newsroomAccess(tenant, new Date()).active ? null : t.frozen;
}

/** Counted after the action succeeds. Two parallel actions can pass one over the quota; that is accepted. */
export async function countUsage(tenantId: string, metric: Metric): Promise<void> {
  const month = monthKey();
  await db.usage.upsert({
    where: { tenantId_month_metric: { tenantId, month, metric } },
    create: { tenantId, month, metric, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export async function usageOf(tenantId: string, metric: Metric): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId, month: monthKey(), metric } }, select: { count: true } });
  return row?.count ?? 0;
}
