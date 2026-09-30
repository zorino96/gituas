// Rules for posts scheduled for later. Pure, so the server action, the cron
// route and the composer agree on them.

/** TikTok's audited Direct Post flow needs the person present, so it is never scheduled. */
export const SCHEDULE_NO_TIKTOK = "بۆ تیکتۆک خشتەکردن نییە — ڕاستەوخۆ بڵاوی بکەرەوە.";
export const SCHEDULE_TOO_SOON = "کاتەکە دەبێت لانیکەم ١٠ خولەک دوای ئێستا بێت.";
export const SCHEDULE_TOO_FAR = "کاتەکە دەبێت لە ماوەی ٦٠ ڕۆژدا بێت.";
export const SCHEDULE_BAD_TIME = "کاتەکە دروست نییە.";

const MINUTE = 60_000;
const DAY = 86_400_000;
export const MIN_LEAD_MS = 10 * MINUTE;
export const MAX_LEAD_MS = 60 * DAY;

/** Why this post cannot be scheduled, in Sorani, or null when it can. */
export function scheduleProblem(targets: string[], runAt: Date, now: Date): string | null {
  if (targets.includes("TT")) return SCHEDULE_NO_TIKTOK;
  if (Number.isNaN(runAt.getTime())) return SCHEDULE_BAD_TIME;
  if (runAt.getTime() < now.getTime() + MIN_LEAD_MS) return SCHEDULE_TOO_SOON;
  if (runAt.getTime() > now.getTime() + MAX_LEAD_MS) return SCHEDULE_TOO_FAR;
  return null;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * A `datetime-local` value ("YYYY-MM-DDTHH:mm") read as Asia/Baghdad time
 * (UTC+3, no daylight saving) and returned as the UTC instant.
 * Malformed or impossible input (month 13, 31 February) gives an Invalid Date.
 */
export function baghdadLocalToUtc(local: string): Date {
  const m = LOCAL.exec(local);
  if (!m) return new Date(NaN);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d, h - 3, mi));
  // Date.UTC rolls impossible dates over; a real wall-clock time reads back the same.
  const back = new Date(utc.getTime() + 3 * 60 * MINUTE);
  const same =
    back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && back.getUTCHours() === h && back.getUTCMinutes() === mi;
  return same ? utc : new Date(NaN);
}
