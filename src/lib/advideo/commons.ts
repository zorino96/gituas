// Real photographs for a story's beats, from Wikimedia Commons (public API, no key).
//
// A story about a real case is shown over archival photographs. Where they come from, best first: (1) the pictures of the
// case's own Wikipedia article (the writer was given that article, so they are about the case by construction), (2) the
// Commons category named like the case, (3) a search by the phrases the writer gave for the beat (English first). A
// photograph is used only when it is large enough, carries a free licence whose conditions we can meet in the post (the
// author is named when the licence asks for it) and is not a map, a painting, a document, a portrait or a scene of death. It
// is fetched as a scaled JPEG (never the original), put into the frame of the video's format (the portrait frame of a reel, or the
// 1920x1080 frame of a wide story for YouTube), stored in the app's own Blob and shown by the renderer as the beat's slow backdrop. It
// is never a photograph of people in a story about a crime or a death, nor one dated long after the case (see judge). Everything fails open: a beat with no usable photograph keeps the look's own
// background, and findStoryPhotos never rejects.
//
// Wikimedia's rules, as met in practice: a User-Agent that says who is asking (no UA = HTTP 403); errors arrive as
// HTTP 200 with {error:{code}} (cirrussearch-too-busy-error, maxlag, ratelimited); 429/503 mean "stop asking"; search
// terms are AND-ed (three or more words often find nothing); a thumbnail is only served at the steps the server
// knows, so the API's thumburl is always used and never a hand-built one.
//
// Nothing here talks to the network except through the injectable `fetchImpl`, and nothing is stored except through
// the injectable `store`, so the tests never touch either.

import { del, put } from "@/lib/storage";
import sharp from "sharp";

import { authorDrawable, authorFits, creditAuthor, type PhotoCredit, type PhotoFormat } from "./credits";

/** The whole photo stage, for one video (it runs beside the voice and never extends the run). */
export const STORY_PHOTO_BUDGET_MS = 16_000;

const API = "https://commons.wikimedia.org/w/api.php";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const UA_BASE = "GituasVideoBot/1.0 (+https://gituas.com)";
/** The width asked of the API's thumbnail: enough for a 1350-wide frame, never a 20 MB original. A wide (1920x1080) frame asks for 1920, a step Wikimedia serves. */
const THUMB_WIDTH = 1280;
const WIDE_THUMB_WIDTH = 1920;
const SEARCH_LIMIT = 12;
const POOL_LIMIT = 50;
const REQUEST_MS = 5_000;
const DOWNLOAD_MS = 8_000;
const POOL_MS = 4_000;
const POOL_MIN_BUDGET_MS = 8_000;
const RETRY_MS = 700;
/** After the stage is over, in-flight work (a download, an upload) is given this long to notice and stop before the call returns. */
const SETTLE_MS = 1_500;
const CONCURRENCY = 3;
/** The most beats that are looked up (the renderer takes 6 of the owner's pictures and 10 of these). */
export const MAX_PHOTO_SCENES = 10;
const MAX_QUERIES = 4;
/** The titles of a Wikipedia article's pictures that are looked up, and how many go into one API call. */
export const MAX_ARTICLE_IMAGES = 40;
const ARTICLE_BATCH = 20;
/** An unscaled original is used as it is only up to this size; a scaled thumbnail is far smaller. */
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_BYTES = 6 * 1024 * 1024;
/** The frame every photograph is put into: the renderer has no aspect logic of its own. */
export const FRAME_W = 1350;
export const FRAME_H = 2400;
/** The frame of a story asked wide (16:9, for YouTube): the renderer's own frame size. */
export const WIDE_FRAME_W = 1920;
export const WIDE_FRAME_H = 1080;
/** A photograph with its long side under this (pixels) is drawn contained over a blurred copy in the wide frame, not covered to fill it. */
export const WIDE_SHARP_MIN = 1280;
/** The most a small photograph is enlarged in the wide frame. */
export const WIDE_ENLARGE_MAX = 1.6;

const imageinfoFor = (format: PhotoFormat): Record<string, string> => ({
  prop: "imageinfo",
  iiprop: "url|size|mime|extmetadata",
  iiurlwidth: String(format === "wide" ? WIDE_THUMB_WIDTH : THUMB_WIDTH),
  iiextmetadatafilter:
    "LicenseShortName|License|LicenseUrl|UsageTerms|AttributionRequired|Artist|ImageDescription|ObjectName|Categories|Restrictions|NonFree|DateTimeOriginal",
  iiextmetadatalanguage: "en",
});
const IMAGEINFO = imageinfoFor("vertical");

// ---- types ------------------------------------------------------------------------------------------------

export interface PhotoWanted {
  /** The index of the beat in the script's scenes. */
  scene: number;
  /** Search phrases, best first. */
  queries: string[];
}

/** Where a photograph came from: the case's own Wikipedia article, the Commons category of the case, or a search by the beat's phrase. */
export type PhotoVia = "article" | "category" | "search";

export interface FoundPhoto {
  scene: number;
  /** Our own Blob URL of the photograph (portrait frame, JPEG). */
  url: string;
  credit: PhotoCredit;
  via: PhotoVia;
}

/** Stores one file and answers its public URL. `signal` ends the upload when the stage is over. */
export type PhotoStore = (pathname: string, body: Buffer, contentType: string, signal?: AbortSignal) => Promise<string>;

export interface FindStoryPhotosInput {
  tenantId: string;
  jobId: string;
  /** The subject of the story (the article's title), for the pictures that belong to it; null = none. */
  subject: string | null;
  wanted: PhotoWanted[];
  budgetMs: number;
  /** The "File:" titles of the pictures in the case's Wikipedia article: the first and best pool of candidates. */
  articleImages?: string[];
  /** Ends the whole stage (a failed voice stops the search; nothing is uploaded after it). */
  signal?: AbortSignal;
  /** The story is about a person: photographs filed under births, deaths and "People of" are not refused. Absent = refused. */
  subjectIsPerson?: boolean;
  /** The shape of the video's frame: vertical (9:16, the default) or wide (16:9). The photographs are composed for it. */
  format?: PhotoFormat;
  /**
   * The years the story is about, earliest and latest (from the story's own text). A photograph whose own text (title, description, date)
   * names a year more than a few years after the latest is refused: it is a modern photograph, not of the case. Absent = no check.
   */
  era?: Era | null;
  /**
   * The story is about a crime or a death (or it is not known): a photograph whose text names a family, a wife, a husband, children, a
   * boy, a girl, a woman or a man is refused, because the judge reads text only and cannot tell a victim from a bystander. Absent = true.
   */
  crime?: boolean;
  /**
   * The case is recent, or may involve people who are alive (spec.subject.recent). Then no photograph that names or shows people is used
   * (the same refusal as a crime story, whatever the story is about), a birth or death category is never let through, and no search by a
   * beat's phrase is made: only the case's own pictures (its article and its Commons category) are judged. Absent = false.
   */
  recent?: boolean;
  /**
   * Called with each photograph as soon as it is stored (before the stage ends), so a caller that is cut off by its function's time limit
   * still knows which files it stored. It never throws into the finder (an error from it is ignored) and is not called after the stage has ended.
   */
  onPhoto?: (photo: FoundPhoto) => void;
  fetchImpl?: typeof fetch;
  store?: PhotoStore;
  /** Pause before the one retry of a busy answer (tests make it short). */
  retryMs?: number;
}

interface ExtValue {
  value?: unknown;
}
interface CommonsImageInfo {
  size?: number;
  width?: number;
  height?: number;
  mime?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  url?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, ExtValue | undefined>;
}
/** One page of the API's answer (formatversion 2). */
export interface CommonsPage {
  title?: string;
  index?: number;
  imageinfo?: CommonsImageInfo[];
}

/** A photograph that passed the judge. */
export interface Candidate {
  title: string;
  index: number;
  /** The API's thumbnail URL. */
  url: string;
  /** The size that is really served. */
  w: number;
  h: number;
  /** The served file is the original upload (the thumbnail would have been larger). */
  unscaled: boolean;
  credit: Omit<PhotoCredit, "scene">;
  /** Folded words of the file's title, description and categories (for the relevance guard). */
  words: Set<string>;
}

