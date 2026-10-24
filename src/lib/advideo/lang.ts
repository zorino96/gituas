// The language and the kind of an AI video, in one pure module: the Video screen (a browser component), the
// chat tools and the server pipeline all read the same words from here. Nothing in this file touches the
// database or a provider, and it only imports the pure list of voices.
//
// Rule "absent = default": a video's language is written into its stored JSON only when it is not Sorani
// ("ckb"), its kind only when it is not an ad. Every reader goes through videoLangOf / videoKindOf /
// langAndKindOf, so a row made before this existed (no field at all) reads as a Sorani ad.

import { isPawanVoice } from "@/lib/voice/voices";

/** The languages a video can be made in; the same set as the text-to-speech languages. */
export type VideoLang = "ckb" | "ar" | "en";
/** An ad sells a shop or a product; a story is content (no product, price, delivery line or phone number). */
export type VideoKind = "ad" | "story";

export const VIDEO_LANGS: readonly VideoLang[] = ["ckb", "ar", "en"];
export const VIDEO_KINDS: readonly VideoKind[] = ["ad", "story"];

export const DEFAULT_VIDEO_LANG: VideoLang = "ckb";
export const DEFAULT_VIDEO_KIND: VideoKind = "ad";

export function isVideoLang(v: unknown): v is VideoLang {
  return typeof v === "string" && (VIDEO_LANGS as readonly string[]).includes(v);
}

/** The language, or Sorani for anything that is not one (a missing column, an old row, a typo). */
export function videoLangOf(v: unknown): VideoLang {
  return isVideoLang(v) ? v : DEFAULT_VIDEO_LANG;
}

export function isVideoKind(v: unknown): v is VideoKind {
  return typeof v === "string" && (VIDEO_KINDS as readonly string[]).includes(v);
}

/** The kind, or an ad for anything that is not one. */
export function videoKindOf(v: unknown): VideoKind {
  return isVideoKind(v) ? v : DEFAULT_VIDEO_KIND;
}

/** Whether the language is written from right to left (Sorani and Arabic). */
export function isRtl(lang: VideoLang): boolean {
  return lang === "ckb" || lang === "ar";
}

/**
 * The kind a page's goal asks for by default: a page that earns from its content ("monetize", or the older
 * "grow") makes stories; everything else (selling, enquiries, other, no profile) makes ads. The person can always choose.
 */
export function kindForGoal(goal: string | null | undefined): VideoKind {
  return goal === "grow" || goal === "monetize" ? "story" : "ad";
}

/**
 * The voice when none was chosen. Sorani: a Pawan voice. Arabic and English use Gemini's two voices, which are
 * only "male" and "female": a story is told by the male one, an ad is read by the female one.
 */
export function defaultVoice(lang: VideoLang, kind: VideoKind = "ad"): string {
  if (lang === "ckb") return "shilan";
  return kind === "story" ? "male" : "female";
}

/**
 * The voice a video is made with: the chosen one when it belongs to the language (a Pawan name for Sorani,
 * "male" or "female" for Arabic and English), else the default of the language and kind.
 */
export function voiceFor(lang: VideoLang, requested: unknown, kind: VideoKind = "ad"): string {
  if (lang === "ckb") return isPawanVoice(requested) ? requested : defaultVoice(lang, kind);
  return requested === "male" || requested === "female" ? requested : defaultVoice(lang, kind);
}

/** The language and the kind written in a stored spec or in render props (anything missing or invalid reads as the default). */
export function langAndKindOf(json: unknown): { lang: VideoLang; kind: VideoKind } {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return { lang: videoLangOf(r.lang), kind: videoKindOf(r.kind) };
}

/** The fields to write into a stored spec or props: only the values that are not the default (so a Sorani ad writes none). */
export function langFields(lang: VideoLang, kind: VideoKind): { lang?: VideoLang; kind?: VideoKind } {
  return { ...(lang !== DEFAULT_VIDEO_LANG ? { lang } : {}), ...(kind !== DEFAULT_VIDEO_KIND ? { kind } : {}) };
}

// ---- how a story is told: as a documented true story, or as invented fiction -------------------------------------

/**
 * How a video's script is written and dressed.
 * - real: EVERY story, in every language: told only from what is publicly documented (the English Wikipedia article of one real
 *   case), with real photographs from Wikimedia Commons behind its beats. The case is the one the owner names, or, when he
 *   names none, one the system chooses (see subject.ts).
 * - fiction: a story whose idea says fiction outright: invented names, told as a story, with a caption line that says so and
 *   no photographs (a real photograph next to an invented crime would mislead).
 * - classic: every ad. (A story is never classic any more; the value stays for the callers that build a prompt without a mode.)
 */
