export const TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type NewsroomAccess = {
  active: boolean;
  reason: "paid" | "trial" | "legacy" | "frozen";
  /** Whole days left (rounded up), only while reason is "trial". */
  daysLeft: number | null;
};

/**
 * Whether a workspace may still write (draft, improve, publish). Computed from dates, never
 * stored: a newsroom whose trial is over and whose paid plan is not running is frozen — it can
 * still read the news. Shops are never frozen here.
 */
export function newsroomAccess(
  t: { kind: string; plan: string; planPaidUntil: Date | null; trialEndsAt: Date | null },
  now: Date,
): NewsroomAccess {
  if (t.kind !== "NEWS") return { active: true, reason: "paid", daysLeft: null };
  if (t.planPaidUntil && t.planPaidUntil.getTime() > now.getTime()) return { active: true, reason: "paid", daysLeft: null };
  if (!t.trialEndsAt) return { active: true, reason: "legacy", daysLeft: null };
  const left = t.trialEndsAt.getTime() - now.getTime();
  if (left > 0) return { active: true, reason: "trial", daysLeft: Math.ceil(left / DAY_MS) };
  return { active: false, reason: "frozen", daysLeft: null };
}

/** When a trial that starts at `from` ends. */
export function trialEndsAtFrom(from: Date): Date {
  return new Date(from.getTime() + TRIAL_DAYS * DAY_MS);
}