export interface Judged {
  title: string;
  /** Null = accepted. */
  why: string | null;
  licence: string | null;
  w: number;
  h: number;
  author: string | null;
  candidate: Candidate | null;
}

/** The years a story covers: `from` and `to` are 4-digit years. */
export interface Era {
  from: number;
  to: number;
}

export interface JudgeOptions {
  /** The file is one of the case's own article pictures: a smaller size is enough (an archival photograph is often 900 pixels wide). */
  lenient?: boolean;
  /** Photographs filed under births, deaths and "People of ..." are let through (the story is about a person). */
  allowPeople?: boolean;
  /** A story about a crime or a death: a file whose text names a family, a wife, children, a boy, a woman, a man ... is refused (not when `allowPeople`). */
  people?: boolean;
  /** The years of the story: a file whose text names a year later than the era's end (and the margin) is refused as modern. */
  era?: Era | null;
  /** The frame the photograph is for. A wide (16:9) frame needs a photograph that is not a thin strip (see sizeRefusal). Absent = vertical. */
  format?: PhotoFormat;
  /**
   * The case is recent or may involve people who are alive: a file that names or shows people is refused whatever the story is about, and
   * a birth, death or "People of ..." category is never let through (not even for a story about a person).
   */
  recent?: boolean;
}

// ---- text helpers -----------------------------------------------------------------------------------------

const fold = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * A text without its format and control characters: direction overrides, zero-width marks and soft hyphens hide inside names and
 * titles, and what is printed in a post must be what a person sees. Whitespace is collapsed.
 */
export function plain(s: string): string {
  return s.replace(/\p{Cc}/gu, " ").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
}