export type StoryMode = "classic" | "real" | "fiction";

/**
 * Words that say "invented", counted only when they are a plain wish for an invented story: the whole words fiction, fictional,
 * fictitious, imaginary, make-believe, "an invented story", "a tale I invent", "from your imagination". "Fabricated" and "made up" alone
 * are NOT here: a real hoax ("the fabricated Piltdown fossil", "a made up legend that people believed") uses them for something true.
 * Each pattern is global; a hit is then checked in its context (see englishHitCounts), so "non-fiction", "science fiction",
 * "fact and fiction" and "rather than fiction" do not count.
 */
const EN_FICTION_PATTERNS: readonly RegExp[] = [
  /\b(?:fiction(?:al)?|fictitious|imaginary|make[-\s]?believe)\b/g,
  /\b(?:invent(?:ed)?|imagined)\s+(?:(?:an?|the|some|your)\s+)?(?:[a-z-]+\s+){0,2}?(?:stor(?:y|ies)|tales?|cases?|legends?|characters?|myster(?:y|ies)|plots?)\b/g,
  /\b(?:stor(?:y|ies)|tales?|cases?|myster(?:y|ies)|legends?)\s+(?:that\s+)?(?:i|you|we)\s+(?:invent|imagine|make\s+up|made\s+up)\b/g,
  /\b(?:from|out\s+of)\s+(?:your|his|her|the)\s+imagination\b/g,
];
/** A word shortly before a hit that turns it round: "not a work of fiction", "no fiction", "non-fiction", "avoid fiction". */
const EN_NEGATORS = new Set([
  "not", "never", "no", "non", "without", "nothing", "nor", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "cannot", "can't",
  "avoid", "avoiding", "avoids", "skip", "skipping", "except", "excluding", "exclude", "minus", "neither",
]);
/** Phrases (the last few words before a hit) that turn it round: "rather than fiction", "instead of fiction", "stay away from fiction". */
const EN_NEGATOR_PHRASES =
  /\b(?:rather than|instead of|away from|free of|free from|stay(?:ing)? away|steer(?:ing)? clear of|keep(?:ing)? away from|other than|apart from|opposed to|as opposed to|anything but|nothing but|far from)\b/;
