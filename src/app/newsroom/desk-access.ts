// Whether a desk may still write: its trial or paid plan is running, or it is frozen (read-only). The same computation the desk's
// trial banner and the chat server use (newsroomAccess), read for the screens that need to say so before the first message.

import { newsroomAccess, type NewsroomAccess } from "@/lib/billing/trial";
import { db } from "@/lib/db";

/** The desk's access now, or null when the desk cannot be read. */
export async function loadDeskAccess(tenantId: string): Promise<NewsroomAccess | null> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  return tenant ? newsroomAccess(tenant, new Date()) : null;
}