const NAMED: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
      } catch {
        return " ";
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** The visible text of a piece of HTML as the API gives it: tags gone, entities decoded, format and control characters gone, spaces collapsed. */
function htmlText(v: unknown): string {
  if (v === null || v === undefined) return "";
  const raw = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  return plain(decodeEntities(raw.replace(/<[^>]*>/g, " ")));
}

const ABBREVIATIONS = new Set(["dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr", "mt", "ft", "no"]);

/** "A A" or "AA" (a name written twice by two nested tags) is "A". */
function halved(s: string): string {
  const n = s.length;
  if (n < 6) return s;
  const h = Math.floor(n / 2);
  const a = s.slice(0, h).trim();
  const b = s.slice(h).trim();
  return a && a === b ? a : s;
}

/** The credit's author as plain text: the part before the first sentence end, at most 60 characters; null when unknown. */
export function cleanArtist(raw: unknown): string | null {
  let s = htmlText(raw);
  if (!s) return null;
  const uploader = /^original uploader was (\S+) at\b/i.exec(s);
  if (uploader) s = uploader[1];
  s = halved(s);
  // "Andreas Biegleder. According to a letter ...": the name is the first sentence ("J. R. Smith" and "Dr. Smith" are names).
  const dots = /\.\s/g;
  for (let m = dots.exec(s); m; m = dots.exec(s)) {
    const word = (s.slice(0, m.index).split(/\s+/).pop() ?? "").toLowerCase();
    if (word.length >= 3 && !ABBREVIATIONS.has(word)) {
      s = s.slice(0, m.index);
      break;
    }
  }
  s = Array.from(s.trim()).slice(0, 60).join("").trim();
  if (!s || /^(unknown|anonymous|anonym|unbekannt|not specified|nicht angegeben)/i.test(s)) return null;
  return s;
}

// ---- licence ----------------------------------------------------------------------------------------------

export interface Licence {
  ok: boolean;
  code: string;
  name: string;
  url: string | null;
  /** The licence asks for the author to be named (CC BY, CC BY-SA). */
  attribution: boolean;
}

/**
 * The licence's short name, whole and exact: public domain, CC0, CC BY x.y and CC BY-SA x.y, each with an optional two or three
 * letter jurisdiction ("CC BY-SA 3.0 de"). Anything qualified ("Public domain in the US only"), "Public Domain Mark", "Copyrighted
 * free use", GFDL, non-commercial, no-derivatives and a bare "Attribution" (no version) does not match.
 */
const LICENCE_NAME_OK = [/^public domain$/i, /^cc0(?: 1\.0)?$/i, /^cc by \d\.\d(?: [a-z]{2,3})?$/i, /^cc by-sa \d\.\d(?: [a-z]{2,3})?$/i];
/** The template behind it (License): the public domain family, CC0, and the numbered CC BY and CC BY-SA templates. */
const LICENCE_CODE_OK = /^(?:pd(?:-[a-z0-9]+)*|cc0|cc-zero|cc-by-\d\.\d(?:-(?:[a-z]{2,3}|migrated))?|cc-by-sa-\d\.\d(?:-(?:[a-z]{2,3}|migrated))?)$/i;
/**
 * Public domain templates that are not about a photograph's copyright: a text logo or a simple shape (a trademark can still be
 * protected), a seal, a flag, a typeface, and "public domain in the United States only" (the rest of the world is not covered).
 */
const PD_REFUSED = /(?:^|-)(?:textlogo|logo|shape|simple|chem|ineligible|trademark|coa|flag|seal|sign|font|us|usonly)(?:-|$)/i;

/**
 * Whether a file's licence lets the app show it with a credit: public domain, CC0, CC BY and CC BY-SA, by their exact names. The
 * public domain templates for logos and shapes, "Public domain in the US only", the Public Domain Mark, "Copyrighted free use", GFDL,
 * CC BY-NC, CC BY-ND and a bare "Attribution" are refused.
 */
export function licenceOf(md: Record<string, ExtValue | undefined> | undefined | null): Licence {
  const get = (k: string) => htmlText(md?.[k]?.value);
  const code = get("License");
  const name = get("LicenseShortName");
  const nameOk = name ? LICENCE_NAME_OK.some((r) => r.test(name)) : true;
  const codeOk = code ? LICENCE_CODE_OK.test(code) && !(/^pd/i.test(code) && PD_REFUSED.test(code)) : true;
  const ok = (!!name || !!code) && nameOk && codeOk;
  const url = get("LicenseUrl");
  const attribution = get("AttributionRequired").toLowerCase() === "true" || /^cc-by/i.test(code) || (!code && /^cc by/i.test(name));
  return { ok, code, name, url: /^https?:\/\//i.test(url) ? url : null, attribution };
}

// ---- size -------------------------------------------------------------------------------------------------

/**
 * The size of the file the thumbnail URL really serves. The API's thumbwidth is only the width that was asked for: when the
 * URL is "thumbnail_unscaled", or its Npx- step is not smaller than the original, the original upload is what comes.
 */
export function deliveredSize(ii: Pick<CommonsImageInfo, "width" | "height" | "thumburl">): { w: number; h: number; unscaled: boolean } {
  const w = Number(ii.width) || 0;
  const h = Number(ii.height) || 0;
  const url = ii.thumburl ?? "";
  const step = /(\d+)px-[^/]*$/.exec(url.split("?")[0]);
  if (!url || /thumbnail_unscaled/.test(url) || !step || Number(step[1]) >= w) return { w, h, unscaled: true };
  const tw = Number(step[1]);
  return { w: tw, h: w > 0 ? Math.round((tw * h) / w) : 0, unscaled: false };
}

// ---- relevance --------------------------------------------------------------------------------------------

const STOP = new Set([
  "the", "and", "der", "die", "das", "ein", "eine", "und", "von", "mit", "for", "from", "with", "old", "alt", "alte", "photo", "photos", "photograph",
  "photographs", "foto", "fotos", "picture", "image", "view", "historic", "historical", "archive", "archival", "vintage",
]);

const YEAR = /^(?:1\d{3}|20\d{2})$/;

interface Tok {
  /** Folded. */
  f: string;
  /** Written with a capital letter: a name. */
  proper: boolean;
}

/** The words of a phrase that count: folded, three letters or more, no stop words, no bare numbers; a year (four digits) is a word. */
function tokenList(text: string): Tok[] {
  return text
    .replace(/["']/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((raw) => ({ f: fold(raw), proper: /^\p{Lu}/u.test(raw) }))
    .filter((t) => YEAR.test(t.f) || (t.f.length >= 3 && !STOP.has(t.f) && !/^\d+$/.test(t.f)));
}

/** The words of a search phrase that count (see tokenList), folded. */
export function tokensOf(query: string): string[] {
  return tokenList(query).map((t) => t.f);
}

const wordsOf = (text: string): Set<string> => new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));

/**
 * Whether a file's own text fits a search phrase. Every word counts as a WHOLE word (no prefix, no plural: "mary" is not
 * "maryland"), and years are words ("Munich 1922" is not a street scene of 2019). A phrase of one or two words needs all of
 * them; a longer one needs every name in it (a word written with a capital letter) and every year, and when it has neither,
 * half of its words (rounded up).
 */
export function relevant(words: Set<string>, query: string): boolean {
  const toks = tokenList(query);
  if (!toks.length) return false;
  if (toks.length <= 2) return toks.every((t) => words.has(t.f));
  const must = toks.filter((t) => t.proper || YEAR.test(t.f));
  if (must.length) return must.every((t) => words.has(t.f));
  return toks.filter((t) => words.has(t.f)).length >= Math.ceil(toks.length / 2);
}

interface SubjectProfile {
  /** Every word of the subject's name (a year left out). */
  all: string[];
  /** The words of the subject's name that are names (capital letters), or all its words when it has none. */
  names: string[];
  /** The longest of them: the one word a file about the subject has to carry. */
  anchor: string;
}

function subjectProfile(subject: string | null): SubjectProfile | null {
  if (!subject) return null;
  const toks = tokenList(subject).filter((t) => !YEAR.test(t.f));
  const names = (toks.some((t) => t.proper) ? toks.filter((t) => t.proper) : toks).map((t) => t.f);
  if (!names.length) return null;
  return { all: toks.map((t) => t.f), names, anchor: [...names].sort((a, b) => b.length - a.length)[0] };
}

/** A file whose own text names the subject: its longest name and at least half of its names, as whole words. */
function aboutSubject(words: Set<string>, prof: SubjectProfile | null): boolean {
  if (!prof || !words.has(prof.anchor)) return false;
  return prof.names.filter((n) => words.has(n)).length >= Math.ceil(prof.names.length / 2);
}

// ---- the judge --------------------------------------------------------------------------------------------

/** A drawing, a map, a logo, a painting, a coin: not a photograph (the Categories field is what catches a painting). */
const DENY = new RegExp(
  "\\b(?:" +
    [
      "logos?", "icons?", "coats? of arms?", "flags?", "flagge[n]?", "maps?", "diagrams?", "charts?", "silhouettes?", "clip ?arts?", "stamps?",
      "banknotes?", "coins?", "comics?", "drawings?", "engravings?", "etchings?", "woodcuts?", "lithographs?", "lithographies", "paintings?",
      "illustrations?", "artworks?", "pd-art", "in art", "oil on canvas", "gouache", "watercolou?rs?", "aquarell\\w*", "posters?", "screenshots?",
      "newspapers?",
    ].join("|") +
    ")\\b|\\b\\w*(?:karte|zeichnung|gemalde|wappen|plakat|briefmarke)(?:n|e|en)?\\b",
);

/**
 * What a story must not show, looked for in the title, the categories AND the description: scenes of death and violence, nudity,
 * people who were accused, arrested, tried or killed, portraits, and documents (a photograph of a page, a poster, an exhibition
 * panel, a newspaper): the writer is told never to imply that a named person is guilty, and a page of text is not a picture.
 */
const SENSITIVE = new RegExp(
  "\\b(?:" +
    [
      "tatort\\w*", "crime scenes?", "corpses?", "leichen?\\w*", "autops\\w*", "dead bod(?:y|ies)", "victims?", "opfer\\w*", "ermordet\\w*", "sterbebild\\w*",
      "gore", "gory", "nude", "nudes", "naked", "porn\\w*", "portraits?", "selfies?", "mug ?shots?", "defendants?", "suspects?", "arrest\\w*", "trials?",
      "courts?", "courthouses?", "courtrooms?", "polic\\w*", "polizei\\w*", "gericht\\w*", "funerals?", "graves?", "gravestones?", "grabstein\\w*", "coffins?",
      "exhibitions?", "museum panels?", "ausstellung\\w*", "newspapers?", "newsprint", "scans?", "scanned", "manuscripts?", "documents?", "letters?",
      "nytimes", "new york times", "zeitung\\w*", "gazettes?", "clippings?", "front pages?", "headlines?", "magazines?", "periodicals?", "tabloids?",
      // remains of the dead and the places and objects that show them (a skull, a skeleton, an exhumation, a morgue, a death mask, a bust,
      // a facial reconstruction): English and German, folded ("Schädel" is "schadel", "Büste" is "buste")
      "skulls?", "skeletons?", "skeletal", "skelett\\w*", "remains", "exhum\\w*", "morgues?", "mortuar\\w*", "cadavers?", "ossuar\\w*", "bones?",
      "knochen", "gebeine", "schadel\\w*", "death masks?", "totenmaske\\w*", "busts?", "buste", "reconstruction\\w*", "rekonstruktion\\w*",
      "sarg(?:e|en)?",
    ].join("|") +
    ")\\b",
);

/**
 * People, in a story about a crime or a death: the judge reads text only and cannot tell a victim, a suspect or a bystander from a
 * place, so a file whose text names a family, a wife, a husband, children, a boy, a girl, a woman, a man, a parent, a brother or a sister
 * is not used (a photograph of a farm is). The words are whole words, in English and German (folded: "männer" is "manner").
 */
const PEOPLE = new RegExp(
  "\\b(?:" +
    [
      "famil(?:y|ies)", "familie\\w*", "wife", "wives", "husbands?", "child", "children", "kids?", "boys?", "girls?", "wom[ae]n", "m[ae]n",
      "mothers?", "fathers?", "brothers?", "sisters?", "sons?", "daughters?", "couples?", "people", "persons?", "kinder", "frau(?:en)?",
      "mann", "manner", "madchen", "bruder", "schwester", "mutter", "vater", "tochter", "sohn", "ehepaar", "einwohner",
      // groups of people: a party of hikers, a crew, passengers, students, a team, searchers, villagers (English and German)
      "groups?", "hikers?", "walkers?", "climbers?", "crews?", "passengers?", "students?", "pupils?", "members?", "teams?", "part(?:y|ies)",
      "searchers?", "rescuers?", "villagers?", "residents?", "inhabitants?", "workers?", "soldiers?", "gruppe\\w*", "wanderer\\w*", "wanderung\\w*",
      "besatzung\\w*", "passagier\\w*", "schuler\\w*", "student\\w*", "studierende\\w*", "mannschaft\\w*", "teilnehmer\\w*", "bewohner\\w*",
      "dorfbewohner\\w*", "soldat\\w*",
    ].join("|") +
    ")\\b",
);

/** For a recent case: a person named with a title or a rank (the words are folded, whole words). */
const RECENT_PERSON = new RegExp(
  "\\b(?:" + ["mr", "mrs", "ms", "miss", "dr", "prof", "professor", "sir", "lord", "lady", "president", "minister", "chancellor", "mayor", "judge", "inspector", "detective", "officer", "sergeant", "captain", "chief", "herr", "frau", "doktor"].join("|") + ")\\b",
);

/** A year as a word of a file's text, 1000 to 2099. */
const YEAR_IN_TEXT = /\b(1\d{3}|20\d{2})\b/g;
/** How many years after the story's last year a photograph may be dated and still pass (a trial, a funeral, a book a year or two later). */
const ERA_MARGIN = 5;

/** The latest year the text of a file names that is after the era (and its margin), or null. */
function modernYear(text: string, era: Era | null | undefined): number | null {
  if (!era || !Number.isFinite(era.to)) return null;
  let latest: number | null = null;
  for (const m of text.matchAll(YEAR_IN_TEXT)) {
    const y = Number(m[1]);
    if (y > era.to + ERA_MARGIN && (latest === null || y > latest)) latest = y;
  }
  return latest;
}

/**
 * The years a story covers, read from the texts of its script (on-screen words, the post text): every 4-digit year from 1000 to 2099
 * (Arabic-Indic digits too). Null when the script names none. The photograph finder uses it to refuse modern photographs.
 */
export function eraOfTexts(texts: unknown[]): Era | null {
  const western = (s: string) =>
    Array.from(s)
      .map((ch) => {
        const c = ch.charCodeAt(0);
        return c >= 0x660 && c <= 0x669 ? String(c - 0x660) : c >= 0x6f0 && c <= 0x6f9 ? String(c - 0x6f0) : ch;
      })
      .join("");
  const years: number[] = [];
  for (const t of texts) {
    if (typeof t !== "string") continue;
    for (const m of western(t).matchAll(YEAR_IN_TEXT)) years.push(Number(m[1]));
  }
  return years.length ? { from: Math.min(...years), to: Math.max(...years) } : null;
}

/** Whether a story's words (its subject, its picture phrases, its texts) are about a crime, a death or a mystery: the judge then refuses photographs of people. */
export function crimeLike(texts: unknown[]): boolean {
  const re = /\b(?:murder\w*|kill\w*|crime\w*|victims?|homicide|massacre\w*|assassin\w*|ripper|serial|unsolved|mystery|mysteries|disappear\w*|missing|death|deaths|died|dead|execut\w*|poison\w*|trial|suspects?|accus\w*|arrest\w*|stabbed|shot|hanged|body|bodies)\b/i;
  return texts.some((t) => typeof t === "string" && re.test(t));
}

/** Commons' own marks of a file whose licence is in doubt or on its way out (a category, not a promise: the file is not used). */
const LICENCE_DOUBT =
  /possible wrong licen[cs]e|wrong licen[cs]e|licen[cs]e (?:laundering|review needed|problem)|copyright (?:problem|violation)|copyvio|deletion requests?|no (?:permission|source|licen[cs]e) since/;

/** A category that files a photograph under a person: births, deaths, "People of ...", portrait photographs. */
const PERSON_CATEGORY = [
  /\b\d{3,4}s? (?:births|deaths)\b/,
  /^(?:people|persons|men|women|children) (?:of|from|by|in|who|killed)\b/,
  /^living people$/,
  /\bportrait photographs?\b/,
  /^(?:male|female) portraits?\b/,
  /\b(?:murdered|assassinated|executed) (?:people|persons|men|women|children)\b/,
];

export function isCommonsImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "upload.wikimedia.org" || u.hostname === "thumb.wikimedia.org");
  } catch {
    return false;
  }
}
export function isCommonsPageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "commons.wikimedia.org";
  } catch {
    return false;
  }
}

