// Why a store's daily video is making nothing right now, for the Auto card of the Video screen. Nothing is stored about a skipped day, so
// this is read from what the page already knows, with the same checks (and in the same order) as runVideoAutomation (src/lib/advideo/auto.ts)
// makes before it claims the day. A plain module: the page decides, the card only words it.
//
// It says something only when the daily video is on, its hour has come and none was made yet today: before that nothing is late, and
// after it the day's video is the proof that nothing held it.

export type AutoHold = "paused" | "voice" | "allowance" | "daily" | "ai";

type Tier = "LITE" | "PRO";

export function autoHold(i: {
  /** Store.videoAutoMode. */
  mode: string;
  /** Store.videoAutoTier. */
  tier: Tier;
  /** The daily video's hour has come and none was made since the shop day began (isVideoDue). */
  due: boolean;
  /** The Page's access has expired (Store.pausedReason is set): the engine takes no paused store. */
  paused: boolean;
  /** A voice exists on this server for the store's video language (Sorani needs none of Gemini's, Arabic and English do). */
  hasVoice: boolean;
  allowances: Record<Tier, { limit: number; left: number }>;
  /** Videos made today across the workspace, and the most one workspace makes in a day. */
  today: { used: number; max: number };
  /** How much of this month's AI allowance is used, 0 to 100. */
  aiPercent: number;
}): AutoHold | null {
  if ((i.mode !== "DRAFT" && i.mode !== "PUBLISH") || !i.due) return null;
  if (i.paused) return "paused";
  if (!i.hasVoice) return "voice";
  // The tier follows the plan, as the card and the engine do: a plan with Opus videos has no Haiku ones, and the others the other way round.
  const tier: Tier = i.allowances[i.tier].limit > 0 ? i.tier : i.allowances.PRO.limit > 0 ? "PRO" : "LITE";
  if (i.allowances[tier].left <= 0) return "allowance";
  if (i.today.used >= i.today.max) return "daily";
  if (i.aiPercent >= 100) return "ai";
  return null;
}
