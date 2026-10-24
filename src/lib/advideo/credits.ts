// The credits of the photographs a story video shows, and the lines of the post caption that carry them. Pure and
// safe for a browser component: the Video screen, the chat tool and the server pipeline all read the same words.
//
// The photographs come from Wikimedia Commons (public domain, CC0, CC BY, CC BY-SA). A CC BY or CC BY-SA photograph needs
// its author and licence named, so the post caption says "Photos: Wikimedia Commons (Author, CC BY-SA 4.0)" and the full
// table (title, author, licence, link) is kept in the video's spec for the screen. This file never imports spec.ts.
//
// The one rule that is never bent: a photograph whose licence asks for its author to be named is not shown unless the
// caption names that author. fitCredits chooses the photographs that can be named in the room the caption has; the rest
// are dropped from the video (public domain and CC0 photographs, which need no name, are kept first).

import type { VideoLang } from "./lang";

export interface PhotoCredit {
  /** The index of the scene in spec.scenes that shows this photograph. */
  scene: number;
  /** The file on Commons, as "File:Name.jpg". */
  title: string;
  /** The photographer, as plain text (no markup); null when the page names nobody. */
  author: string | null;
  /** The licence's short name on Commons, for example "CC BY-SA 4.0" or "Public domain". */
  licence: string;
  licenceUrl: string | null;
  /** The file's page on Commons. */
  page: string;
  /** True when the licence asks for the author to be named (CC BY, CC BY-SA). */
  attribution: boolean;
  /** True when the photograph came from a search by the beat's phrase and not from the case's own article or category: it shows the kind of thing, maybe not the thing. */
  illustrative?: boolean;
}

/** The most a credit line is when the caller does not tell how much room the caption has (counted in characters, not bytes). */
export const CREDIT_LINE_MAX = 240;
/** The post caption limit of a story (the same number as STORY_LIMITS.caption). */
const CAPTION_MAX = 700;
/** The room a credit line has at least, whatever the text and the hashtags take: the text is cut short to make it. */
export const CREDIT_ROOM_MIN = 120;
/** An author's name is written whole up to this many characters (Commons' own cleaner stops at the same number). */
const AUTHOR_MAX = 60;

const PHOTOS_LABEL: Record<VideoLang, string> = {
  en: "Photos: Wikimedia Commons",
  ar: "الصور: ويكيميديا كومنز",
  ckb: "وێنەکان: ویکیمیدیا کۆمۆنز",
};

/** The short note that some photographs show the kind of thing and not the thing itself (they came from a search, not from the case's own article). */
const ILLUSTRATIVE: Record<VideoLang, string> = {
  en: "illustrative images",
  ar: "صور توضيحية",
  ckb: "وێنەی ڕوونکەرەوە",
};

const COMMA: Record<VideoLang, string> = { en: ", ", ar: "، ", ckb: "، " };

const FICTION_LINE: Record<VideoLang, string> = {
  en: "Fiction: this is an invented story.",
  ar: "قصة خيالية: هذه حكاية مؤلَّفة من الخيال.",
  ckb: "چیرۆکی خەیاڵی: ئەمە چیرۆکێکی دروستکراوە.",
};

/** The line that says a story is invented. It is added to the caption by code, never trusted to the model. */
export function fictionLine(lang: VideoLang): string {
  return FICTION_LINE[lang] ?? FICTION_LINE.en;
}

const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join("");
const len = (s: string): number => Array.from(s).length;
/** Without control and format characters (direction overrides, zero-width marks), spaces collapsed. */
const clean = (s: string): string => s.replace(/\p{Cc}/gu, " ").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
const text = (v: unknown, max: number): string => (typeof v === "string" ? cut(clean(v), max) : "");

/**
 * The credits stored in a spec (or anything that looks like them): only complete entries survive, the rest is coerced.
 * Never throws, whatever it is given; a spec written before there were credits gives an empty list.
 */
