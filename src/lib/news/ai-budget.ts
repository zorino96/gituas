// Hawalnoos is not on the shop's allowance meter: its AI work is bounded here, by what each plan is priced for.
// Everything is counted per desk per Baghdad day (or month) in `Usage` with the same raise-then-check counters the
// shop's pictures use (src/lib/ai/slots.ts), so nothing an outsider, a feed or a loop does can run up an unbounded bill.

import { newsroomAccess } from "@/lib/billing/trial";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { takeDaily, type SlotMetric } from "@/lib/ai/slots";

/**
 * Stories a desk may have read by the AI in one day, by the plan it pays for: labelling the category first and,
 * with a news prompt, judging it second. Stories past the number stay unlabelled and are still shown.
 * (About $0.0003 a story to label, about twice that with the prompt.)
 */
export const NEWS_ITEMS_PER_DAY: Record<string, number> = { LITE: 400, MANUAL: 1200, AUTO: 2500, ENTERPRISE: 5000 };
/** A trial desk has paid nothing yet. */
export const NEWS_TRIAL_ITEMS_PER_DAY = 300;

export type NewsItemsMetric = "news_label_day" | "news_focus_day";

/** How many of `wanted` stories the AI may read for this desk today (0 for a desk that is frozen). */
export async function newsItemsAllowed(tenantId: string, metric: NewsItemsMetric, wanted: number): Promise<number> {
  if (wanted <= 0) return 0;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  if (!t) return 0;
  const access = newsroomAccess(t, new Date());
  if (!access.active) return 0;
  const cap = access.reason === "trial" ? NEWS_TRIAL_ITEMS_PER_DAY : (NEWS_ITEMS_PER_DAY[t.plan] ?? NEWS_TRIAL_ITEMS_PER_DAY);
  try {
    return await takeDaily(tenantId, metric, wanted, cap);
  } catch {
    return 0;
  }
}

/**
 * Autopilot drafting attempts a day. A draft costs a few model calls even when it is thrown away, and only a kept
 * draft is counted against the month's quota, so attempts get their own bound: three a day for each draft the plan
 * allows a day, and never fewer than 15.
 */
export function draftTriesPerDay(plan: string): number {
  const p = (NEWS_LIMITS as Record<string, { draft: number }>)[plan] ?? NEWS_LIMITS.MANUAL;
  return Math.max(15, Math.ceil((p.draft / 30) * 3));
}

/** The editor's helper actions in the inbox and composer (a reply draft, a caption) on a newsroom desk. */
export const NEWS_ASSIST_SLOTS: SlotMetric = { month: "news_assist", day: "news_assist_day" };
export const NEWS_ASSIST_CAPS = { month: 300, day: 40 };
/** Hearing a voice before choosing it. */
export const VOICE_PREVIEW_SLOTS: SlotMetric = { month: "news_voice_preview", day: "news_voice_preview_day" };
export const VOICE_PREVIEW_CAPS = { month: 150, day: 15 };
/** A frame designed with the AI image model (about 5 to 12 cents each). */
export const FRAME_AI_SLOTS: SlotMetric = { month: "news_frame_ai", day: "news_frame_ai_day" };
export const FRAME_AI_CAPS = { month: 20, day: 6 };
/** Changing the news prompt, which has the recent stories judged again. */
export const FOCUS_RESET_SLOTS: SlotMetric = { month: "news_focus_reset", day: "news_focus_reset_day" };
export const FOCUS_RESET_CAPS = { month: 60, day: 6 };
