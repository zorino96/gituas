// The desk as the model sees it at the start of a turn: its brand and settings and what its plan allows and has used (counts only: no
// story text, no comment or message, no token, nothing about payments). What the desk has in its inbox is for the read tools.

import { imageEnabled } from "@/lib/ai/image";
import { loadNewsAssistantState } from "@/lib/assistant/state-news";
import { newsroomAccess } from "@/lib/billing/trial";
import { NEWS_LIMITS, type Plan } from "@/lib/billing/plans";
import { usageOf } from "@/lib/billing/limits";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import type { Actor } from "./confirm";
import type { Snapshot } from "./loop";

export async function snapshotForNews(actor: Actor): Promise<Snapshot> {
  const t = dict(actor.lang);
  const tenant = await db.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true, kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  const topics: Record<string, string> = t.nr.news.topics;
  const sections = { ...topics, breaking: t.assistant.news.fields.breaking };
  const state = await loadNewsAssistantState(actor.tenantId, { desk: tenant?.name ?? "", sections });
  const access = tenant ? newsroomAccess(tenant, new Date()) : { active: false, reason: "frozen" as const, daysLeft: null };
  const plan = (tenant?.plan ?? "MANUAL") as Plan;
  const limits = NEWS_LIMITS[plan] ?? NEWS_LIMITS.MANUAL;
  const [draft, improve, publish, video] = await Promise.all([usageOf(actor.tenantId, "draft"), usageOf(actor.tenantId, "improve"), usageOf(actor.tenantId, "publish"), usageOf(actor.tenantId, "video")]);
  return {
    state: {
      ...state,
      plan,
      access: { mayWrite: access.active, reason: access.reason, trialDaysLeft: access.daysLeft },
      usageThisMonth: { drafts: `${draft}/${limits.draft}`, improvements: `${improve}/${limits.improve}`, publishes: `${publish}/${limits.publish}`, videos: `${video}/${limits.video}` },
    },
    uiNames: { ...t.nr.shell.nav.items },
    features: { max: false, video: limits.video > 0, pictures: imageEnabled() },
  };
}
