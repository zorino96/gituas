// What the calendar says about selling today in Iraqi Kurdistan: the weekday, the season and the
// occasions that are close, so the daily plan can lean on them. Pure: only the date goes in.
//
// Honest limits: this is the calendar, not a market feed. No source gives live Iraqi demand or
// competitor prices, so the plan also uses the shop's own sales and messages and the owner's notes.

export interface MarketEvent {
  id: string;
  /** English name (used in the model's facts). */
  label: string;
  /** Days from today: negative = already started. */
  daysUntil: number;
  /** "during" when today is inside the occasion. */
  phase: "before" | "during" | "after";
  /** How strongly buyers shop around it. */
  weight: "high" | "medium";
}

export interface MarketCalendar {
  /** 0 = Sunday … 6 = Saturday, in Baghdad. */
  weekday: number;
  /** The weekend in Iraq is Friday and Saturday. */
  weekend: boolean;
  dayOfMonth: number;
  season: "winter" | "spring" | "summer" | "autumn";
  events: MarketEvent[];
}

const DAY = 86_400_000;
const BAGHDAD = 3 * 3_600_000;

interface HijriDate {
  year: number;
  month: number;
  day: number;
}

/** The Umm al-Qura date of a day (Baghdad). Intl ships with Node; if it lacks the calendar the occasions are simply skipped. */
export function hijriOf(ms: number): HijriDate | null {
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Baghdad" }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value.replace(/\D/g, ""));
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return y > 1300 && m >= 1 && m <= 12 && d >= 1 && d <= 30 ? { year: y, month: m, day: d } : null;
  } catch {
    return null;
  }
}

interface Occasion {
  id: string;
  label: string;
  weight: "high" | "medium";
  /** Length in days; the occasion is "during" while inside. */
  days: number;
  hijri?: { month: number; day: number };
  fixed?: { month: number; day: number };
  /** The last Friday of November. */
  blackFriday?: boolean;
}

const OCCASIONS: Occasion[] = [
  { id: "ramadan", label: "Ramadan begins", weight: "high", days: 30, hijri: { month: 9, day: 1 } },
  { id: "eid_fitr", label: "Eid al-Fitr", weight: "high", days: 3, hijri: { month: 10, day: 1 } },
  { id: "eid_adha", label: "Eid al-Adha", weight: "high", days: 4, hijri: { month: 12, day: 10 } },
  { id: "hijri_new_year", label: "Islamic new year", weight: "medium", days: 1, hijri: { month: 1, day: 1 } },
  { id: "newroz", label: "Newroz (Kurdish new year)", weight: "high", days: 1, fixed: { month: 3, day: 21 } },
  { id: "mothers_day", label: "Mother's Day (Iraq)", weight: "high", days: 1, fixed: { month: 3, day: 21 } },
  { id: "womens_day", label: "International Women's Day", weight: "medium", days: 1, fixed: { month: 3, day: 8 } },
  { id: "valentine", label: "Valentine's Day", weight: "medium", days: 1, fixed: { month: 2, day: 14 } },
  { id: "new_year", label: "New Year", weight: "high", days: 2, fixed: { month: 12, day: 31 } },
  { id: "back_to_school", label: "Schools open", weight: "medium", days: 7, fixed: { month: 9, day: 15 } },
  { id: "black_friday", label: "Black Friday", weight: "medium", days: 1, blackFriday: true },
];

const SEASON = (month: number): MarketCalendar["season"] => (month === 12 || month <= 2 ? "winter" : month <= 5 ? "spring" : month <= 9 ? "summer" : "autumn");

/** The occasions within a window around `now`: three days back (still in the air) to forty ahead. */
export function marketCalendar(now: number, window = { back: 3, ahead: 40 }): MarketCalendar {
  const local = new Date(now + BAGHDAD);
  const weekday = local.getUTCDay();
  const events: MarketEvent[] = [];
  const startOfToday = Math.floor((now + BAGHDAD) / DAY) * DAY - BAGHDAD;

  for (let offset = -window.back - 5; offset <= window.ahead; offset++) {
    const dayStart = startOfToday + offset * DAY;
    const shifted = new Date(dayStart + BAGHDAD + 12 * 3_600_000);
    const month = shifted.getUTCMonth() + 1;
    const date = shifted.getUTCDate();
    const h = hijriOf(dayStart + 12 * 3_600_000);
    for (const o of OCCASIONS) {
      let starts = false;
      if (o.fixed) starts = o.fixed.month === month && o.fixed.day === date;
      else if (o.hijri) starts = !!h && h.month === o.hijri.month && h.day === o.hijri.day;
      else if (o.blackFriday) starts = month === 11 && shifted.getUTCDay() === 5 && date + 7 > 30;
      if (!starts) continue;
      const end = offset + o.days - 1;
      // Keep the occasion if it is still running today, or starts inside the window.
      if (end < -window.back || offset > window.ahead) continue;
      const during = offset <= 0 && end >= 0;
      events.push({ id: o.id, label: o.label, daysUntil: offset, phase: during ? "during" : offset > 0 ? "before" : "after", weight: o.weight });
    }
  }
  // Ramadan itself is a month: while it runs, the plan should know "Ramadan, day N".
  const h = hijriOf(now);
  if (h?.month === 9 && !events.some((e) => e.id === "ramadan" && e.phase === "during")) {
    events.push({ id: "ramadan", label: `Ramadan (day ${h.day})`, daysUntil: -(h.day - 1), phase: "during", weight: "high" });
  }
  events.sort((a, b) => a.daysUntil - b.daysUntil);
  return {
    weekday,
    weekend: weekday === 5 || weekday === 6,
    dayOfMonth: local.getUTCDate(),
    season: SEASON(local.getUTCMonth() + 1),
    events,
  };
}

/** One line of the calendar for a prompt. */
export function describeCalendar(c: MarketCalendar): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ev = c.events.length
    ? c.events.map((e) => (e.phase === "during" ? `${e.label} (now)` : e.phase === "before" ? `${e.label} in ${e.daysUntil} days` : `${e.label} ended ${-e.daysUntil} days ago`)).join("; ")
    : "no major occasion within six weeks";
  return `${days[c.weekday]}${c.weekend ? " (weekend)" : ""}, day ${c.dayOfMonth} of the month, ${c.season}. Occasions: ${ev}.`;
}

/** The occasions' names as the owner reads them (Sorani). */
export const OCCASION_KU: Record<string, string> = {
  ramadan: "ڕەمەزان",
  eid_fitr: "جەژنی ڕەمەزان",
  eid_adha: "جەژنی قوربان",
  hijri_new_year: "سەری ساڵی کۆچی",
  newroz: "نەورۆز",
  mothers_day: "ڕۆژی دایک",
  womens_day: "ڕۆژی ژنان",
  valentine: "ڤالێنتاین",
  new_year: "سەری ساڵ",
  back_to_school: "دەستپێکردنەوەی خوێندن",
  black_friday: "بلاک فرایدەی",
};