/** The size gates. A photograph of the case's own article may be smaller: the frame is 1350 wide, and an archival photograph is often 900. */
function sizeRefusal(size: { w: number; h: number }, lenient: boolean, format: PhotoFormat = "vertical"): string | null {
  const minSide = lenient ? 400 : 600;
  const maxSide = lenient ? 800 : 900;
  if (Math.min(size.w, size.h) < minSide || Math.max(size.w, size.h) < maxSide) return "small";
  const aspect = size.h > 0 ? size.w / size.h : 0;
  // The wide frame is 16:9: a tall photograph there is a narrow strip in the middle of a blurred copy of itself, so it needs to be less
  // thin than the vertical reel (which gives a tall photograph the whole frame) allows.
  const minAspect = format === "wide" ? (lenient ? 0.55 : 0.6) : lenient ? 0.45 : 0.5;
  if (aspect < minAspect || aspect > (lenient ? 2.4 : 2)) return "aspect";
  return null;
}

/**
 * Judges one page of the API's answer. `query` is the phrase the file was searched with: the relevance guard needs it
 * (null = no relevance check, for the pictures of the case's own article and of its category). The first reason that fails is the answer.
 */
export function judge(page: CommonsPage, query: string | null, opts: JudgeOptions = {}): Judged {
  const title = plain(String(page.title ?? ""));
  const blank: Judged = { title, why: null, licence: null, w: 0, h: 0, author: null, candidate: null };
  const ii = page.imageinfo?.[0];
  if (!ii) return { ...blank, why: "no-image" };
  const md = ii.extmetadata ?? {};
  const lic = licenceOf(md);
  const size = deliveredSize(ii);
  const rawAuthor = cleanArtist(md.Artist?.value);
  // The author that is stored and printed is the cleaned one, whatever the licence: an address, a telephone number, a sentence or a bare web
  // address is dropped (null), so a public domain photograph cannot carry one into the job's list or the "Copy caption" text either.
  const author = creditAuthor(rawAuthor);
  const out: Judged = { ...blank, licence: lic.name || lic.code || null, w: size.w, h: size.h, author };
  const refuse = (why: string): Judged => ({ ...out, why });

  if (ii.mime !== "image/jpeg" && ii.mime !== "image/png") return refuse("mime");
  if (!/\.(jpe?g|png)$/i.test(title)) return refuse("extension");
  if (!lic.ok) return refuse("licence");
  // A licence that asks for the author to be named cannot be met without a name: the photograph is not used. Nor when the author field is
  // not a name that may be printed in a public post and on the video (an address, a telephone number, a sentence): see authorFits. Nor when
  // the card has no letters to draw it with (Chinese, Japanese, Hebrew ...): a name that comes out as empty boxes names nobody.
  if (lic.attribution && !rawAuthor) return refuse("no-author");
  if (lic.attribution && (!authorFits(rawAuthor) || !author)) return refuse("author-text");
  if (lic.attribution && !authorDrawable(author)) return refuse("author-script");
  const nonFree = htmlText(md.NonFree?.value).toLowerCase();
  if (nonFree && nonFree !== "false" && nonFree !== "0") return refuse("nonfree");
  if (htmlText(md.Restrictions?.value)) return refuse("restrictions");

  const name = title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
  const categoryList = String(md.Categories?.value ?? "")
    .split("|")
    .map((c) => fold(htmlText(c)))
    .filter(Boolean);
  const categories = categoryList.join(" ; ");
  const objectName = htmlText(md.ObjectName?.value);
  const description = htmlText(md.ImageDescription?.value);
  if (LICENCE_DOUBT.test(categories)) return refuse("licence-doubt");
  const denyText = fold(`${name} ${objectName}`) + " ; " + categories;
  const deny = DENY.exec(denyText);
  if (deny) return refuse(`deny:${deny[0].trim()}`);
  const sensitive = SENSITIVE.exec(fold(`${name} ${objectName} ${description}`) + " ; " + categories);
  if (sensitive) return refuse(`sensitive:${sensitive[0]}`);
  if ((!opts.allowPeople || opts.recent === true) && categoryList.some((c) => PERSON_CATEGORY.some((r) => r.test(c)))) return refuse("person");
  // A story about a crime or a death: no photograph whose text names a family, a woman, a man, children ... (text only: a victim cannot be told from a bystander).
  // A recent case is the same whatever it is about: the people in it may be alive, and a name with a title is a person.
  if (opts.recent === true || (opts.people && !opts.allowPeople)) {
    const text = fold(`${name} ${objectName} ${description}`) + " ; " + categories;
    const people = PEOPLE.exec(text) ?? (opts.recent === true ? RECENT_PERSON.exec(text) : null);
    if (people) return refuse(`people:${people[0]}`);
  }
  // A modern photograph (its date, its title or its description names a year well after the story) does not show the case. The photographer's
  // date, when the file gives one, decides alone (an old photograph whose description quotes the year of a book or a map is still old);
  // a file with no date is judged by the years in its title and description.
  const taken = htmlText(md.DateTimeOriginal?.value);
  const dated = new RegExp(YEAR_IN_TEXT.source).test(taken);
  const modern = modernYear(dated ? taken : `${name} ${objectName} ${description}`, opts.era);
  if (modern !== null) return refuse(`modern:${modern}`);

  const tooSmall = sizeRefusal(size, opts.lenient === true, opts.format === "wide" ? "wide" : "vertical");
  if (tooSmall) return refuse(tooSmall);
  if (size.unscaled && Number.isFinite(ii.size) && Number(ii.size) > MAX_ORIGINAL_BYTES) return refuse("too-big");

  const url = String(ii.thumburl ?? "");
  const pageUrl = String(ii.descriptionurl ?? "");
  if (!isCommonsImageUrl(url) || !isCommonsPageUrl(pageUrl)) return refuse("host");

  const words = wordsOf(`${name} ${objectName} ${description} ${categories}`);
  if (query !== null && !relevant(words, query)) return refuse("off-topic");

  const candidate: Candidate = {
    title,
    index: Number.isFinite(page.index) ? Number(page.index) : 1e9,
    url,
    w: size.w,
    h: size.h,
    unscaled: size.unscaled,
    words,
    credit: {
      title,
      author,
      licence: lic.name || lic.code,
      licenceUrl: lic.url,
      page: pageUrl,
      attribution: lic.attribution,
    },
  };
  return { ...out, candidate };
}

