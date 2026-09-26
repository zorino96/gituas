import { db } from "@/lib/db";
import { NEWS_LIMITS, type Metric } from "./plans";

export function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export class LimitReached extends Error {
  constructor(
    readonly metric: Metric,
    readonly limit: number,
  ) {
    super(`${metric} limit of ${limit} reached`);
    this.name = "LimitReached";
  }
}

const LABEL: Record<Metric, string> = { draft: "ئامادەکردنی هەواڵ", improve: "باشترکردن", publish: "بڵاوکردنەوە" };

export function limitMessage(e: LimitReached): string {
  return `سنووری ${LABEL[e.metric]}ی ئەم مانگە (${new Intl.NumberFormat("ar-IQ").format(e.limit)}) تەواو بوو. بۆ زیاتر، پاکێجەکەت بەرز بکەرەوە.`;
}

/** Throws LimitReached when this month's count has reached the plan's quota, or when the tenant does not exist. */
export async function assertWithin(tenantId: string, metric: Metric): Promise<void> {
  const [tenant, row] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }),
    db.usage.findUnique({ where: { tenantId_month_metric: { tenantId, month: monthKey(), metric } }, select: { count: true } }),
  ]);
  if (!tenant) throw new LimitReached(metric, 0);
  const limit = NEWS_LIMITS[tenant.plan][metric];
  if ((row?.count ?? 0) >= limit) throw new LimitReached(metric, limit);
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
