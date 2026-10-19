// The rules that keep a model from doing more than the person meant, and from carrying a customer's words into the world.
// Pure functions only: the loop and the confirmation endpoint call them, and the tests pin every rule.

import { SUPPORT_WHATSAPP } from "@/lib/support";
import type { Autonomy, Risk } from "./types";

export type Decision = "run" | "confirm";

/**
 * Whether a tool's change runs by itself or waits for the person's Confirm.
 *
 *   read                                 runs
 *   a turn that read customer text, or the turn after one   always waits (the words of a stranger may be steering the model)
 *   a long tool (a picture)              always waits (it needs its own 60 s request, and it costs money)
 *   outbound, standing, destructive     always waits (a message to a named person; something that acts later, unwatched; a removal)
 *   ASK                                  waits
 *   LOW                                  runs only a low-risk change
 *   ALL                                  runs low, money and public changes (the daily caps still apply)
 */
export function decide(i: { risk: Risk; autonomy: Autonomy; tainted: boolean; long?: boolean }): Decision {
  if (i.risk === "read") return "run";
  if (i.tainted || i.long) return "confirm";
  if (i.risk === "outbound" || i.risk === "standing" || i.risk === "destructive") return "confirm";
  if (i.autonomy === "LOW") return i.risk === "low" ? "run" : "confirm";
  if (i.autonomy === "ALL") return "run";
  return "confirm";
}

