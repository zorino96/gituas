// The number-grounding guard for advice. When the assistant advises ("how do I sell more"), every number it writes as a fact must come
// from somewhere real: this turn's tool results, the account snapshot, or the owner's own words in the thread. A number the model made
// up ("expect 40 percent more orders", "spend 100,000 IQD") is cut out before the owner reads it.
//
// Pure: strings in, strings out. The loop collects the allowed text (tool results, the account snapshot and the owner's words, never the
// system prompt) and calls guardAdviceDetailed on the closing message.
//
// What counts as "a number to ground" is decided here, in one place:
//   - a figure written with separators is read the way a person reads it: "25,000" and "1 250 000" are one figure each, "20,21,22" (a
//     compact list in the data) is three, "2.5" is a decimal (and, as the buyer-reply guard always did, also "25");
//   - "09" is 9, and 0 to 3 are free ("one thing", "two or three ideas", "0 orders");
//   - a clock time is its hour ("21:00" must be an hour the data has; the minutes are not a figure);
//   - a calendar date the assistant writes ("21 October", "2026-10-21", with or without a time) is not a figure: the assistant is allowed
//     to work out "tomorrow" from the date it knows. A bare year is a figure unless the data holds a date of that year;
//   - a phone-like figure, a list marker ("1." at the start of a line) and a product code that the data itself holds ("ABC-12345-XL") are
//     not figures to ground. A code the data does not hold is read like any other text.

import { foldForMatch } from "./guard";

/** 0 to 3 stay free (after leading zeros are dropped). */
const FREE_NUMBER = /^[0-3]$/;

/** A list marker at the start of a line: "4." "10)" "- 5." (up to two digits, then a dot or bracket, then a space). */
const LIST_MARKER = /^[ \t]*(?:[-*•]\s+)?[0-9]{1,2}[.)]\s+/gmu;

/** A long identifier made of letters and digits only (a cuid, a message id): its digits are not facts. */
const ID_LIKE = /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{18,}\b/g;

