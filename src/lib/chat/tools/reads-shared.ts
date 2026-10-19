// What every read tool shares: how text, dates and money are cut down for the MODEL, and how a live platform call is kept inside the
// request's deadline. Pure: nothing here touches the database or the network, so it is tested without mocks.
//
// Two audiences read a tool's result. The model gets `data`: short, no phone numbers, no street addresses, no emails, at most 25
// items. The person gets `view`: their own data in full (they own it). These helpers are for the first kind.

import { exponentOf } from "@/lib/shop/money";
import { foldForMatch, stripInvisible } from "../guard";

/** Free text the model reads (names, notes, comments, messages) is cut to this many characters. */
export const MODEL_TEXT_MAX = 300;
/** The most items of one list the model reads. */
export const MODEL_ITEMS_MAX = 25;
/** The longest piece of customer text shown to the person in a card. */
export const VIEW_TEXT_MAX = 500;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Baghdad has no daylight saving time: it is UTC+3 all year. */
const BAGHDAD_OFFSET_MS = 3 * HOUR;

/** Whitespace folded, cut to `max` characters (counted as people count them, not as UTF-16 units) with an ellipsis. */
export function clip(text: string | null | undefined, max: number): string {
  const chars = Array.from((text ?? "").replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join("")}…` : chars.join("");
}

// The text is matched in a folded copy (see substitute), by the same folding the output cleaner uses (guard.ts: foldForMatch):
// compatibility forms folded and digits ASCII whatever script the buyer wrote them in.
//
// What counts as a phone number: eight digits or more in a run, with up to five separators between two digits, or a slash (spaces
// around it allowed) or a comma (no space) between them. A separator is a space, a dot, a bracket, a dash of ANY kind (hyphen, en and
// em dash, non-breaking hyphen, minus sign), a middle dot or bullet, an underscore, an asterisk, or a zero-width (non-)joiner (guard.ts
// keeps those in text because Arabic script is written with them). The bare comma may be the Arabic comma too. The run may touch
// letters ("shop07501234567"). It does not start inside a longer number. Dates ("2026-10-19", "19/10/2026", with any dash) are left
// alone, and so is anything shorter (a price, a size). A comma with a space after it ("38, 39, 40, 41") is a list, not part of a
// number, and a time range ("10:30 - 12:45") has no separator the run can cross. Written with code point escapes so that no unusual
// character is typed into this file.
const SEP_CHARS = String.raw`\s().\p{Pd}\u{2212}\u{b7}\u{2022}\u{2027}\u{2219}\u{22c5}\u{30fb}_*\u{200c}\u{200d}`;
const SEPARATOR = String.raw`(?:[${SEP_CHARS}]{0,5}|\s{0,3}\/\s{0,3}|[,\u{60c}])`;
const DATE_SEP = String.raw`[\p{Pd}\u{2212}/._]`;
const DATE_START = String.raw`(?!(?:19|20)\d{2}${DATE_SEP}\d{1,2}${DATE_SEP}\d{1,2}(?!\d)|\d{1,2}${DATE_SEP}\d{1,2}${DATE_SEP}(?:19|20)\d{2}(?!\d))`;
const PHONE = new RegExp(String.raw`(?<![0-9])${DATE_START}\+?[0-9](?:${SEPARATOR}[0-9]){7,}`, "gu");
// Letters and digits of any script, as in the output cleaner: "ahmedé@example.com" is an address too.
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** 25,000,000 or 1,250,000.50 (the comma may be the Arabic one): a price written with thousands separators, not a number to call. */
const GROUPED_PRICE = /^\+?\d{1,3}(?:[,\u{60c}]\d{3})+(?:\.\d{1,2})?$/u;

/**
 * Cuts every match of `re` out of `text`, finding them in the folded copy of the text (same length, so a match is cut out of the
 * original at the same place). What `replace` returns stands in for the match: the original piece to keep it, or a marker.
 */
function substitute(text: string, re: RegExp, replace: (original: string, folded: string) => string): string {
  const folded = foldForMatch(text);
  let out = "";
  let last = 0;
  for (const m of folded.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    out += text.slice(last, start) + replace(text.slice(start, end), m[0]);
    last = end;
  }
  return out + text.slice(last);
}

/**
 * A customer's text with phone numbers and email addresses taken out. Buyers paste their number into a comment or a note, and the
 * model has no need of it: the person sees the full text on their own screen. Hidden characters go first (a zero-width space or a
 * bidirectional mark between two digit groups is the cheapest way to hide a number), and digits written in any script count.
 */
export function scrubContacts(text: string): string {
  const visible = stripInvisible(text);
  const withoutEmail = substitute(visible, EMAIL, () => "[email]");
  return substitute(withoutEmail, PHONE, (original, found) => (GROUPED_PRICE.test(found) ? original : "[number]"));
}

/** Customer-written (or customer-influenced) text as the model reads it: no contacts, folded, cut to `max`. */
export function modelText(text: string | null | undefined, max = MODEL_TEXT_MAX): string {
  return clip(scrubContacts(text ?? ""), max);
}

/** A moment in Baghdad time as ISO 8601 with its +03:00 offset ("2026-10-19T14:30:00+03:00"), or null when it is not a date. */
export function baghdadIso(value: Date | string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms + BAGHDAD_OFFSET_MS).toISOString().slice(0, 19)}+03:00`;
}

