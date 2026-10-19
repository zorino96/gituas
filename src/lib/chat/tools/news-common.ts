// What every news-desk tool needs first: the desk the session is on is the desk the run belongs to, and a frozen desk (trial over,
// nothing paid) may only read. The existing desk actions resolve the desk from the session cookie themselves, so a person with two
// desks who switched in another tab must be refused here, before an action acts on the wrong one.

import { currentWorkspace } from "@/app/app/data";
import { newsroomFrozenError } from "@/lib/billing/limits";
import { newsroomAccess, type NewsroomAccess } from "@/lib/billing/trial";
import { db } from "@/lib/db";
import { ToolRefusal, type ToolCtx } from "../types";

/** The desk of this session, which must be the desk the tool was asked for. */
export async function deskFor(ctx: ToolCtx): Promise<{ id: string; name: string }> {
  const ws = await currentWorkspace();
  if (!ws || ws.id !== ctx.tenantId || ws.kind !== "NEWS") throw new ToolRefusal("This desk is not the one open in this session. Ask the person to reload the page.");
  return { id: ws.id, name: ws.name };
}

/** Throws a refusal for a frozen desk: writes of every kind (publish, schedule, AI, settings) wait until it has a plan again. */
export async function frozenRefusal(ctx: ToolCtx): Promise<void> {
  if (await newsroomFrozenError(ctx.tenantId)) throw new ToolRefusal("This desk's trial or plan has ended, so it can only read. Changes need a plan again.");
}

/** What the desk may do now (paid, trial with days left, legacy, or frozen). */
export async function newsAccessOf(tenantId: string): Promise<NewsroomAccess> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  return t ? newsroomAccess(t, new Date()) : { active: false, reason: "frozen", daysLeft: null };
}

/** The desk's plan (LITE, MANUAL, AUTO or ENTERPRISE). */
export async function planOf(tenantId: string): Promise<string> {
  return (await db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }))?.plan ?? "MANUAL";
}