/** A product or reference code: letters and digits joined by hyphens or underscores ("ABC-12345-XL-RED-2024", "A4-size"). */
const CODE_LIKE = /(?<![\p{L}\p{N}_-])(?=[\p{L}\p{N}_-]*\p{N})(?=[\p{L}\p{N}_-]*\p{L})[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+(?![\p{L}\p{N}_-])/gu;

/** A figure's digits without leading zeros: "09" is "9", "007" is "7", "0" stays. */
const norm = (digits: string): string => digits.replace(/^0+(?=\d)/, "");

/** What a piece of text means as figures: alternatives, each a list of numbers that must ALL be grounded for that reading to hold. */
type Reading = string[];
type Token = Reading[];

// ---- dates ------------------------------------------------------------------------------------------------------------

// Alif with or without hamza are written both ways; "آب" (August) keeps its madda, or it would also read the word for "father".
const alif = (s: string): string => s.replace(/[اأإ]/g, "[اأإ]");
const MONTHS_EN = "[Jj]an(?:uary)?|[Ff]eb(?:ruary)?|[Mm]ar(?:ch)?|[Aa]pr(?:il)?|May|[Jj]un(?:e)?|[Jj]ul(?:y)?|[Aa]ug(?:ust)?|[Ss]ep(?:t(?:ember)?)?|[Oo]ct(?:ober)?|[Nn]ov(?:ember)?|[Dd]ec(?:ember)?";
const MONTHS_AR = [
  "كانون الثاني", "كانون الثانى", "كانون الأول", "شباط", "آذار", "اذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "تشرين الثانى",
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يونيه", "يوليو", "يوليه", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
const MONTHS_CKB = [
  "کانوونی دووەم", "کانوونی یەکەم", "شوبات", "ئازار", "نیسان", "ئایار", "حوزەیران", "تەمموز", "ئاب", "ئەیلوول", "تشرینی یەکەم", "تشرینی دووەم",
  "یەنایەر", "فێبرایەر", "فێبروەری", "مارس", "ئەپریل", "مایۆ", "یۆنیۆ", "یۆلیۆ", "ئۆگۆست", "سێپتەمبەر", "ئۆکتۆبەر", "نۆڤەمبەر", "دیسەمبەر",
  "خاکەلێوە", "گوڵان", "جۆزەردان", "پووشپەڕ", "گەلاوێژ", "خەرمانان", "ڕەزبەر", "گەڵاڕێزان", "سەرماوەز", "بەفرانبار", "ڕێبەندان",
];
const MONTH = `(?:${[MONTHS_EN, ...[...MONTHS_AR, ...MONTHS_CKB].map((m) => alif(m).replace(/ /g, String.raw`\s+`))].join("|")})`;
const DAY = String.raw`(0?[1-9]|[12]\d|3[01])`;
const YEAR = String.raw`(20\d{2})`;
const CLOCK = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?`;
/** What stands in a text for a date that was taken out. */
const DATE_MARK = String.fromCodePoint(0xe000);

/** "21 October", "21st of October 2026" */
const DATE_DM = new RegExp(String.raw`(?<![\d.,/:])${DAY}(?:st|nd|rd|th|ی)?\s*(?:of\s+)?${MONTH}(?![\p{L}])(?:\s*,?\s*${YEAR}(?!\d))?`, "gu");
/** "October 21", "Oct. 21, 2026" */
const DATE_MD = new RegExp(String.raw`${MONTH}(?![\p{L}])\.?\s*${DAY}(?:st|nd|rd|th)?(?!\d)(?:\s*,?\s*${YEAR}(?!\d))?`, "gu");
/** "October 2026" */
const DATE_MY = new RegExp(String.raw`${MONTH}(?![\p{L}])\.?\s*,?\s*${YEAR}(?!\d)`, "gu");
/** 2026-10-21, 2026-10-21T18:45:00Z, 2026-10-21 18:45 */
const DATE_ISO = /(?<![\d.])\d{4}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?!\d)/g;
/** 21/10/2026, 21.10.2026, 2026/10/21 */
const DATE_NUM = new RegExp(
  String.raw`(?<![\d.,/])(?:${DAY}[/.](0?[1-9]|1[0-2])[/.]${YEAR}|${YEAR}[/.](0?[1-9]|1[0-2])[/.]${DAY})(?![\d/])`,
  "g",
);
/** A clock time next to a date that was taken out belongs to it: "21 October at 18:45", "18:45 on 21 October". */
const TIME_BEFORE_DATE = new RegExp(String.raw`${CLOCK}\s*(?:on|,|،|-|–|—|في|يوم|لە|ڕۆژی)?\s*${DATE_MARK}`, "gu");
const TIME_AFTER_DATE = new RegExp(String.raw`${DATE_MARK}\s*(?:at|,|،|@|-|–|—|T|الساعة|ساعة|في|لە کاتژمێر|کاتژمێر|لە)?\s*${CLOCK}`, "gu");

/** The text without its calendar dates; `year` hears each year they named. */
function withoutDates(text: string, year?: (y: string) => void): string {
  const take = (m: string): string => {
    if (year) for (const y of m.match(/20\d{2}/g) ?? []) year(y);
    return DATE_MARK;
  };
  let out = text;
  for (const re of [DATE_ISO, DATE_NUM, DATE_DM, DATE_MD, DATE_MY]) out = out.replace(re, take);
  return out.replace(TIME_BEFORE_DATE, DATE_MARK).replace(TIME_AFTER_DATE, DATE_MARK).split(DATE_MARK).join(" ");
}

// ---- phone-like figures --------------------------------------------------------------------------------------------------

// At most 24 characters (a phone number written with spaces and brackets is never longer): a long run of numbers separated by spaces is not
// searched again from every digit.
const PHONE_CANDIDATE = /(?<![\d.,])\+?\d[\d \u{a0}().-]{6,24}\d(?!\d)/gu;

/** A phone number or an identifier: +964 750 123 4567, 0750 123 4567, 07501234567, any run of 10 digits or more. */
function phoneLike(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (/^\d+$/.test(candidate)) return digits.length >= 10;
  if (candidate.startsWith("+") || digits.startsWith("00")) return digits.length >= 8;
  return digits.startsWith("0") && digits.length >= 9 && digits.length <= 15;
}

const withoutPhones = (text: string): string => text.replace(PHONE_CANDIDATE, (m) => (phoneLike(m.trim()) ? " " : m));

// ---- reading figures -----------------------------------------------------------------------------------------------------

const SEPARATORS = /[,.٫٬،]/;
const THOUSANDS = new Set([",", ".", "٬"]);
const DECIMALS = new Set([".", "٫"]);

/** Whether the groups of a run are a thousands grouping: 1 to 3 digits (no leading zero), then groups of exactly three. */
const groupedThousands = (groups: string[], sep: string): boolean =>
  THOUSANDS.has(sep) && groups.length > 1 && (groups[0] ?? "").length <= 3 && !(groups[0] ?? "").startsWith("0") && groups.slice(1).every((g) => g.length === 3);

/** 2.50 → "2.5", 0.75 → "0.75", 12.000 → "12". */
function decimalOf(whole: string, fraction: string): string {
  const f = fraction.replace(/0+$/, "");
  return f ? `${norm(whole)}.${f}` : norm(whole);
}

/**
 * One run of digits with separators between them. `answer` is the side that must decide ("is this figure grounded?"): there a
 * thousands grouping is a thousands grouping and nothing else (so an invented "25,000" is not saved by an unrelated 25). The side that
 * collects what is allowed keeps every reasonable reading, because "[5,100]" in the data may be a list or 5100.
 */
function readRun(run: string, answer: boolean): Token {
  const groups = run.split(SEPARATORS);
  if (groups.length === 1) return [[norm(run)]];
  const seps = run.match(/[,.٫٬،]/g) ?? [];
  const sep0 = seps[0] ?? ",";
  const merged = (gs: string[]): string => norm(gs.join(""));
  const parts = groups.map(norm);

  if (seps.every((s) => s === sep0) && groupedThousands(groups, sep0)) {
    if (answer) return [[merged(groups)]];
    const readings: Token = [[merged(groups)], parts];
    if (groups.length === 2 && DECIMALS.has(sep0)) readings.push([decimalOf(groups[0] ?? "", groups[1] ?? "")]);
    return readings;
  }

  // "1,250.50" and "1.250,50": thousands, then a decimal part after the other separator.
  const head = groups.slice(0, -1);
  const headSeps = seps.slice(0, -1);
  const last = seps[seps.length - 1];
  const headSep = headSeps[0] ?? ",";
  if (headSeps.length && headSeps.every((s) => s === headSep) && groupedThousands(head, headSep) && last !== headSep && (last === "." || last === "," || last === "٫")) {
    return [[decimalOf(merged(head), groups[groups.length - 1] ?? "")]];
  }

  if (groups.length === 2) {
    const decimal = decimalOf(groups[0] ?? "", groups[1] ?? "");
    // "2.5" is also "25", as the buyer-reply guard (shop/smart.ts) has always read it; "20,21" is also two figures.
    return DECIMALS.has(sep0) ? [[decimal], [norm(groups.join(""))]] : [parts, [decimal]];
  }
  return [parts];
}

/** "1 250 000": thousands written with spaces (also no-break and thin spaces). */
const SPACED_THOUSANDS = /(?<![\d.,٫٬،])\d{1,3}(?:[ \u{a0}\u{202f}\u{2009}]\d{3})+(?![\d]|[.,٫٬،]\d)/gu;
const DIGIT_RUN = /\d+(?:[,.٫٬،]\d+)*/g;
/** "21:00", "9:30", "6:30 PM" (the hour is the figure; a 12-hour clock may mean 24-hour data) and "9 PM". */
const CLOCK_TIME = /(?<![\d:.])([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])(?:\s*([AaPp])\.?[Mm]\.?(?![\p{L}]))?/gu;
const HOUR_WORD = /(?<![\d:.,])(1[0-2]|0?[1-9])\s*([AaPp])\.?[Mm]\.?(?![\p{L}])/gu;

const hourToken = (hour: string, meridiem: string | undefined): Token => {
  const h = Number(hour);
  if (meridiem && /[Pp]/.test(meridiem) && h < 12) return [[String(h)], [String(h + 12)]];
  if (meridiem && /[Aa]/.test(meridiem) && h === 12) return [["0"]];
  return [[String(h)]];
};

/** The text with each match of `re` replaced by spaces of the same length (so positions stay), each match handed to `on`. */
function takeAll(text: string, re: RegExp, on: (m: RegExpMatchArray, at: number) => void): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    on(m, at);
    out += text.slice(last, at) + " ".repeat(m[0].length);
    last = at + m[0].length;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** Every figure of a text, in the order they are written, as alternatives of readings. `text` is already folded; `answer` says which side is asking. */
function tokensOf(text: string, answer: boolean): Token[] {
  const found: { at: number; token: Token }[] = [];
  const add = (at: number, token: Token) => void found.push({ at, token });
  // One pass per kind of figure; each pass takes its pieces out of the text and leaves spaces.
  let rest = takeAll(text, CLOCK_TIME, (m, at) => add(at, hourToken(m[1], m[2])));
  rest = takeAll(rest, HOUR_WORD, (m, at) => add(at, hourToken(m[1], m[2])));
  rest = takeAll(rest, SPACED_THOUSANDS, (m, at) => {
    const groups = m[0].split(/[ \u{a0}\u{202f}\u{2009}]/u);
    const mergedReading = [norm(groups.join(""))];
    add(at, answer ? [mergedReading] : [mergedReading, groups.map(norm)]);
  });
  takeAll(rest, DIGIT_RUN, (m, at) => add(at, readRun(m[0], answer)));
  return found.sort((a, b) => a.at - b.at).map((f) => f.token);
}

// ---- the allowed side --------------------------------------------------------------------------------------------------------

interface Allowed {
  numbers: Set<string>;
  /** Product codes the data holds, lower case. */
  codes: Set<string>;
}

function allowedInfo(allowedText: string): Allowed {
  const numbers = new Set<string>();
  const codes = new Set<string>();
  // Dates first (the year of one is a figure the answer may use), then the codes and ids whose digits are not facts (a code itself may
  // be quoted, see `ungrounded`), then phone numbers.
  let text = withoutDates(foldForMatch(allowedText), (y) => numbers.add(y));
  text = text.replace(CODE_LIKE, (m) => {
    codes.add(m.toLowerCase());
    return " ";
  });
  text = withoutPhones(text.replace(ID_LIKE, " "));
  for (const token of tokensOf(text, false)) for (const reading of token) for (const n of reading) numbers.add(n);
  return { numbers, codes };
}

/** The set of numbers an allowed text holds (digits without leading zeros; a decimal as "2.5"). */
export function allowedSet(allowedText: string): Set<string> {
  return allowedInfo(allowedText).numbers;
}

/** The numbers of `answer` that are not free and not in the allowed set, in order, without repeats. */
export function ungroundedNumbers(answer: string, allowedText: string): string[] {
  return ungrounded(answer, allowedInfo(allowedText));
}

function ungrounded(answer: string, allowed: Allowed): string[] {
  let body = withoutDates(foldForMatch(answer).replace(LIST_MARKER, ""));
  // A code the data holds may be quoted; a code it does not hold is read like any other text.
  body = withoutPhones(body.replace(CODE_LIKE, (m) => (allowed.codes.has(m.toLowerCase()) ? " " : m)));
  const grounded = (n: string): boolean => FREE_NUMBER.test(n) || allowed.numbers.has(n);
  const out: string[] = [];
  for (const token of tokensOf(body, true)) {
    if (token.some((reading) => reading.every(grounded))) continue;
    // The first reading is the one a person would give for it.
    for (const n of token[0]) if (!grounded(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export interface AdviceGuard {
  /** What the owner reads. */
  text: string;
  /** Something was cut (or the fallback was used). */
  cut: boolean;
  /** The sentences that were dropped, for the audit line (never shown to the owner). */
  dropped: string[];
}

/** A sentence ends at . ! ? or the Arabic question mark when white space follows; a line break always ends one. */
const SPLIT = /((?<=[.!?؟])[ \t]+|\n+)/u;

/** Enough letters left to be an answer at all. */
const MIN_LETTERS = 8;

/**
 * The answer without the sentences that hold a number outside the allowed set. When nothing of use is left, the fallback (a fixed
 * sentence in the person's language, chosen by the caller) takes its place.
 */
export function guardAdviceDetailed(answer: string, allowedText: string, fallback: string): AdviceGuard {
  const allowed = allowedInfo(allowedText);
  if (!ungrounded(answer, allowed).length) return { text: answer, cut: false, dropped: [] };

  // The pieces alternate: sentence, separator, sentence, separator ... A dropped sentence takes the separator after it along.
  const parts = answer.split(SPLIT);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] ?? "";
    const separator = parts[i + 1] ?? "";
    if (sentence.trim() && ungrounded(sentence, allowed).length) {
      dropped.push(sentence.trim());
      continue;
    }
    kept.push(sentence, separator);
  }
  const text = kept
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < MIN_LETTERS) return { text: fallback, cut: true, dropped };
  return { text, cut: true, dropped };
}

/**
 * The advice the owner may read: sentences with numbers nobody gave are dropped; if nothing is left, `fallback`.
 * (guardAdviceDetailed says what was cut, for the audit line.)
 */
export function guardAdvice(answer: string, allowedText: string, fallback: string): string {
  return guardAdviceDetailed(answer, allowedText, fallback).text;
}