/** The instant today began in Baghdad. */
export function startOfBaghdadDay(now: number): number {
  return Math.floor((now + BAGHDAD_OFFSET_MS) / DAY) * DAY - BAGHDAD_OFFSET_MS;
}

/**
 * A date the model wrote ("2026-10-01", or a full ISO time) as an instant. A bare date means the start of that day in Baghdad.
 * Anything else is null, so the tool can refuse it and the model can correct itself.
 */
export function parseSince(text: string): Date | null {
  const t = text.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/.exec(t);
  if (!m) return null;
  // A day that does not exist (30 February) is not rolled over into the next month: it is refused.
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  // A bare date is the start of that day in Baghdad. A time without a zone is Baghdad time too: the server's own zone (UTC on Vercel)
  // is never used. A time with Z or an offset keeps the one it was given.
  const rest = m[4];
  const hasZone = rest !== undefined && /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(rest);
  const d = new Date(rest === undefined ? `${t}T00:00:00+03:00` : hasZone ? t : `${t}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Money as a plain number in the currency's main unit: 25000 for 25,000 IQD, 12.5 for 12.50 USD. */
export function majorUnits(minor: number, currency: string): number {
  return minor / 10 ** exponentOf(currency);
}

/** An object without its empty fields (undefined, null, ""): the model reads fewer tokens. false and 0 stay, they mean something. */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Every distinct value counted: ["a","b","a"] gives { a: 2, b: 1 }. */
export function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** How much of a list the model was given: the true total, how many items follow, and whether any were left out. */
export function counts(total: number, shown: number): { total: number; shown: number; truncated: boolean } {
  return { total, shown, truncated: total > shown };
}

/** At most `max` items of a list for the model. */
export function cap<T>(items: readonly T[], max = MODEL_ITEMS_MAX): T[] {
  return items.slice(0, max);
}

/**
 * Text wrapped in directional isolates so digits, plus signs and Latin letters (a phone number, a Latin name) keep their order
 * inside right-to-left text.
 */
export function isolateLtr(text: string): string {
  // Built from code points (left-to-right isolate, pop directional isolate) so that no invisible character is written into the source.
  return text ? `${String.fromCodePoint(0x2066)}${text}${String.fromCodePoint(0x2069)}` : "";
}

export type Live<T> = { ok: true; value: T } | { ok: false; reason: "no_time" | "timeout" | "failed" };

/**
 * Runs a live platform read (Meta, Google) only if it can still finish before the request's deadline, and stops waiting at the
 * deadline. The call itself cannot be cancelled, but its answer is dropped. A failure is a value, never a throw: the tool tells the
 * person what happened instead of ending the turn.
 */
export async function withinDeadline<T>(
  deadline: number,
  fn: () => Promise<T>,
  opts: { minMs?: number; marginMs?: number; now?: () => number } = {},
): Promise<Live<T>> {
  const now = opts.now ?? Date.now;
  const left = deadline - now() - (opts.marginMs ?? 500);
  if (left < (opts.minMs ?? 2_500)) return { ok: false, reason: "no_time" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ ok: false; reason: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), left);
  });
  const work = Promise.resolve()
    .then(fn)
    .then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const, reason: "failed" as const }),
    );
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