export function creditsOf(json: unknown): PhotoCredit[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { credits?: unknown }).credits)
      ? (json as { credits: unknown[] }).credits
      : [];
  const out: PhotoCredit[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.scene !== "number" || !Number.isInteger(c.scene) || c.scene < 0) continue;
    const title = text(c.title, 240);
    const page = text(c.page, 500);
    const licence = text(c.licence, 80);
    if (!title || !page || !licence) continue;
    // the author is cleaned the way a printed one is (an address, a telephone number or a sentence is dropped), whatever the licence says
    const author = creditAuthor(text(c.author, 200)) ?? "";
    const licenceUrl = text(c.licenceUrl, 500);
    out.push({
      scene: c.scene,
      title,
      author: author || null,
      licence,
      licenceUrl: /^https?:\/\//i.test(licenceUrl) ? licenceUrl : null,
      page,
      attribution: c.attribution === true,
      ...(c.illustrative === true ? { illustrative: true as const } : {}),
    });
  }
  return out;
}

/** The most words an author's name may have to be printed: a name, a group or an archive is short; a sentence is an advertisement or a note. */
const AUTHOR_WORDS_MAX = 6;

/**
 * Whether an author field from Commons (free text anyone can write) may be printed in a public post and on the video. Not when it holds
 * an e-mail address or a handle (an "@"), a telephone number (a "+" before digits, six or more digits in a row, or nine or more digits
 * with only single spaces, dots, dashes or brackets between them) or more than six words. A photograph whose licence asks for the author
 * to be named and whose author may not be printed cannot be shown at all.
 */