// ---- the picture itself -----------------------------------------------------------------------------------

/**
 * Puts any photograph into the 1350x2400 portrait frame the renderer draws. A portrait photograph is a plain cover. A
 * landscape or square one is drawn contained at full width over a darkened, blurred cover of itself (an archival
 * 918x716 photograph would otherwise be cropped to under half of its width and enlarged). EXIF orientation is applied;
 * the output is a JPEG without metadata.
 */
export async function composePortrait(input: Buffer): Promise<Buffer> {
  const open = () => sharp(input, { limitInputPixels: 40e6 }).rotate().flatten({ background: "#000000" });
  const meta = await sharp(input, { limitInputPixels: 40e6 }).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const w = (turned ? meta.height : meta.width) ?? 0;
  const h = (turned ? meta.width : meta.height) ?? 0;
  if (!w || !h) throw new Error("not a picture");
  if (w / h <= 0.75) return open().resize(FRAME_W, FRAME_H, { fit: "cover", position: "centre" }).jpeg({ quality: 84 }).toBuffer();
  const back = await open().resize(FRAME_W, FRAME_H, { fit: "cover", position: "centre" }).blur(30).modulate({ brightness: 0.55 }).toBuffer();
  const front = await open().resize({ width: FRAME_W }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const top = Math.max(0, Math.round((FRAME_H - front.info.height) / 2));
  return sharp(back).composite([{ input: front.data, top, left: 0 }]).jpeg({ quality: 84 }).toBuffer();
}

/**
 * Puts any photograph into the 1920x1080 frame a wide (16:9) story is drawn on. A landscape photograph (wider than 5:4) fills the whole
 * frame as a plain cover: that is the picture. A portrait or squarish one is drawn contained at the frame's full height, centred, over a
 * darkened, blurred cover of itself (a tall photograph would otherwise be cropped to a thin strip). EXIF orientation is applied; the
 * output is a JPEG without metadata.
 */
export async function composeLandscape(input: Buffer): Promise<Buffer> {
  const open = () => sharp(input, { limitInputPixels: 40e6 }).rotate().flatten({ background: "#000000" });
  const meta = await sharp(input, { limitInputPixels: 40e6 }).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const w = (turned ? meta.height : meta.width) ?? 0;
  const h = (turned ? meta.width : meta.height) ?? 0;
  if (!w || !h) throw new Error("not a picture");
  // A photograph whose long side is under WIDE_SHARP_MIN pixels (an archival one is often 900) is not enlarged to fill the frame (a cover would
  // blow a 900x600 picture up more than twice and crop it): it is drawn contained, enlarged at most WIDE_ENLARGE_MAX times, over the blurred copy.
  const small = Math.max(w, h) < WIDE_SHARP_MIN;
  if (!small && w / h >= 1.25) return open().resize(WIDE_FRAME_W, WIDE_FRAME_H, { fit: "cover", position: "centre" }).jpeg({ quality: 86 }).toBuffer();
  const back = await open().resize(WIDE_FRAME_W, WIDE_FRAME_H, { fit: "cover", position: "centre" }).blur(30).modulate({ brightness: 0.55 }).toBuffer();
  const limit = small ? { width: Math.min(WIDE_FRAME_W, Math.round(w * WIDE_ENLARGE_MAX)), height: Math.min(WIDE_FRAME_H, Math.round(h * WIDE_ENLARGE_MAX)) } : { width: WIDE_FRAME_W, height: WIDE_FRAME_H };
  const front = await open().resize({ ...limit, fit: "inside" }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const left = Math.max(0, Math.round((WIDE_FRAME_W - front.info.width) / 2));
  const top = Math.max(0, Math.round((WIDE_FRAME_H - front.info.height) / 2));
  return sharp(back).composite([{ input: front.data, top, left }]).jpeg({ quality: 86 }).toBuffer();
}

/** The photograph in the frame of the video's format: the portrait frame of a reel, or the wide frame of a 16:9 story. */
export function composeFrame(input: Buffer, format: PhotoFormat = "vertical"): Promise<Buffer> {
  return format === "wide" ? composeLandscape(input) : composePortrait(input);
}

// ---- the network ------------------------------------------------------------------------------------------

export function commonsUserAgent(): string {
  const contact = (process.env.COMMONS_CONTACT ?? "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 120);
  return contact ? `${UA_BASE} ${contact}` : UA_BASE;
}

interface Ctx {
  fetchImpl: typeof fetch;
  ua: string;
  signal: AbortSignal;
  retryMs: number;
  /** Shared by every derived context: a 429/503 stops the whole stage. */
  state: { stopped: boolean };
  /** The image-information query of the video's format (thumbnail width); absent = the vertical one. */
  imageinfo?: Record<string, string>;
}

/** A timeout of its own for one request, ended by the stage's too. The timers are plain setTimeout so tests can fake them. */
function requestSignal(parent: AbortSignal, ms: number): { signal: AbortSignal; done: () => void } {
  const ac = new AbortController();
  const stop = () => ac.abort();
  if (parent.aborted) ac.abort();
  else parent.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, ms);
  return {
    signal: ac.signal,
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", stop);
    },
  };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

const RETRY_CODES = new Set(["cirrussearch-too-busy-error", "maxlag", "ratelimited"]);

type ApiAnswer = { kind: "ok"; json: Record<string, unknown> } | { kind: "stopped" } | { kind: "failed" };

/** One API call: a busy answer (in HTTP 200 or a timeout) is tried once more; 429/503 stop the whole stage. */
async function api(ctx: Ctx, params: Record<string, string>, endpoint: string = API): Promise<ApiAnswer> {
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", maxlag: "5", ...params })) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (ctx.state.stopped) return { kind: "stopped" };
    if (ctx.signal.aborted) return { kind: "failed" };
    const req = requestSignal(ctx.signal, REQUEST_MS);
    try {
      const res = await ctx.fetchImpl(url.toString(), { headers: { "User-Agent": ctx.ua, Accept: "application/json" }, signal: req.signal });
      if (res.status === 429 || res.status === 503) {
        ctx.state.stopped = true;
        return { kind: "stopped" };
      }
      if (!res.ok) return { kind: "failed" };
      const json = (await res.json()) as Record<string, unknown> | null;
      if (!json || typeof json !== "object") return { kind: "failed" };
      const error = json.error as { code?: unknown } | undefined;
      if (error) {
        if (attempt === 0 && typeof error.code === "string" && RETRY_CODES.has(error.code)) {
          req.done();
          await pause(ctx.retryMs, ctx.signal);
          continue;
        }
        return { kind: "failed" };
      }
      return { kind: "ok", json };
    } catch {
      if (attempt === 0 && !ctx.signal.aborted) {
        req.done();
        await pause(ctx.retryMs, ctx.signal);
        continue;
      }
      return { kind: "failed" };
    } finally {
      req.done();
    }
  }
  return { kind: "failed" };
}

const pagesOf = (json: Record<string, unknown>): CommonsPage[] => {
  const pages = (json.query as { pages?: unknown } | undefined)?.pages;
  return (Array.isArray(pages) ? (pages as CommonsPage[]) : []).filter((p) => p && typeof p === "object").sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9));
};

