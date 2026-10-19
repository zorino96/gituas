// The growth coach's calendar: Baghdad time (UTC+3 all year, no daylight saving) and the ISO week.
//
// A weekly note belongs to one ISO week ("2026-W43", weeks start on Monday). The note is made on Sunday morning, so the week it
// is keyed to is the one that is just ending: one note per workspace per week, and the database enforces it (unique tenant + week).
// Pure: no database, no clock of its own (every function takes the time).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BAGHDAD_OFFSET_MS = 3 * HOUR;

export interface BaghdadClock {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  hour: number;
  minute: number;
}

/** The wall clock in Baghdad at this instant. */
export function baghdadClock(now: number): BaghdadClock {
  const d = new Date(now + BAGHDAD_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/**
 * The ISO week of this instant on Baghdad's calendar, like "2026-W43". The week belongs to the year that holds its Thursday, so the
 * first days of January can still be in the last week of the year before (2027-01-03 is 2026-W53).
 */
export function isoWeekKey(now: number): string {
  const c = baghdadClock(now);
  const day = Date.UTC(c.year, c.month - 1, c.day);
  const sinceMonday = (c.weekday + 6) % 7;
  const thursday = day - sinceMonday * DAY + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Sunday morning in Baghdad, from 09:00 up to (not including) 12:00: the only hours the weekly note is made. */
export const COACH_WINDOW = { weekday: 0, fromHour: 9, toHour: 12 } as const;

export function inCoachWindow(now: number): boolean {
  const c = baghdadClock(now);
  return c.weekday === COACH_WINDOW.weekday && c.hour >= COACH_WINDOW.fromHour && c.hour < COACH_WINDOW.toHour;
}

/** The 7 days before `now` and the 7 before those (rolling, not calendar weeks), as instants. */
export function weekWindows(now: number): { thisStart: number; beforeStart: number; now: number } {
  return { thisStart: now - 7 * DAY, beforeStart: now - 14 * DAY, now };
}