/** What right after a hit turns it round: "fiction-free", "fiction is not wanted", "fiction isn't needed". */
const EN_NEGATED_AFTER = /^(?:[-\s]*free\b|\s*(?:(?:is|are|was|were|should|must|does|do|did)\s+(?:not|never)|isn't|aren't|wasn't|weren't|shouldn't|mustn't|doesn't|don't|didn't|never)\b)/;
/** How many words before a hit (in the same clause) may hold a negator; a list ("avoid X and Y") carries it further. */
const NEGATION_WINDOW = 4;
const NEGATION_WINDOW_LIST = 8;
/** A clause ends at a stop, a comma, a colon or a line break (English, Arabic and Sorani marks): a negator before it does not reach past it. */
const CLAUSE_END = /[.!?;:,\n،؛؟]/;
const FACT_BEFORE = /\bfacts?\s*(?:from|and|or|vs\.?|versus|&|\/|to)\s*$/;
const FACT_AFTER = /^\s*(?:and|or|from|vs\.?|versus|&|\/|to)\s*facts?\b/;
const SCIENCE_BEFORE = /\bscience[-\s]*$/;

/**
 * What a fiction word can describe that is NOT the story the owner wants told: "the real case that inspired the fictional detective Sherlock
 * Holmes", "the real murder behind a fiction novel". Followed by one of these the word describes a character or a work, not the story.
 */
const NOT_THE_STORY = new Set([
  "detective", "detectives", "novel", "novels", "book", "books", "movie", "movies", "film", "films", "series", "show", "shows", "author", "authors",
  "writer", "writers", "universe", "franchise", "saga", "comic", "comics", "cartoon", "cartoons", "hero", "heroes", "villain", "villains", "protagonist",
  "protagonists", "sleuth", "sleuths",
]);
/** A character may be the story's own ("a fictional character who...") or the thing a real case inspired: it is read with the words around it. */
const CHARACTER_NOUNS = new Set(["character", "characters", "figure", "figures", "person", "people"]);
/** The nouns that make the word describe the story itself. */
const STORY_NOUNS = new Set(["story", "stories", "tale", "tales", "account", "version", "plot", "narrative", "mystery", "mysteries", "case", "cases"]);
/** Words before a fiction word that say the real case is the origin of something else. */
const ORIGIN_BEFORE = /\b(?:inspired|inspiration|behind|based on|basis|origin|originated|source of|model for)\b/;

/** Whether an English hit is a real wish for fiction (not negated, not "fact and fiction", not "science fiction", not a fictional detective or novel). */
function englishHitCounts(text: string, index: number, hit: string): boolean {
  const before = text.slice(0, index);
  const after = text.slice(index + hit.length);
  const clause = before.split(CLAUSE_END).pop() ?? "";
  const words = clause.split(/[^a-z']+/).filter(Boolean);
  // "avoid made-up details and imaginary suspects": when the words just before the hit are a list, the negator in front of the list counts.
  const near = words.slice(-NEGATION_WINDOW);
  const tail = near.some((w) => w === "and" || w === "or" || w === "nor") ? words.slice(-NEGATION_WINDOW_LIST) : near;
  if (tail.some((w) => EN_NEGATORS.has(w))) return false;
  if (EN_NEGATOR_PHRASES.test(tail.join(" "))) return false;
  if (EN_NEGATED_AFTER.test(after)) return false;
  if (FACT_BEFORE.test(before) || FACT_AFTER.test(after)) return false;
  if (/^fiction/.test(hit) && SCIENCE_BEFORE.test(before)) return false;
  // The word counts only when it describes the story itself, not a character or a work the real case is the origin of.
  if (/^(?:fiction|fictitious|imaginary)/.test(hit)) {
    const next = /^[\s-]*([a-z]+)/.exec(after)?.[1] ?? "";
    if (NOT_THE_STORY.has(next)) return false;
    const clauseText = `${clause} ${after.split(CLAUSE_END)[0] ?? ""}`;
    if (CHARACTER_NOUNS.has(next) && /\b(?:real|true|actual|historical|history)\b/.test(clauseText)) return false;
    if (ORIGIN_BEFORE.test(clause) && !STORY_NOUNS.has(next)) return false;
  }
  return true;
}

/** Arabic and Sorani letters folded to one spelling: Arabic yeh and alef maksura to Persian yeh, Arabic kaf to the Kurdish one, the Sorani ە dropped and ڵ read as ل. */
const FOLD_FROM = ["ي", "ى", "ك", "ە", "ڵ"];
const FOLD_TO = ["ی", "ی", "ک", "", "ل"];
const TATWEEL = String.fromCharCode(0x0640);

/** Arabic and Sorani text in one spelling (see FOLD_FROM): lets a keyword match however the letters were typed. */
export function foldArabicLetters(text: string): string {
  let s = text.normalize("NFKC").replace(/\p{Mn}/gu, "").split(TATWEEL).join("");
  FOLD_FROM.forEach((from, i) => {
    s = s.split(from).join(FOLD_TO[i]);
  });
  return s;
}

const foldedSet = (words: readonly string[]): Set<string> => new Set(words.map((w) => foldArabicLetters(w)));

/**
 * The WHOLE words that say "fictional" in Arabic and in Sorani: خيالي / خيالية (and with the article), خەیاڵی, مختلق / مختلقة, متخيل / متخيلة.
 * Whole words only: the noun خيال (imagination, also in "science fiction"), الخيالة (cavalry) and خيّال (horseman) are not a wish for fiction.
 */
const AR_FICTION_WORDS = foldedSet([
  "خيالي", "خيالية", "الخيالي", "الخيالية", "خیالی", "خیالیة", "خەیاڵی", "مختلق", "مختلقة", "المختلقة", "المختلق", "متخيل", "متخيلة", "المتخيلة", "المتخيل",
]);
/** A word shortly before a fiction word that turns it round: "not", "non", "without", "far from", "away from" in Arabic and Sorani. */
const AR_NEGATORS_BEFORE = foldedSet([
  "لا", "ليس", "ليست", "ليسوا", "لست", "ولست", "لسنا", "وليس", "وليست", "ولا", "لم", "ولم", "مو", "مش", "غير", "بدون", "بلا", "دون", "ماهي", "ماهو", "بعيدا", "بعيد", "بعيدة",
  "بعيدين", "بعيدون", "خالية", "خالي", "عدا", "ماعدا", "سوى",
  "نا", "نە", "نەک", "نەبێت", "نەبێ", "نامەوێت", "ناتەوێت", "ناوێت", "ناخوازم", "بێ", "بەبێ", "دوور", "دووربکەوە", "دوورکەوە", "جگە", "لەبری",
]);
/** A word right after a fiction word that turns it round: Sorani "X نییە" (X is not), Arabic "X ليست". */
const AR_NEGATORS_AFTER = foldedSet(["نییە", "نیە", "نین", "نەبێت", "نەبێ", "ليست", "وليست", "ليس", "وليس", "مەکە", "مەکەن", "مەبە", "مەبن"]);

/**
 * Whether the owner asked for an invented story: the idea says fiction (English), خيالية (Arabic) or خەیاڵی (Sorani).
 * Affirmative, unambiguous markers only, as whole words. "Non-fiction", "not a work of fiction", "rather than fiction", "avoid fiction",
 * "science fiction" and "fact and fiction" say something else and do not count, and neither do their Arabic and Sorani forms
 * ("لا خيالية", "نە خەیاڵی", "خەیاڵی نییە", "غير خيالية"); the noun خيال alone, "fabricated" and a bare "made up" are not markers.
 */
export function storyFictionAsked(text: string | null | undefined): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  for (const pattern of EN_FICTION_PATTERNS) {
    for (const m of lower.matchAll(pattern)) if (englishHitCounts(lower, m.index ?? 0, m[0])) return true;
  }
  // Arabic and Sorani: whole words, read clause by clause so a negator in an earlier clause does not reach this one.
  for (const clause of text.split(CLAUSE_END)) {
    const tokens = foldArabicLetters(clause).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      if (!AR_FICTION_WORDS.has(tokens[i])) continue;
      const negatedBefore = tokens.slice(Math.max(0, i - 3), i).some((t) => AR_NEGATORS_BEFORE.has(t));
      const negatedAfter = tokens.slice(i + 1, i + 3).some((t) => AR_NEGATORS_AFTER.has(t));
      if (!negatedBefore && !negatedAfter) return true;
    }
  }
  return false;
}

/** What a queued video's spec stub says about how its story is told (see storyModeOf). */
export interface StoryModeStub {
  /** True when the owner's OWN words asked for fiction. Written into the stub once, when the video is made. */
  fiction?: unknown;
}

/**
 * The one switch for how a story is written. EVERY story is told as a real, documented one (in Sorani, Arabic and English
 * alike) unless the owner's own words ask for fiction; an ad is classic. The language no longer matters (kept in the signature so
 * the callers stay as they were).
 *
 * The mode is decided ONCE, from the owner's own words as he typed them (before any reviewer rewrote them), and stored in the spec
 * stub as `fiction: true` only when he asked. A reader that has the stub passes it: the flag decides first, so a reviewed or rewritten
 * topic can never turn a real story into an invented one. Only a stub with no flag at all (a video queued before the flag existed, or
 * no stub) falls back on reading the topic, which is what this function always did.
 */
export function storyModeOf(kind: VideoKind, lang: VideoLang, topic: string | null | undefined, stub?: StoryModeStub | null): StoryMode {
  void lang;
  if (kind !== "story") return "classic";
  if (stub && stub.fiction === true) return "fiction";
  if (stub && stub.fiction === false) return "real";
  return storyFictionAsked(topic) ? "fiction" : "real";
}

/** Whether real photographs are looked for: a documented story whose owner has not switched them off (spec.noPhotos). */
export function storyPhotosOn(mode: StoryMode, spec: { noPhotos?: boolean } | null | undefined): boolean {
  return mode === "real" && spec?.noPhotos !== true;
}

/**
 * The concept a daily story can follow: what the owner wrote about the page (the offer line, the goal in words).
 * A bare category such as "content" is not a concept: it would leave the writer to invent any genre. Null when there is none.
 */
export function storyConceptOf(profile: { offerLine?: string | null; goalText?: string | null } | null | undefined): string | null {
  if (!profile) return null;
  const parts = [profile.offerLine, profile.goalText].map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  return parts.length ? Array.from(parts.join(" — ")).slice(0, 500).join("") : null;
}

/**
 * What a page is about, in the owner's own words, for a story to follow: the offer line, the goal in words and
 * the category (a category of "other" says nothing). Null when the profile holds none of them.
 */
export function channelAboutOf(profile: { offerLine?: string | null; goalText?: string | null; category?: string | null } | null | undefined): string | null {
  if (!profile) return null;
  const parts = [profile.offerLine, profile.goalText, profile.category && profile.category !== "other" ? `category: ${profile.category}` : null]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  if (!parts.length) return null;
  return Array.from(parts.join(" — ")).slice(0, 500).join("");
}
