"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { MANUAL_MS, refreshAiAudience } from "@/lib/orders/ai-audience";
import { currentWorkspace } from "../data";

/** Read the buyers' recent messages again now (at most once a day per shop). */
export async function refreshAudienceAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (ws.kind !== "MERCHANT" || !can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const last = await db.audienceInsight.findUnique({ where: { tenantId: ws.id }, select: { updatedAt: true } });
  if (last && Date.now() - last.updatedAt.getTime() < MANUAL_MS) return { ok: false, error: t.orders.boost.ai.onceADay };
  const r = await refreshAiAudience(ws.id);
  if (!r) return { ok: false, error: t.orders.boost.ai.tooFew };
  revalidatePath("/app/orders");
  return { ok: true };
}