/** A search phrase as the API gets it: Latin letters and digits only (no search operators), at most 80 characters. */
export function cleanQuery(q: unknown): string {
  return String(q ?? "")
    .replace(/[^\p{Script=Latin}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
}

export interface SearchOutcome {
  /** ok = answered (maybe with nothing); stopped = Wikimedia said stop; failed = no usable answer. */
  outcome: "ok" | "stopped" | "failed";
  judged: Judged[];
}

/** Searches the file namespace for photographs (bitmaps) and judges every hit, in the order the search ranks them. */
async function searchFiles(ctx: Ctx, query: string, opts: JudgeOptions = {}): Promise<SearchOutcome> {
  const words = query.split(" ").filter(Boolean);
  const tryTerm = async (term: string) => api(ctx, { generator: "search", gsrsearch: `filetype:bitmap ${term}`, gsrnamespace: "6", gsrlimit: String(SEARCH_LIMIT), ...(ctx.imageinfo ?? IMAGEINFO) });
  let term = query;
  let answer = await tryTerm(term);
  // the terms are AND-ed: three words or more that find nothing are tried once more without the last one (the writer lists the
  // words by importance), and what that finds is judged against the shorter phrase it was found with
  if (answer.kind === "ok" && words.length >= 3 && !pagesOf(answer.json).length) {
    term = words.slice(0, -1).join(" ");
    answer = await tryTerm(term);
  }
  if (answer.kind !== "ok") return { outcome: answer.kind, judged: [] };
  return { outcome: "ok", judged: pagesOf(answer.json).map((p) => judge(p, term, opts)) };
}

// ---- the pools: the case's own pictures -------------------------------------------------------------------

/**
 * The titles of the pictures of a Wikipedia article as the finder wants them: "File:Name.jpg", spaces for underscores, JPEG and
 * PNG only (the rest is refused by the judge anyway), without repeats, at most 40. Anything that is not a plain file title is dropped.
 */
export function cleanArticleImages(list: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const name = plain(raw).replace(/_/g, " ").replace(/^(?:file|image)\s*:\s*/i, "").trim();
    if (!name || name.length > 240 || /[|<>[\]{}#]/.test(name) || !/\.(?:jpe?g|png)$/i.test(name)) continue;
    const title = `File:${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= MAX_ARTICLE_IMAGES) break;
  }
  return out;
}

/** The image information of some Commons files, in batches of 20 titles; a batch that fails is simply missing. Ordered as the titles are. */
async function imageInfos(ctx: Ctx, titles: string[]): Promise<CommonsPage[]> {
  const batches: string[][] = [];
  for (let i = 0; i < titles.length; i += ARTICLE_BATCH) batches.push(titles.slice(i, i + ARTICLE_BATCH));
  const answers = await Promise.all(batches.map((b) => api(ctx, { titles: b.join("|"), ...(ctx.imageinfo ?? IMAGEINFO) })));
  const rank = new Map(titles.map((t, i) => [t.toLowerCase(), i]));
  const pages: CommonsPage[] = [];
  for (const a of answers) if (a.kind === "ok") pages.push(...pagesOf(a.json));
  return pages.sort((a, b) => (rank.get(String(a.title ?? "").toLowerCase()) ?? 1e9) - (rank.get(String(b.title ?? "").toLowerCase()) ?? 1e9));
}

/**
 * The case's own pictures, judged (no relevance check: they belong to the article), in the article's order. No era check either: the
 * article's editors chose them for the case, and a topic's article ("Peak oil", years 1956-1971 by its lead) shows charts of 2015.
 */
async function articlePool(ctx: Ctx, titles: string[], opts: JudgeOptions): Promise<Candidate[]> {
  if (!titles.length) return [];
  const req = requestSignal(ctx.signal, POOL_MS);
  try {
    const pages = await imageInfos({ ...ctx, signal: req.signal }, titles);
    return pages.map((p) => judge(p, null, { ...opts, era: null, lenient: true }).candidate).filter((c): c is Candidate => !!c);
  } catch {
    return [];
  } finally {
    req.done();
  }
}

/** The files of the Commons category named like the subject (best effort, its own short budget). */
async function categoryPool(ctx: Ctx, subject: string, opts: JudgeOptions): Promise<Candidate[]> {
  const need = tokensOf(subject);
  if (!need.length) return [];
  const req = requestSignal(ctx.signal, POOL_MS);
  const sub: Ctx = { ...ctx, signal: req.signal };
  try {
    const listed = await api(sub, { list: "search", srsearch: cleanQuery(subject), srnamespace: "14", srlimit: "6" });
    if (listed.kind !== "ok") return [];
    const hits = (listed.json.query as { search?: { title?: unknown }[] } | undefined)?.search ?? [];
    const category = hits.map((h) => String(h?.title ?? "")).find((t) => /^category:/i.test(t) && need.every((n) => wordsOf(t).has(n)));
    if (!category) return [];
    const members = await api(sub, { generator: "categorymembers", gcmtitle: category, gcmtype: "file", gcmlimit: String(POOL_LIMIT), ...(ctx.imageinfo ?? IMAGEINFO) });
    if (members.kind !== "ok") return [];
    return pagesOf(members.json)
      .map((p) => judge(p, null, opts).candidate)
      .filter((c): c is Candidate => !!c);
  } catch {
    return [];
  } finally {
    req.done();
  }
}

/**
 * The beat's own words: the words of its phrase that are not part of the subject's name ("winter" in "Hinterkaifeck winter"). A phrase
 * with none is about the case itself.
 */
function ownWords(query: string, prof: SubjectProfile | null): string[] {
  return tokensOf(query).filter((t) => !prof?.all.includes(t));
}

/** How many of a beat's own words are in a pool file's text, best phrase of the beat. */
function poolScore(c: Candidate, queries: string[], prof: SubjectProfile | null): number {
  let best = 0;
  for (const q of queries) best = Math.max(best, ownWords(q, prof).filter((t) => c.words.has(t)).length);
  return best;
}

/** The beat is about the case itself: one of its phrases has no word besides the subject's name. */
const subjectOnly = (queries: string[], prof: SubjectProfile | null): boolean => !!prof && queries.some((q) => ownWords(q, prof).length === 0);

/**
 * A picture's identity for "no picture twice": its title without the extension and without the marks of an edited copy of the
 * same photograph ("(cropped)", "(edited)", "(detail)", ...). The same farm cropped and uncropped is one picture.
 */
export function shotKey(title: string): string {
  return fold(title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, ""))
    .replace(/\s*[([](?:cropped|crop|edited|edit|retouched|restored|detail|rotated|enhanced|colou?rized|scaled|resized)[)\]]/g, "")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * The pool's file for each beat, decided before anything is downloaded so that the beat with a perfect match is not robbed by an earlier
 * beat. The opening beat picks first (the best match of its words, or, when its phrase is only the case's name, the first file that
 * names the case: usually the article's lead picture). Then every other beat takes the unused file that shares most of its own words,
 * and the beats about the case itself take, in order, the unused files whose text names the case. A file serves one beat. A pool
 * file is never used because it is first in line: it shares a word with the beat, or the beat is the case itself and the file names it.
 */
function assignPool(pool: Candidate[], wanted: PhotoWanted[], prof: SubjectProfile | null, used: Set<string>): Map<number, Candidate> {
  const out = new Map<number, Candidate>();
  const free = (c: Candidate) => !used.has(shotKey(c.title));
  const take = (scene: number, c: Candidate) => {
    used.add(shotKey(c.title));
    out.set(scene, c);
  };
  const bestMatch = (w: PhotoWanted): Candidate | null => {
    let best: Candidate | null = null;
    let bestScore = 0;
    for (const c of pool) {
      if (!free(c)) continue;
      const s = poolScore(c, w.queries, prof);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    return best;
  };
  const named = (): Candidate | null => pool.find((x) => free(x) && aboutSubject(x.words, prof)) ?? null;
  const [opening, ...others] = wanted;
  if (opening) {
    const c = bestMatch(opening) ?? (subjectOnly(opening.queries, prof) ? named() : null);
    if (c) take(opening.scene, c);
  }
  for (const w of others) {
    const c = bestMatch(w);
    if (c) take(w.scene, c);
  }
  for (const w of others) {
    if (out.has(w.scene) || !subjectOnly(w.queries, prof)) continue;
    const c = named();
    if (c) take(w.scene, c);
  }
  return out;
}

/** The best unused file of a pool for one beat, by the same rule: a shared word with the beat (most first), else, for a beat about the case itself, a file that names it. */
function fromPool(pool: Candidate[], queries: string[], prof: SubjectProfile | null, used: Set<string>): Candidate | null {
  const itself = subjectOnly(queries, prof);
  let best: Candidate | null = null;
  let bestRank = 0;
  for (const c of pool) {
    if (used.has(shotKey(c.title))) continue;
    const s = poolScore(c, queries, prof);
    const about = aboutSubject(c.words, prof);
    if (s < 1 && !(itself && about)) continue;
    const rank = s * 2 + (about ? 1 : 0) + 1;
    if (rank > bestRank) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

/** What is left of the case's own pictures, once the beats' own matches and the searches are done: the first unused file that names the case. */
function spareFromPool(pool: Candidate[], prof: SubjectProfile | null, used: Set<string>): Candidate | null {
  return pool.find((c) => !used.has(shotKey(c.title)) && aboutSubject(c.words, prof)) ?? null;
}

// ---- downloading and storing ------------------------------------------------------------------------------

/** Downloads one thumbnail: only from Wikimedia's image hosts, one redirect at most, a size cap while it streams, a real JPEG or PNG. */
async function downloadImage(ctx: Ctx, c: Candidate): Promise<Buffer | null> {
  const cap = c.unscaled ? MAX_ORIGINAL_BYTES : MAX_STREAM_BYTES;
  let url = c.url;
  for (let hop = 0; hop < 2; hop++) {
    if (ctx.state.stopped || ctx.signal.aborted) return null;
    if (!isCommonsImageUrl(url)) return null;
    const req = requestSignal(ctx.signal, DOWNLOAD_MS);
    try {
      const res = await ctx.fetchImpl(url, { headers: { "User-Agent": ctx.ua, Accept: "image/jpeg,image/png" }, redirect: "manual", signal: req.signal });
      if (res.status === 429 || res.status === 503) {
        ctx.state.stopped = true;
        return null;
      }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next || hop === 1) return null;
        url = new URL(next, url).toString();
        continue;
      }
      if (!res.ok) return null;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > cap) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > cap) {
            await reader.cancel().catch(() => undefined);
            return null;
          }
          chunks.push(value);
        }
      } else {
        const whole = new Uint8Array(await res.arrayBuffer());
        if (whole.length > cap) return null;
        chunks.push(whole);
      }
      const buf = Buffer.concat(chunks);
      const jpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const png = buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return jpeg || png ? buf : null;
    } catch {
      return null;
    } finally {
      req.done();
    }
  }
  return null;
}

const defaultStore: PhotoStore = async (pathname, body, contentType, signal) =>
  (await put(pathname, body, { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true, ...(signal ? { abortSignal: signal } : {}) })).url;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function cleanWanted(wanted: PhotoWanted[]): PhotoWanted[] {
  const seen = new Set<number>();
  const out: PhotoWanted[] = [];
  for (const w of Array.isArray(wanted) ? wanted : []) {
    if (!w || !Number.isInteger(w.scene) || w.scene < 0 || seen.has(w.scene)) continue;
    // a phrase of years alone ("1922") finds anything of that year: it needs at least one word besides
    const queries = [...new Set((Array.isArray(w.queries) ? w.queries : []).map(cleanQuery).filter((q) => tokensOf(q).some((t) => !YEAR.test(t))))].slice(0, MAX_QUERIES);
    if (!queries.length) continue;
    seen.add(w.scene);
    out.push({ scene: w.scene, queries });
  }
  return out.sort((a, b) => a.scene - b.scene).slice(0, MAX_PHOTO_SCENES);
}

/** A name for one call's files: stored files of two calls (a retry of the same video) never share a path, so a late upload cannot replace a picture that is already in use. */
const runId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Finds, fetches and stores a photograph for each wanted beat. Never rejects and never takes longer than `budgetMs` (plus a short
 * time to let in-flight work stop): what has finished when the time ends is returned. A beat with no usable photograph is simply
 * missing from the answer. `signal` ends the whole stage early; after the call returns, nothing of it is still running or uploading
 * (a store that ignores the signal may still finish a file, but under a name that no job refers to).
 */
export async function findStoryPhotos(o: FindStoryPhotosInput): Promise<FoundPhoto[]> {
  const found: FoundPhoto[] = [];
  const stage = new AbortController();
  const outer = () => stage.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let work: Promise<void> | undefined;
  let settled = false;
  try {
    if (process.env.STORY_PHOTOS_ENABLED === "0") return [];
    if (o.signal?.aborted) return [];
    const wanted = cleanWanted(o.wanted);
    const format: PhotoFormat = o.format === "wide" ? "wide" : "vertical";
    const budget = Number.isFinite(o.budgetMs) ? Math.min(30_000, Math.floor(o.budgetMs)) : STORY_PHOTO_BUDGET_MS;
    if (!wanted.length || !o.tenantId || !o.jobId || budget < 1_000) return [];
    o.signal?.addEventListener("abort", outer, { once: true });
    timer = setTimeout(() => stage.abort(), budget);
    const expired = new Promise<void>((resolve) => stage.signal.addEventListener("abort", () => resolve(), { once: true }));
    const ctx: Ctx = {
      fetchImpl: o.fetchImpl ?? fetch,
      ua: commonsUserAgent(),
      signal: stage.signal,
      retryMs: o.retryMs ?? RETRY_MS,
      state: { stopped: false },
      imageinfo: imageinfoFor(format),
    };
    const store = o.store ?? defaultStore;
    const run = runId();
    const started = Date.now();
    // A recent case (people in it may be alive) is judged as strictly as a crime, whoever the story is about, and is shown only with the
    // case's own pictures: a search by a beat's phrase cannot tell a place from the people standing in it.
    const recent = o.recent === true;
    const judgeOpts: JudgeOptions = {
      allowPeople: o.subjectIsPerson === true && !recent,
      // a photograph of people in a story about a crime or a death is never used (see JudgeOptions.people), nor a modern one (JudgeOptions.era)
      people: o.crime !== false || recent,
      era: o.era ?? null,
      format,
      ...(recent ? { recent: true } : {}),
    };
    work = (async () => {
      const used = new Set<string>();
      const searches = new Map<string, Promise<Candidate[]>>();
      const search = (q: string): Promise<Candidate[]> => {
        let s = searches.get(q);
        if (!s) {
          s = searchFiles(ctx, q, judgeOpts).then((r) => r.judged.map((j) => j.candidate).filter((c): c is Candidate => !!c));
          searches.set(q, s);
        }
        return s;
      };
      const subject = o.subject?.trim() ? o.subject.trim() : null;
      const prof = subjectProfile(subject);

      // 1. the pictures of the case's own article, shared out among the beats before anything is downloaded
      const articleTitles = cleanArticleImages(o.articleImages);
      const article = articleTitles.length ? await articlePool(ctx, articleTitles, judgeOpts) : [];
      const assigned = assignPool(article, wanted, prof, used);

      // 2. the Commons category of the case, asked once and only when a beat is left without a picture of the article
      let category: Promise<Candidate[]> | null = null;
      const categoryFiles = (): Promise<Candidate[]> => {
        if (!category) category = subject && budget - (Date.now() - started) >= POOL_MIN_BUDGET_MS ? categoryPool(ctx, subject, judgeOpts) : Promise.resolve([]);
        return category;
      };

      const resolveScene = async (w: PhotoWanted): Promise<FoundPhoto | null> => {
        let attempts = 0;
        // one try, and one more with the beat's next acceptable photograph if the first could not be fetched or decoded
        const attempt = async (c: Candidate, via: PhotoVia): Promise<FoundPhoto | null> => {
          attempts++;
          const raw = await downloadImage(ctx, c);
          if (!raw) return null;
          const jpg = await composeFrame(raw, format).catch(() => null);
          if (!jpg || stage.signal.aborted) return null;
          const url = await store(`merchant/${o.tenantId}/advideo/${o.jobId}/img-${w.scene}-${run}-${attempts}.jpg`, jpg, "image/jpeg", stage.signal).catch(() => null);
          if (!url || stage.signal.aborted) return null;
          return { scene: w.scene, url, via, credit: { scene: w.scene, ...c.credit, ...(via === "search" ? { illustrative: true } : {}) } };
        };
        const over = () => attempts >= 2 || ctx.state.stopped || stage.signal.aborted;

        const mine = assigned.get(w.scene);
        if (mine) {
          const r = await attempt(mine, "article");
          if (r) return r;
          if (over()) return null;
        }
        if (stage.signal.aborted || ctx.state.stopped) return null;
        const inCategory = fromPool(await categoryFiles(), w.queries, prof, used);
        if (inCategory) {
          used.add(shotKey(inCategory.title));
          const r = await attempt(inCategory, "category");
          if (r) return r;
          if (over()) return null;
        }
        for (const q of recent ? [] : w.queries) {
          if (ctx.state.stopped || stage.signal.aborted) return null;
          for (const c of await search(q)) {
            if (used.has(shotKey(c.title))) continue;
            used.add(shotKey(c.title));
            const r = await attempt(c, "search");
            if (r) return r;
            if (over()) return null;
          }
        }
        // nothing fitted the beat: the case's own picture that is still unused, the least precise but still of the case
        if (stage.signal.aborted || ctx.state.stopped || attempts >= 2) return null;
        const spare = spareFromPool(article, prof, used);
        if (spare) {
          used.add(shotKey(spare.title));
          return attempt(spare, "article");
        }
        return null;
      };

      await mapLimit(wanted, CONCURRENCY, async (w) => {
        const r = await resolveScene(w);
        if (r && !closed && !stage.signal.aborted) {
          found.push(r);
          try {
            o.onPhoto?.(r);
          } catch {
            /* the caller's bookkeeping never harms the stage */
          }
        }
      });
    })().finally(() => {
      settled = true;
    });
    await Promise.race([work.catch(() => undefined), expired]);
  } catch {
    /* fail open: what was found stays */
  } finally {
    closed = true;
    if (timer) clearTimeout(timer);
    o.signal?.removeEventListener("abort", outer);
    stage.abort();
    // Whatever is still in flight has been told to stop; wait (a little) until it has, so that nothing is uploading when the caller goes on.
    if (work && !settled) {
      let t: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([work.catch(() => undefined), new Promise<void>((resolve) => (t = setTimeout(resolve, SETTLE_MS)))]);
      if (t) clearTimeout(t);
    }
  }
  return [...found].sort((a, b) => a.scene - b.scene);
}

// ---- cleaning up ------------------------------------------------------------------------------------------

/** One of our own stored story photographs: merchant/<tenant>/advideo/<job>/img-<beat>-<run>-<n>.jpg in our Blob store. Nothing else is ever deleted. */
const OWN_PHOTO = /^https:\/\/(?:[a-z0-9-]+\.public\.blob\.vercel-storage\.com|media\.gituas\.com)\/merchant\/[A-Za-z0-9_-]+\/advideo\/[A-Za-z0-9_-]+\/img-[A-Za-z0-9_-]+\.jpg$/;

export function isOwnPhotoUrl(url: unknown): url is string {
  return typeof url === "string" && url.length < 400 && OWN_PHOTO.test(url);
}

/**
 * Deletes stored story photographs that no video uses (the pictures of a failed attempt, of a beat that was dropped, of a job that
 * failed for good). Best effort: it never throws and never waits longer than a few seconds; an address that is not one of our own
 * story photographs is left alone. `remove` is injectable (the tests never touch the Blob store).
 */
export async function deletePhotos(urls: unknown[], remove: (urls: string[]) => Promise<unknown> = (u) => del(u), timeoutMs = 4_000): Promise<void> {
  const own = [...new Set(urls.filter(isOwnPhotoUrl))];
  if (!own.length) return;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve(remove(own)).then(() => undefined, () => undefined), new Promise<void>((resolve) => (t = setTimeout(resolve, timeoutMs)))]);
  } catch {
    /* best effort */
  } finally {
    if (t) clearTimeout(t);
  }
}

// ---- the probe --------------------------------------------------------------------------------------------

export interface ProbeRow {
  title: string;
  ok: boolean;
  why: string | null;
  licence: string | null;
  author: string | null;
  size: string;
}

export interface Probe {
  query: string;
  outcome: "ok" | "stopped" | "failed";
  ms: number;
  userAgent: string;
  results: ProbeRow[];
}

/**
 * One search and the judge's verdict on every hit, nothing downloaded and nothing stored: to see from Vercel's own network
 * that Wikimedia answers, and why photographs are refused.
 */
export async function probeCommons(query: string, fetchImpl: typeof fetch = fetch, retryMs: number = RETRY_MS, format: PhotoFormat = "vertical"): Promise<Probe> {
  const started = Date.now();
  const q = cleanQuery(query);
  const stage = new AbortController();
  const timer = setTimeout(() => stage.abort(), 12_000);
  const ctx: Ctx = { fetchImpl, ua: commonsUserAgent(), signal: stage.signal, retryMs, state: { stopped: false }, imageinfo: imageinfoFor(format) };
  try {
    if (!tokensOf(q).length) return { query: q, outcome: "failed", ms: 0, userAgent: ctx.ua, results: [] };
    const r = await searchFiles(ctx, q, { format });
    return {
      query: q,
      outcome: r.outcome,
      ms: Date.now() - started,
      userAgent: ctx.ua,
      results: r.judged.map((j) => ({ title: j.title, ok: !j.why, why: j.why, licence: j.licence, author: j.author, size: `${j.w}x${j.h}` })),
    };
  } catch {
    return { query: q, outcome: "failed", ms: Date.now() - started, userAgent: ctx.ua, results: [] };
  } finally {
    clearTimeout(timer);
  }
}

export interface ArticleProbeRow extends ProbeRow {
  /** The file's own text names the case (it can serve a beat without sharing a word with its phrase). */
  about: boolean;
}

export interface ArticleProbe {
  /** The title that was asked for. */
  title: string;
  /** The title of the article it resolved to (redirects followed); null when Wikipedia has no such article. */
  article: string | null;
  outcome: "ok" | "stopped" | "failed";
  ms: number;
  userAgent: string;
  /** The pictures the article shows, in the order of the page, and how many of them are looked up. */
  listed: number;
  results: ArticleProbeRow[];
}

/**
 * The pictures of an English Wikipedia article (in the order of the page) and the judge's verdict on each of them, as the story
 * finder would judge them (the lenient size gates of the case's own pictures). Nothing is downloaded and nothing stored.
 */
export async function probeArticle(title: string, fetchImpl: typeof fetch = fetch, retryMs: number = RETRY_MS, format: PhotoFormat = "vertical"): Promise<ArticleProbe> {
  const started = Date.now();
  const asked = plain(String(title ?? "")).slice(0, 120);
  const stage = new AbortController();
  const timer = setTimeout(() => stage.abort(), 15_000);
  const ctx: Ctx = { fetchImpl, ua: commonsUserAgent(), signal: stage.signal, retryMs, state: { stopped: false }, imageinfo: imageinfoFor(format) };
  const empty = (outcome: ArticleProbe["outcome"], article: string | null = null): ArticleProbe => ({
    title: asked, article, outcome, ms: Date.now() - started, userAgent: ctx.ua, listed: 0, results: [],
  });
  try {
    if (!asked) return empty("failed");
    // action=parse lists the pictures in the order of the page (prop=images of a query is alphabetical, which says nothing)
    const parsed = await api(ctx, { action: "parse", page: asked, prop: "images", redirects: "1" }, WIKI_API);
    if (parsed.kind !== "ok") return empty(parsed.kind);
    const parse = parsed.json.parse as { title?: unknown; images?: unknown } | undefined;
    const article = typeof parse?.title === "string" ? plain(parse.title) : null;
    const titles = cleanArticleImages(parse?.images);
    if (!titles.length) return { ...empty("ok", article), listed: Array.isArray(parse?.images) ? (parse!.images as unknown[]).length : 0 };
    const prof = subjectProfile(article);
    const pages = await imageInfos(ctx, titles);
    return {
      title: asked,
      article,
      outcome: "ok",
      ms: Date.now() - started,
      userAgent: ctx.ua,
      listed: titles.length,
      results: pages.map((p) => {
        const j = judge(p, null, { lenient: true, format });
        return {
          title: j.title, ok: !j.why, why: j.why, licence: j.licence, author: j.author, size: `${j.w}x${j.h}`,
          about: !!j.candidate && aboutSubject(j.candidate.words, prof),
        };
      }),
    };
  } catch {
    return empty("failed");
  } finally {
    clearTimeout(timer);
  }
}
