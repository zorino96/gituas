// One way of writing a message, so that the owner's words and the buyer's words meet.
//
// Buyers in Kurdistan write Sorani, Badini, Arabic and Kurdish in Latin letters, on keyboards that lack half the letters
// (a Sorani price question typed with Arabic letters, a Latin "cende" typed as "chende"). The same fold is applied to the
// owner's keyword and to the buyer's text, so a spelling difference is erased on both sides and over-matching stays symmetric
// and tiny.
//
// What the fold does, in order:
//   1. NFKC (presentation forms, full-width letters and digits become ordinary ones);
//   2. hidden characters out: tatweel, zero-width and bidi marks, soft hyphen;
//   3. the Arabic-script skeleton: one letter for the shapes keyboards confuse (yeh, kaf, heh, hamza seats, the Kurdish-only
//      letters rolled r, dark l, o, v, e and the borrowed peh, tcheh, jeh, gaf), hamza itself dropped;
//   4. digits of every script become 0-9;
//   5. Latin: lower case, accents off (c-cedilla, s-cedilla, e/i/u-circumflex), ch/sh/kh/gh to c/s/x/x;
//   6. punctuation (including the Arabic question mark and comma) becomes a space; every emoji stands alone as a token;
//   7. a letter written several times in a row is written once ("zaaanyari");
//   8. the Arabic article at the start of a long word is dropped, so the article form and the bare form are one word.
// It never uses \b: that anchor does not exist for Arabic script.
//
// Dialects are NOT bridged: "chende" and "chanda" differ by a vowel, "zanyari" and "zaniari" by a letter. The owner lists
// the variants (the preview shows them); the fold only removes what a keyboard changes.
//
// This file is written with \u{...} escapes (never the 4-digit form, never a literal invisible character) on purpose.

/** Invisible characters that are noise: tatweel, soft hyphen, ALM, ZWSP/ZWNJ/ZWJ/LRM/RLM, bidi controls, word joiners, BOM. */
const HIDDEN = /[\u{640}\u{AD}\u{61C}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/gu;

/** Letters (by code point) that an Arabic-script keyboard writes differently: every key maps to its skeleton letter, null drops it. */
const SKELETON = new Map<string, string>();
function group(to: number | null, from: readonly number[]): void {
  for (const code of from) SKELETON.set(String.fromCodePoint(code), to === null ? "" : String.fromCodePoint(to));
}
// ARABIC YEH, ALEF MAKSURA, E (06D0), KURDISH E with small v (06CE), YEH BARREE -> FARSI YEH (06CC)
group(0x06cc, [0x064a, 0x0649, 0x06d0, 0x06ce, 0x06d2]);
// HAMZA on its own, and HAMZA on a yeh seat (the Kurdish glottal stop): dropped
group(null, [0x0621, 0x0626]);
// WAW with hamza, Kurdish o (06C6), u (06C7) -> WAW
group(0x0648, [0x0624, 0x06c6, 0x06c7]);
// ALEF with hamza above/below, with madda, alef wasla -> ALEF
group(0x0627, [0x0623, 0x0625, 0x0622, 0x0671]);
// KAF (Arabic), KEHEH-like (06AA), GAF -> KEHEH (06A9)
group(0x06a9, [0x0643, 0x06aa, 0x06af]);
// HEH, TEH MARBUTA, HEH with yeh above, HEH DOACHASHMEE, HEH GOAL, Kurdish AE (06D5) -> HEH
group(0x0647, [0x0629, 0x06c0, 0x06be, 0x06c1, 0x06d5]);
// Kurdish rolled r (0695), reh with small tah (0693) -> REH
group(0x0631, [0x0695, 0x0693]);
// Kurdish dark l (06B5) -> LAM
group(0x0644, [0x06b5]);
// Kurdish v (06A4) and a variant -> FEH
group(0x0641, [0x06a4, 0x06a8]);
// PEH -> BEH, TCHEH -> JEEM, JEH -> ZAIN
group(0x0628, [0x067e]);
group(0x062c, [0x0686]);
group(0x0632, [0x0698]);

const SKELETON_RE = new RegExp(`[${[...SKELETON.keys()].join("")}]`, "gu");

const EASTERN_DIGITS = /[\u{660}-\u{669}\u{6F0}-\u{6F9}]/gu;
function asciiDigit(ch: string): string {
  const code = ch.codePointAt(0) ?? 0x30;
  return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
}

/** Digits of every script written as 0-9 (and nothing else changed). */
export function asciiDigits(s: string): string {
  return s.replace(EASTERN_DIGITS, asciiDigit);
}

/** Longest input looked at: a comment or a message is short, and a megabyte of text must not cost a megabyte of regex. */
const MAX_FOLDED_INPUT = 5_000;

/** The folded form of a text: letters of one skeleton, digits as 0-9, single spaces between tokens, every emoji its own token. */
export function fold(input: string): string {
  let s = input.slice(0, MAX_FOLDED_INPUT).normalize("NFKC").replace(HIDDEN, "");
  s = asciiDigits(s.replace(SKELETON_RE, (ch) => SKELETON.get(ch) ?? ch));
  // Lower case and accents off (this also removes harakat and the other combining marks, which are marks in Unicode).
  s = s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\u{131}/gu, "i");
  // 5,000 is 5000; an apostrophe inside a word joins it ("don't" is "dont").
  s = s.replace(/(?<=\d)[,\u{66C}](?=\d{3}(?!\d))/gu, "").replace(/['\u{2019}\u{2BC}\u{2BB}`\u{B4}]/gu, "");
  s = s.replace(/ch/g, "c").replace(/sh/g, "s").replace(/kh/g, "x").replace(/gh/g, "x");
  s = s.replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, " ").replace(/\p{Extended_Pictographic}/gu, " $& ");
  s = s.replace(/(\p{L})\1+/gu, "$1");
  return s.split(/\s+/).filter(Boolean).map(withoutArticle).join(" ");
}

/** ALEF + LAM at the start of a word that keeps at least three letters without it (the Arabic "al-"): "التوصيل" is "توصيل". */
function withoutArticle(token: string): string {
  return token.length >= 5 && token.startsWith("\u{627}\u{644}") ? token.slice(2) : token;
}

/** The tokens of an already folded text. */
export function tokens(folded: string): string[] {
  return folded ? folded.split(" ") : [];
}

const EMOJI = /^\p{Extended_Pictographic}$/u;
/** True for a token that is a single emoji. */
export const isEmojiToken = (token: string): boolean => EMOJI.test(token);

/** How many letters and digits a folded text has (spaces and emoji are not counted): the "skeleton length" of a keyword. */
export function skeletonLength(folded: string): number {
  let n = 0;
  for (const ch of folded) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

/** Which scripts a text is written in, and whether it has letters that only Kurdish uses. */
export function scriptsOf(text: string): { arabic: boolean; latin: boolean; kurdishLetters: boolean } {
  return {
    arabic: /[\u{600}-\u{6FF}\u{750}-\u{77F}]/u.test(text),
    latin: /[A-Za-z\u{C0}-\u{24F}]/u.test(text),
    kurdishLetters: /[\u{6CE}\u{6C6}\u{695}\u{6B5}\u{6A4}\u{6D5}\u{67E}\u{686}\u{698}\u{6AF}]/u.test(text),
  };
}