export function authorFits(author: string | null | undefined): boolean {
  if (typeof author !== "string") return false;
  const t = clean(author);
  if (!t) return false;
  // (an archive's own number, "Bundesarchiv, Bild 183-S12345-0001", is a name and stays: dashes alone do not make a telephone number)
  if (t.includes("@") || /\+\s*\(?\d/.test(t) || /\d{6,}/.test(t) || /\d(?:[\s.()]?\d){8,}/.test(t) || /\b\d{3,4}[-.]\d{3,4}[-.]\d{3,4}\b/.test(t) || /\(\d{2,5}\)\s*\d{3}/.test(t)) return false;
  return t.split(" ").length <= AUTHOR_WORDS_MAX;
}

/** An author as the caption shows it: no link, no hashtag sign, no line break, no hidden character, at most 60 characters; "" when the field may not be printed (see authorFits). */
function printable(author: string | null | undefined): string {
  if (!author || !authorFits(author)) return "";
  const plain = clean(
    author
      .replace(/https?:\/\/\S*/gi, " ")
      .replace(/\bwww\.\S*/gi, " ")
      .replace(/[#@\r\n]+/g, " "),
  );
  // what is left of "Name – www.example.org" after the address is gone must not end in a dash or a comma
  return cut(plain, AUTHOR_MAX).replace(/[\s,;:|/\\–—-]+$/u, "").trim();
}

/**
 * The author of a credit as it may be stored, shown in the job's list and put in a post: cleaned as the caption cleans it (see authorFits),
 * or null when it may not be printed at all (an e-mail address, a telephone number, a sentence, a bare web address). Every credit's author
 * goes through this when it is stored, whatever the licence (a public domain photograph's author is printed in the "Copy caption" text too).
 */
export function creditAuthor(author: string | null | undefined): string | null {
  return printable(author) || null;
}

/** The scripts the video's credit lines can draw: Latin, Cyrillic and Greek (Inter) and Arabic script (IBM Plex Sans Arabic), as code point ranges. */
const DRAWABLE_LETTERS: readonly (readonly [number, number])[] = [
  [0x41, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x600, 0x6ff],
  [0x750, 0x77f],
  [0x1e00, 0x1eff],
  [0x1f00, 0x1fff],
  [0xfe70, 0xfeff],
];

/**
 * Whether the closing card can draw this author's letters: Latin, Cyrillic, Greek or Arabic script (Sorani, Persian and Urdu letters too),
 * with digits, spaces and punctuation. Chinese, Japanese, Korean, Hebrew, Thai, Indic and other scripts have no font on the card (they would
 * come out as empty boxes), and an emoji is not a name: a photograph whose licence asks for that author to be named cannot be shown.
 */
export function authorDrawable(author: string | null | undefined): boolean {
  if (typeof author !== "string") return false;
  for (const ch of author) {
    if (/\p{Extended_Pictographic}/u.test(ch)) return false;
    if (!/\p{L}/u.test(ch)) continue;
    const cp = ch.codePointAt(0) ?? 0;
    if (!DRAWABLE_LETTERS.some(([lo, hi]) => cp >= lo && cp <= hi)) return false;
  }
  return true;
}

/** An author as the caption and the card print it: cleaned (see creditAuthor), and "" when the card cannot draw its letters. */
function authorName(author: string | null): string {
  const n = printable(author);
  return n && authorDrawable(n) ? n : "";
}

/** A credit that needs its author named (its licence asks for it) and has no usable name cannot be shown at all. */
function nameable(c: PhotoCredit): boolean {
  return !c.attribution || authorName(c.author) !== "";
}

interface CreditEntry {
  name: string;
  licences: string[];
}

/** The authors the licences ask to be named, one entry per author (case-insensitive) with all the licences of that author's photographs. */
function authorsOf(credits: PhotoCredit[]): CreditEntry[] {
  const byAuthor = new Map<string, CreditEntry>();
  for (const c of credits) {
    if (!c.attribution) continue;
    const name = authorName(c.author);
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = byAuthor.get(key) ?? { name, licences: [] };
    if (c.licence && !entry.licences.includes(c.licence)) entry.licences.push(c.licence);
    byAuthor.set(key, entry);
  }
  return [...byAuthor.values()];
}

/** One author with the licences of the photographs: "Name, CC BY-SA 4.0 / CC BY 2.0". */
const entryText = (e: CreditEntry): string => `${e.name}, ${e.licences.join(" / ")}`;

/** The authors the licences ask to be named, one entry per author (case-insensitive) with all the licences of that author's photographs: "Name, CC BY-SA 4.0 / CC BY 2.0". */
function entriesOf(credits: PhotoCredit[]): string[] {
  return authorsOf(credits).map(entryText);
}

/**
 * The photo-credit line of the caption: "Photos: Wikimedia Commons" in the video's language, then (only when some photograph came
 * from a search and not from the case's own pictures) a short "illustrative images", then in brackets every author the licences ask
 * to be named ("Name, CC BY-SA 4.0; Other, CC BY 2.0"). The same author appears once. No link is written (the full table with
 * every link is in the spec). The line is never cut and never says "and others": it names all of them, so the caller chooses the
 * photographs that fit the room with fitCredits first. An empty string when there are no credits.
 */
export function creditLine(lang: VideoLang, credits: PhotoCredit[]): string {
  if (!credits.length) return "";
  const names = entriesOf(credits).join("; ");
  const head = headOf(lang, credits);
  return names ? `${head} (${names})` : head;
}

/** "Photos: Wikimedia Commons" in the video's language, with the short note when some photograph only shows the kind of thing. */
function headOf(lang: VideoLang, credits: PhotoCredit[]): string {
  const label = PHOTOS_LABEL[lang] ?? PHOTOS_LABEL.en;
  return credits.some((c) => c.illustrative === true) ? `${label}${COMMA[lang] ?? ", "}${ILLUSTRATIVE[lang] ?? ILLUSTRATIVE.en}` : label;
}

/** The shape of the frame a story is drawn on; a story is vertical (9:16) unless it was asked wide (16:9, for YouTube). */
export type PhotoFormat = "vertical" | "wide";

/** About how many characters a credit line holds on the video: a vertical frame is narrow, a wide one has room. The renderer shrinks a line that is a little longer. */
export const SCREEN_LINE_CHARS: Record<PhotoFormat, number> = { vertical: 44, wide: 78 };
/** The credit block on the closing scene: the "Photos: Wikimedia Commons" line and at most two lines of authors. */
export const SCREEN_LINES_MAX = 3;
const SCREEN_SEPARATOR = " · ";

export interface CreditScreen {
  /** The lines to draw on the closing scene (at most three). Empty when there are no credits. */
  lines: string[];
  /** Every author that has to be named fits in those lines. */
  complete: boolean;
}

/**
 * The credits as the video itself shows them, on its closing scene: first "Photos: Wikimedia Commons" (and "illustrative images" when some
 * photograph only shows the kind of thing), then the authors the licences ask to be named with their licences ("Name, CC BY-SA 4.0"),
 * packed into at most two lines of about `SCREEN_LINE_CHARS` characters. `complete` is false when the authors do not fit: the caller
 * chooses fewer photographs (fitCredits with a format) so that no photograph is shown without its author named on the screen too.
 */
export function creditScreen(lang: VideoLang, credits: PhotoCredit[], format: PhotoFormat = "vertical"): CreditScreen {
  if (!credits.length) return { lines: [], complete: true };
  const head = headOf(lang, credits);
  const width = SCREEN_LINE_CHARS[format] ?? SCREEN_LINE_CHARS.vertical;
  const body: string[] = [];
  let cur = "";
  let tooLong = false;
  for (const author of authorsOf(credits)) {
    const entry = entryText(author);
    if (len(entry) <= width) {
      const trial = cur ? `${cur}${SCREEN_SEPARATOR}${entry}` : entry;
      if (cur && len(trial) > width) {
        body.push(cur);
        cur = entry;
      } else {
        cur = trial;
      }
      continue;
    }
    // An entry that is wider than a line gets lines of its own, wrapped at the spaces of the NAME: it never runs on from the entry before
    // it (that one ends its line, so the separator is not lost into the middle of a word), and a licence is one piece ("CC BY-SA 4.0"
    // is never split) that keeps its place after the name's last word.
    if (cur) body.push(cur);
    cur = "";
    const words = author.name.split(" ");
    const pieces = [...words.slice(0, -1), `${words[words.length - 1]},`, ...author.licences.map((l, i) => (i ? `/ ${l}` : l))];
    for (const piece of pieces) {
      if (len(piece) > width * 1.3) tooLong = true;
      const trial = cur ? `${cur} ${piece}` : piece;
      if (cur && len(trial) > width) {
        body.push(cur);
        cur = piece;
      } else {
        cur = trial;
      }
    }
    if (cur) body.push(cur);
    cur = "";
  }
  if (cur) body.push(cur);
  const lines = [head, ...body].slice(0, SCREEN_LINES_MAX);
  return { lines, complete: !tooLong && body.length <= SCREEN_LINES_MAX - 1 && len(head) <= width * 1.3 };
}

/**
 * The photographs that can be shown in a caption with `room` characters for the credit line: no photograph whose author the line
 * would not name. Public domain and CC0 photographs (nothing to name) come first and are all kept; the photographs that need a name
 * follow in the order of the story, each kept while the line still fits, and a photograph by an author who is already named costs
 * nothing. A photograph that needs a name and has none is never kept. The answer keeps the order of `credits`.
 */
export function fitCredits(lang: VideoLang, credits: PhotoCredit[], room: number = CREDIT_LINE_MAX, screen?: PhotoFormat): PhotoCredit[] {
  const usable = credits.filter(nameable);
  const kept = new Set<PhotoCredit>(usable.filter((c) => !c.attribution));
  // With a `screen` format the authors must also fit the video's own credit lines (creditScreen): a photograph is never shown
  // without its author named on the picture as well as in the post.
  const fits = (set: Set<PhotoCredit>): boolean => len(creditLine(lang, [...set])) <= room && (!screen || creditScreen(lang, [...set], screen).complete);
  // the photographs that need a name: in order, while the line fits; a second pass takes the ones that became free because their author is in by now
  const waiting = usable.filter((c) => c.attribution);
  for (let pass = 0; pass < 2; pass++) {
    for (const c of waiting) {
      if (kept.has(c)) continue;
      const trial = new Set(kept).add(c);
      if (fits(trial)) kept.add(c);
    }
  }
  return credits.filter((c) => kept.has(c));
}

/** Splits a caption into its text and the run of #hashtags that ends it. */
function splitCaption(caption: string): { body: string; tags: string[] } {
  const parts = caption.trimEnd().split(/(\s+)/);
  const tags: string[] = [];
  let i = parts.length - 1;
  while (i >= 0) {
    const part = parts[i];
    if (/^\s*$/.test(part)) {
      i--;
      continue;
    }
    if (part.length > 1 && part.startsWith("#")) {
      tags.unshift(part);
      i--;
      continue;
    }
    break;
  }
  return { body: parts.slice(0, i + 1).join("").trimEnd(), tags };
}

/**
 * How many characters the lines added to a caption (the credit line) can have: what is left of `max` after the caption's text, its
 * hashtags and the blank lines between them, and at least 120 (the text is cut short to make room when it is needed). `taken` is the
 * length of other lines that are added as well (the fiction line and its line break).
 */
export function creditRoom(caption: string, max: number = CAPTION_MAX, taken: number = 0): number {
  const { body, tags } = splitCaption(caption);
  const tagText = tags.join(" ");
  const spare = max - len(body) - len(tagText) - (body ? 2 : 0) - (tagText ? 2 : 0) - taken;
  return Math.max(CREDIT_ROOM_MIN, spare);
}

export interface StoryCaptionInput {
  /** The caption the writer gave (or the stored one). */
  caption: string;
  lang: VideoLang;
  /** The photographs' credits: a "Photos: Wikimedia Commons" line is added when there are any. They should have been through fitCredits. */
  credits?: PhotoCredit[];
  /** The story is invented: a line that says so is added. */
  fiction?: boolean;
  /** The most characters the whole caption may be; 700 is a story's limit. */
  max?: number;
}

/**
 * The post caption of a story with its lines added: the teaser, a blank line, the fiction line (an invented story) and the
 * photo-credit line (real photographs), a blank line, and the hashtags last. Counted in characters, the whole is at most
 * `max`: a text that is too long is cut at a word and ends in an ellipsis, and only when the added lines and the hashtags
 * alone are too long are whole hashtags dropped from the end (a hashtag is never cut in half). The credit line itself is never
 * cut: it names every author. With nothing to add the caption is returned as it is.
 */
export function storyCaption({ caption, lang, credits = [], fiction = false, max = CAPTION_MAX }: StoryCaptionInput): string {
  const lines = [fiction ? fictionLine(lang) : "", creditLine(lang, credits)].filter(Boolean);
  if (!lines.length) return caption;
  const extra = lines.join("\n");
  const { body, tags } = splitCaption(caption);
  const assemble = (t: string, tg: string[]): string => [t, extra, tg.join(" ")].filter(Boolean).join("\n\n");

  // Only when the added lines and the hashtags alone are too long are hashtags dropped, whole ones, from the end.
  let kept = tags;
  while (kept.length && len(assemble("", kept)) > max) kept = kept.slice(0, -1);
  const whole = assemble(body, kept);
  if (len(whole) <= max) return whole;
  // What is left for the text, less the blank line before it; at least one character and the ellipsis must fit.
  const room = max - len(assemble("", kept)) - 2;
  if (room < 2) return assemble("", kept);

  // Cut the text at a word, leaving one character for the ellipsis.
  const chars = Array.from(body);
  const raw = chars.slice(0, room - 1).join("");
  const atWordEnd = /\s/.test(chars[room - 1] ?? " ");
  const lastBreak = raw.search(/\s\S*$/);
  const base = (atWordEnd || lastBreak <= 0 ? raw : raw.slice(0, lastBreak)).trimEnd().replace(/[,;:\-–—]+$/, "");
  return assemble(`${base}…`, kept);
}