/** Control characters, zero-width and bidirectional-override characters: nothing a person types on purpose in a caption. */
// Built from code points so that no invisible character is ever written into this source file.
const INVISIBLE_RANGES: [number, number][] = [[0, 8], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x180e, 0x180e], [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2060], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const unicodeEscape = (n: number) => `${String.fromCharCode(92)}u${n.toString(16).padStart(4, "0")}`;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => (a === b ? unicodeEscape(a) : `${unicodeEscape(a)}-${unicodeEscape(b)}`)).join("")}]`, "g");

export const stripInvisible = (s: string): string => s.replace(INVISIBLE, "");

/** Arabic-Indic and Persian digits as ASCII digits, one character for one (so positions stay the same). */
export const toWesternDigits = (s: string): string =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));

/** Links that may stay in text we write: WhatsApp support and our own site. */
const OURS = new RegExp(`^https://(wa\\.me/${SUPPORT_WHATSAPP}(\\?\\S*)?|(www\\.)?gituas\\.com(/\\S*)?)$`, "i");
/** Punctuation that ends a sentence, and so is not part of the link before it. */
const TRAILING = /[.,;:!?؟،؛…"'”»)\]]+$/;

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`«»\[\]()]+/gi;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const TLDS =
  "com|net|org|iq|krd|io|me|app|co|info|tv|shop|store|link|ly|ai|dev|xyz|site|online|top|click|ru|cn|tk|ml|ga|cf|gq|to|cc|ws|biz|us|uk|de|fr|in|pk|ir|tr|ae|sa|eg|lb|sy|gl|gd|by|page|live|club|vip|work|world|digital|website|space|fun|icu|cyou|win|bid|loan|men|stream|download|zip|mov";
const DOMAIN_RE = new RegExp(String.raw`(?<![A-Za-z0-9@/.-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:${TLDS})\b(?:/[^\s<>"'«»]*)?`, "giu");
const HANDLE_RE = /(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_.]{2,}/gu;
/** A run of digits with up to three separators of any kind between them (spaces, dots, dashes, slashes, commas, brackets). */
const PHONE_RE = /(?<![0-9])[+(]?[0-9](?:[^\p{L}\p{N}]{0,3}[0-9]){6,}(?![0-9])/gu;
/** 2026-10-19, 19/10/2026, 2026-10-19 19:00: a date is not a phone number. */
/** 1,500,000 or 1.500.000.000: digits in groups of three. */
const GROUPED_AMOUNT = /^\d{1,3}(?:[,.]\d{3}){2,}$/;
/** 08:00 - 20:00 and 9:30: opening hours are not phone numbers. */
const TIME_RANGE = /^\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})*$/;
const DATE_LIKE = /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/;

/**
 * A text as it is compared, with the SAME length as the text itself so that a match can be cut out of the original: compatibility
 * forms folded when that keeps the length (full-width letters and digits) and digits as ASCII.
 */
export function foldForMatch(s: string): string {
  const n = s.normalize("NFKC");
  return toWesternDigits(n.length === s.length ? n : s);
}

/** What the person typed themselves (and facts about their own shop): the only source of a link, number or handle in public text. */
export function ownerCorpus(texts: string[], extra: string[] = []): string {
  return foldForMatch(stripInvisible([...texts, ...extra].join("\n"))).toLowerCase();
}

const digitsOnly = (s: string) => toWesternDigits(s).replace(/\D/g, "");

/** Replaces every match of `re` (found in the folded copy) in the original text by whatever `replace` says. */
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
 * Free text that a buyer or the public will read, with every link, e-mail address, phone number, @handle and domain removed unless
 * the person typed it themselves (it is in `corpus`) or it is ours. A customer's message that smuggles "call 0750…" or "see
 * evil.example" into what the model writes can then not reach a post or a reply. The rest of the text is left exactly as it was
 * (its own digits and letters included); whitespace left by a removal is folded.
 */
export function cleanOutbound(text: string, corpus: string, opts: { keepAmounts?: boolean } = {}): string {
  // Hidden characters out, and the usual disguises of a dot ("[.]", "(dot)") turned back into one so that the domain is seen.
  let t = stripInvisible(text).replace(/\s*[\[(]\s*(?:\.|dot)\s*[\])]\s*/gi, ".");
  const typed = (piece: string) => corpus.includes(foldForMatch(piece).toLowerCase());
  t = substitute(t, URL_RE, (orig, found) => {
    const tail = TRAILING.exec(found)?.[0] ?? "";
    const url = tail ? found.slice(0, -tail.length) : found;
    return OURS.test(url) || typed(url) ? orig : orig.slice(orig.length - tail.length);
  });
  t = substitute(t, EMAIL_RE, (orig) => (typed(orig) ? orig : ""));
  t = substitute(t, DOMAIN_RE, (orig) => (typed(orig) ? orig : ""));
  t = substitute(t, HANDLE_RE, (orig) => (typed(orig) ? orig : ""));
  const corpusDigits = digitsOnly(corpus);
  t = substitute(t, PHONE_RE, (orig, found) => {
    const d = digitsOnly(found);
    if (corpusDigits.includes(d) || DATE_LIKE.test(found.trim()) || TIME_RANGE.test(found.trim())) return orig;
    // A news desk writes big sums ("1,500,000,000 IQD"): a grouped amount that is not phone-shaped (no leading 0 or +, not 964...) stays.
    if (opts.keepAmounts && GROUPED_AMOUNT.test(found.trim()) && !/^[+0]/.test(found.trim()) && !d.startsWith("964")) return orig;
    // A number with a leading 0 or + and at least 7 digits, or any run of 10 digits or more, is a phone number; a price such as
    // 1,250,000 (7 digits, no leading zero) is not.
    return d.length >= 10 || (d.length >= 7 && /^[+(]?\s*(?:\+|0)/.test(found.trim())) ? "" : orig;
  });
  return t
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Words the owner does not know. Gituas keeps a Facebook Page and an Instagram account together in a "shop"; a Sorani answer that says
 * "شاپ" (also written "شۆپ") means that group, and the owner reads it as something he never connected. It is said as "گروپ" (group), which
 * is what it is. A word the model is told not to use still slips out of a long chat that already holds it, so it is changed here for good.
 */
export const ownerWords = (text: string): string => text.replace(/ش[اۆ]پ/g, "گروپ");

/** The model's words to the person: invisible characters out, every link out except ours, cut to a sane length. */
export function cleanAnswer(text: string, max = 3_000): string {
  return ownerWords(stripInvisible(text))
    .replace(URL_RE, (found) => {
      const tail = TRAILING.exec(found)?.[0] ?? "";
      const url = tail ? found.slice(0, -tail.length) : found;
      return OURS.test(url) ? found : tail;
    })
    .replace(/^\[tools:[^\n]*\]\s*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** A thread's title from the first thing the person said: one line, no links, short. */
export function titleFrom(text: string): string {
  const line = cleanAnswer(text.replace(/\s+/g, " "), 200).slice(0, 60).trim();
  return line || "…";
}
