// Rules for posts scheduled for later. Pure, so the server action, the cron
// route and the composer agree on them.

import { ckb, type Dict } from "@/lib/i18n/ckb";

type ScheduleText = Pick<Dict["actions"]["publish"], "noTiktokSchedule" | "tooSoon" | "tooFar" | "badTime">;

/** TikTok's audited Direct Post flow needs the person present, so it is never scheduled. */
export const SCHEDULE_NO_TIKTOK = ckb.actions.publish.noTiktokSchedule;

const MINUTE = 60_000;
const DAY = 86_400_000;
export const MIN_LEAD_MS = 10 * MINUTE;
export const MAX_LEAD_MS = 60 * DAY;

/** Why this post cannot be scheduled, in the given wording (Sorani by default), or null when it can. */
export function scheduleProblem(targets: string[], runAt: Date, now: Date, t: ScheduleText = ckb.actions.publish): string | null {
  if (targets.includes("TT")) return t.noTiktokSchedule;
  if (Number.isNaN(runAt.getTime())) return t.badTime;
  if (runAt.getTime() < now.getTime() + MIN_LEAD_MS) return t.tooSoon;
  if (runAt.getTime() > now.getTime() + MAX_LEAD_MS) return t.tooFar;
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
