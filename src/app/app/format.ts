// Display helpers for the merchant app. Numbers are shown in Arabic-Indic digits,
// the way Kurdish and Iraqi merchants write them. Anything that produces words takes the
// dictionary as an optional last argument (client code passes `useT()`, server code
// `dict(await getLang())`) and defaults to Sorani.

import { ckb, type Dict } from "@/lib/i18n/ckb";
import { num } from "@/lib/i18n/num";

export { num };

export function ago(iso?: string, t: Dict = ckb, now: number = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return t.time.now;
  const m = Math.round(s / 60);
  if (m < 60) return t.time.minutes(m);
  const h = Math.round(m / 60);
  if (h < 24) return t.time.hours(h);
  const d = Math.round(h / 24);
  if (d < 30) return t.time.days(d);
  const date = new Date(ms);
  return t.time.dayMonth(date.getDate(), t.time.months[date.getMonth()]);
}

/** A calendar date, e.g. "٣٠ی ئەیلوول ٢٠٢٦" or "٣٠ أيلول ٢٠٢٦". Fixed to Baghdad time so server and browser agree. */
export function kuDate(iso: string | null | undefined, t: Dict = ckb): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Baghdad", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return t.time.date(get("day"), t.time.months[get("month") - 1], get("year"));
}

/** A date and time, e.g. "٣٠ی ئەیلوول ٢٠٢٦، ١٥:٣٠", in Baghdad time. */
export function kuDateTime(iso: string | null | undefined, t: Dict = ckb): string {
  const date = kuDate(iso, t);
  if (!date || !iso) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Baghdad", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const time = `${get("hour")}:${get("minute")}`.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
  return `${date}، ${time}`;
}

/** Sorani platform names. In a screen, prefer `t.platform` so the name follows the language. */
export const PLATFORM_NAME = ckb.platform;

/** Sorani TikTok audience labels. In a screen, prefer `t.privacy`. */
export const PRIVACY_LABEL: Record<string, string> = ckb.privacy;

/** Turn a raw platform error into one line a merchant can act on. */
export function friendlyError(raw: string | undefined, t: Dict = ckb): string {
  if (!raw) return t.errors.generic;
  if (/not connected|expired|reconnect|190/i.test(raw)) return t.errors.expired;
  if (/rate|limit|613|\(#4\)/i.test(raw)) return t.errors.rateLimit;
  if (/outside|24.?h|window|2018278|10\b/i.test(raw)) return t.errors.window24h;
  if (/does not exist|cannot be loaded|\(#100\)|Unsupported/i.test(raw)) return t.errors.gone;
  return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
}
