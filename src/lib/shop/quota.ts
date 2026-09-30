import { db } from "@/lib/db";
import { monthKey } from "@/lib/billing/limits";

// Usage is keyed by a plain id string; a store id (a cuid) cannot collide with a tenant id.
const METRIC = "shop_ai_vary";

export async function aiVaryUsed(storeId: string): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: storeId, month: monthKey(), metric: METRIC } }, select: { count: true } });
  return row?.count ?? 0;
}

export async function countAiVary(storeId: string): Promise<void> {
  const month = monthKey();
  await db.usage.upsert({
    where: { tenantId_month_metric: { tenantId: storeId, month, metric: METRIC } },
    create: { tenantId: storeId, month, metric: METRIC, count: 1 },
    update: { count: { increment: 1 } },
  });
}
