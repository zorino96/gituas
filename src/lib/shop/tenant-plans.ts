import { db } from "@/lib/db";
import { isStorePlan, tenantLimits, type StorePlan, type TenantLimits } from "./plans";

/** The plans of a workspace's stores (an unknown value counts as FREE). */
export async function plansOf(tenantId: string): Promise<StorePlan[]> {
  const rows = await db.store.findMany({ where: { tenantId }, select: { plan: true, planPaidUntil: true }, take: 100 });
  const now = Date.now();
  return rows.map((r) => {
    const plan = isStorePlan(r.plan) ? r.plan : "FREE";
    // The daily sweep downgrades a lapsed plan; until it runs, the allowance already follows the date.
    return plan !== "FREE" && r.planPaidUntil && r.planPaidUntil.getTime() < now ? "FREE" : plan;
  });
}

/** What the workspace may use this month: see tenantLimits. */
export async function limitsOf(tenantId: string): Promise<TenantLimits> {
  return tenantLimits(await plansOf(tenantId));
}
