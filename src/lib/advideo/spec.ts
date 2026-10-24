// The script of an AI video ad: what the director model writes and the renderer (adfilm/) draws.
// The model only fills this shape; it never writes drawing code. Everything it gives is checked and
// cut to size here, and anything outside the vocabulary (an unknown icon, a photo that does not
// exist, digits in a spoken line) is dropped or repaired before the job goes on.

import type { PhotoCredit } from "./credits";
import { langFields, videoKindOf, videoLangOf, type StoryMode, type VideoKind, type VideoLang } from "./lang";

/** "story" is a beat of a story video (a content video, not an ad): the narrator's words over a slow backdrop. */
export type SceneType = "hook" | "value" | "product" | "offer" | "footage" | "cta" | "story";
export const SCENE_TYPES: readonly SceneType[] = ["hook", "value", "product", "offer", "footage", "cta", "story"];
/** What a video of each kind may be made of: the other kind's scenes are dropped. */
const KIND_SCENE_TYPES: Record<VideoKind, readonly SceneType[]> = {
  ad: ["hook", "value", "product", "offer", "footage", "cta"],
  story: ["hook", "story", "footage", "cta"],
};

/** The coarse family of a look: picks the music and the transitions' mood. */
export type AdStyle = "elegant" | "bold" | "clean";
export const AD_STYLES: readonly AdStyle[] = ["elegant", "bold", "clean"];

/** Lucide icon names the renderer ships (adfilm/assets/icons), kept to ones that read well for a shop. */
export const AD_ICONS = [
  "gem", "shield-check", "heart-handshake", "sparkles", "truck", "badge-check", "star", "clock", "leaf",
  "gift", "thumbs-up", "crown", "zap", "package", "map-pin", "phone-call", "heart", "award", "flame",
] as const;
export type AdIcon = (typeof AD_ICONS)[number];

// ---- the look: a design chosen per brand and per day, so two videos are never the same picture ----

export const LOOK_VOCAB = {
  /** Where the text sits: centred, from the reading side, or low in the frame. */
  layout: ["center", "start", "bottom"],
  /** How a product photo is shown: a card, the whole frame, or a card with the text laid over its edge. */
  photo: ["card", "full", "split"],
  /** How a value's icon is framed. */
  icon: ["ring", "badge", "bare"],
  background: ["dust", "grid", "waves", "rings", "glow", "none"],
  /** Built from the brand's own colours. */
  palette: ["brand-dark", "brand-light", "brand-flood", "duotone", "cream", "midnight"],
  motion: ["calm", "punchy", "float"],
  transition: ["crossfade", "push", "slide_up", "zoom_through", "iris", "wipe"],
  shape: ["rounded", "sharp", "pill"],
} as const;

export type LookKey = keyof typeof LOOK_VOCAB;
export interface AdLook {
  layout: (typeof LOOK_VOCAB.layout)[number];
  photo: (typeof LOOK_VOCAB.photo)[number];
  icon: (typeof LOOK_VOCAB.icon)[number];
  background: (typeof LOOK_VOCAB.background)[number];
  palette: (typeof LOOK_VOCAB.palette)[number];
  motion: (typeof LOOK_VOCAB.motion)[number];
  transition: (typeof LOOK_VOCAB.transition)[number];
  shape: (typeof LOOK_VOCAB.shape)[number];
}
const LOOK_KEYS = Object.keys(LOOK_VOCAB) as LookKey[];

/** A short string that names a look, to compare it with the ones used lately. */
export const lookKey = (l: AdLook): string => LOOK_KEYS.map((k) => l[k]).join("/");

/** How alike two looks are: the number of choices they share (0 to 8). */
export function lookDistance(a: AdLook, b: AdLook): number {
  return LOOK_KEYS.filter((k) => a[k] === b[k]).length;
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A look from a seed (the brand and the day): every choice picked by the seed, and when it lands
 * on a look too like the recent ones the choices are rotated until it is not.
 */
export function lookFromSeed(seed: string, avoid: AdLook[] = []): AdLook {
  // Each choice has its own hash of the seed: one shared number would tie them together and leave only a handful of looks.
  let salt = seed;
  const pick = <K extends LookKey>(k: K) => LOOK_VOCAB[k][hash(`${salt}|${k}`) % LOOK_VOCAB[k].length] as AdLook[K];
  const build = (): AdLook => ({
    layout: pick("layout"),
    photo: pick("photo"),
    icon: pick("icon"),
    background: pick("background"),
    palette: pick("palette"),
    motion: pick("motion"),
    transition: pick("transition"),
    shape: pick("shape"),
  });
  let look = build();
  for (let tries = 0; tries < 24 && avoid.some((a) => lookDistance(a, look) >= 5); tries++) {
    salt = `${seed}#${tries}`;
    look = build();
  }
  return look;
}

/** The director's look, each choice kept when it is in the vocabulary and filled from the seed when not. */
export function normalizeLook(raw: unknown, seed: string, avoid: AdLook[] = []): AdLook {
  const base = lookFromSeed(seed, avoid);
  const r = (raw ?? {}) as Record<string, unknown>;
  const out = { ...base } as Record<LookKey, string>;
  for (const k of LOOK_KEYS) {
    const v = r[k];
    if (typeof v === "string" && (LOOK_VOCAB[k] as readonly string[]).includes(v)) out[k] = v;
  }
  return out as unknown as AdLook;
}

/** The family a look belongs to (music, loudness of the mix). */
export function styleOf(l: AdLook): AdStyle {
  if (l.palette === "brand-flood" || l.motion === "punchy") return "bold";
  if (l.palette === "brand-light" || l.palette === "cream") return "clean";
  return "elegant";
}

// ---- the plan: why this video, for the owner to read ---------------------------------------------------

export const OBJECTIVES = ["sell_product", "clear_stock", "new_arrival", "seasonal", "trust", "engage", "reactivate"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export interface AdPlan {
  objective: Objective;
  /** Sorani, for the owner: what this video is for and why today. */
  why: string;
  /** hook_question | showcase | social_proof | offer | how_it_works | ... a short label of the format. */
  format: string;
  /** engagement: leave the price out so buyers ask; conversion: show it. */
  priceMode: "engagement" | "conversion";
  cta: "whatsapp" | "dm" | "comment";
}

/** One day's analysis of a store: what kind of video matters now, and why. Written once a day, shown to the owner. */
export interface DailyBrief extends AdPlan {
  /** The Baghdad date it was made for (YYYY-MM-DD). */
  date: string;
  productId: string | null;
  /** A reason to act today rather than later (an occasion, low stock). */
  urgent: boolean;
  /** Things this video must not do (said last time, off-season, a claim the shop cannot back). */
  avoid: string[];
  /** A few words of mood for the look, for example "warm, festive". */
  lookMood: string;
  boost: { worth: boolean; cities: string[]; note: string };
  source: "model" | "rules";
  model: string;
  /** When it was made (ms since the epoch): the page does not let it be remade within a minute and a half. */
  madeAt?: number;
}

export interface AdScene {
  type: SceneType;
  /** On screen: a few words. */
  text: string;
  /** On screen, small, under the text (a short line; never a price: prices come from the shop's data). */
  sub: string | null;
  /** Spoken by the voice, in the video's language: no digits. */
  voice: string;
  /** value scenes: a Lucide icon. */
  icon: AdIcon | null;
  /**
   * product scenes: which of the photos (0-based). A story scene may use one as its backdrop; a story's hook may too, and
   * there the photo is set by prepare from Wikimedia Commons (never by the writer) and lives in the render props only.
   */
  photo: number | null;
  /** footage scenes: which of the owner's own clips (0-based). A story scene may use one as its backdrop (a clip wins over a photo). */
  clip: number | null;
  /**
   * A documented story's hook and beats: 1 to 3 word Wikimedia Commons search phrases for the photograph that fits the beat
   * (at most 4, Latin letters, English first). Only a real-mode story's writer gives them; they are never drawn or spoken.
   */
  queries?: string[];
  /** A documented story's hook and beats: what the photograph shows, a few words. Never drawn or spoken. */
  visual?: string | null;
}

/**
 * What a story is about, for the owner to read on the card. A real story's subject is set by CODE (src/lib/advideo/subject.ts:
 * the case the owner named and Wikipedia confirmed, or one the system chose), never by the model.
 */
export interface StorySubject {
  /** Latin letters; for a real story the title of its English Wikipedia article. */
  name: string;
  /** real: told from what is documented; fiction: an invented story. */
  kind: "real" | "fiction";
  /** real: the title of the English Wikipedia article the story was told from. Absent when no article could be read. */
  wiki?: string;
  /** real: the article's address, https://en.wikipedia.org/wiki/... Absent with `wiki`. */
  url?: string;
  /** True when the system chose the case (the owner named none); absent when the owner named it. */
  chosen?: boolean;
  /** real: "File:..." titles of the pictures used in the article (at most 40), the first pool the photograph finder judges. */
  images?: string[];
  /**
   * True when NO article was read: the story was told from what the writer knows (Wikipedia could not be reached, or the article was
   * too short). Then `wiki` and `url` are absent (a source link is shown only for an article that was read), and the card says plainly
   * that the story was told from memory and its facts must be checked.
   */
  fromMemory?: true;
  /** True when the case is recent or may involve people who are alive: the writer was told to name no individual suspect. */
  recent?: true;
  /**
   * The years the case covers, read from its article by the code (see caseEra in subject.ts): a photograph whose own text names a year
   * well after `to` is a modern one and is not used. Only written when the article names years from 1000 on; absent = the script's own years.
   */
  era?: { from: number; to: number };
}

/** What a story or an ad is published with when it goes to YouTube: the owner's own declarations (never guessed). */
export interface YouTubeChoice {
  privacy: "public" | "unlisted" | "private";
  madeForKids: boolean;
}

export interface AdSpec {
  style: AdStyle;
  look: AdLook;
  scenes: AdScene[];
  /** The post text that goes with the video. */
  caption: string;
  plan?: AdPlan;
  /** The language of the whole video; absent = Sorani ("ckb"). */
  lang?: VideoLang;
  /** What the video is; absent = an ad. */
  kind?: VideoKind;
  /** A story's subject (every story, in every language). Absent for an ad. */
  subject?: StorySubject;
  /** The photographs shown behind a documented story's beats, with the author and licence of each. */
  credits?: PhotoCredit[];
  /** Written ONLY when the owner switched the Wikimedia Commons photographs off for this story; absent = photographs on. */
  noPhotos?: true;
  /** Written ONLY when the story was made LITERALLY (the owner's words exactly as typed, no review and no page knowledge); absent = page-aware. */
  literal?: true;
  /**
   * Written ONLY for a story the owner asked to be WIDE (16:9, for YouTube); absent = vertical 9:16. An ad is always vertical and never
   * carries it. The renderer draws 1920x1080 for it.
   */
  format?: "wide";
  /**
   * Written ONLY when the owner's OWN words asked for fiction (decided once, from what he typed, before any review); absent = a real
   * story. A reader of the spec stub gives it to storyModeOf, so a rewritten topic never turns a real story into an invented one.
   */
  fiction?: true;
  /**
   * Written ONLY for a job that is to be published to YouTube (the owner's declarations of who may see it and whether it is made for
   * children); absent = the video is not for YouTube. Publishing to YouTube without both answers is never done.
   */
  youtube?: YouTubeChoice;
}

export const LIMITS = {
  scenesMin: 3,
  scenesMax: 8,
  textWords: 5,
  subWords: 8,
  voiceWords: 16,
  /** All the spoken words of one ad: about 35 seconds of voice. A longer ad costs more voice and more render time and is watched less. */
  voiceTotalWords: 80,
  caption: 500,
  why: 300,
} as const;

/**
 * A story video (content, not an ad): more and longer beats, because a story needs room. About 60 to 70 seconds
 * of voice, inside the 90 seconds a Reel may last; the words that fit in that time differ by language.
 */
export const STORY_LIMITS = {
  scenesMin: 4,
  scenesMax: 10,
  textWords: 5,
  subWords: 8,
  voiceWords: 32,
  voiceTotalWords: { en: 165, ar: 150, ckb: 135 },
  caption: 700,
  why: 300,
} as const;

export interface VideoLimits {
  scenesMin: number;
  scenesMax: number;
  textWords: number;
  subWords: number;
  voiceWords: number;
  voiceTotalWords: number;
  caption: number;
  why: number;
}

/** The size limits of a video of this kind and language (ads: LIMITS, whatever the language). */
export function limitsFor(kind: VideoKind = "ad", lang: VideoLang = "ckb"): VideoLimits {
  if (kind === "story") return { ...STORY_LIMITS, voiceTotalWords: STORY_LIMITS.voiceTotalWords[lang] };
  return { ...LIMITS };
}

const hasDigit = (s: string) => /\p{Nd}/u.test(s.normalize("NFKC"));
/** Any letter of the Arabic script (Arabic, Sorani and Persian letters alike): English lines must have none. */
const hasArabicLetters = (s: string) => /\p{Script=Arabic}/u.test(s);

// ---- claims: prices, discounts and links are never the model's to write ----------------------------------
// They come from the shop's own data or from the owner's own words. The prompt says so; this is the check
// that makes it true, because the caption of a video may be posted with nobody reading it first.

/** Sorani and Arabic stems that announce a price, a discount or something free. */
const CLAIM_STEMS = ["هەزار", "ملیۆن", "داشکان", "خۆڕایی", "بەلاش", "بێبەرامبەر", "نیوە نرخ", "نیو نرخ", "تخفيض", "مجاني", "مجانا", "نصف السعر", "خصم"];
/** Short Arabic words that would be false hits as stems; matched as whole words. */
const CLAIM_WORDS = new Set(["ألف", "الف", "آلاف", "مئة", "مائة"]);
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|iq|me|io|app|shop|store|krd)\b)/i;

const asciiDigits = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** English words that announce a price, a discount or something free; whole words only ("freedom" is fine). */
const EN_CLAIM = /\b(?:free|discounts?|discounted|sales?|thousands?|millions?|hundreds?|per ?cent|half[- ]price)\b/g;
const enClaimKey = (w: string) => w.replace(/[- ]+/g, " ").replace(/^per cent$/, "percent");

export interface ClaimOptions {
  /** The language of the text (English adds the English price words). */
  lang?: VideoLang;
  /**
   * A story has no price to protect: its price, discount, "free" and "thousand" words are ordinary fiction words
   * (in Arabic "خصم" is an opponent), so none of those checks is applied. Its on-screen text is checked for links only
   * (a year is a number), its spoken line (spoken: true) for digits and links.
   */
  kind?: VideoKind;
  /** A story's spoken line: its digits are refused too (only its link and digits are checked, never the price words). */
  spoken?: boolean;
}

/** What the claim check found: the kinds of claim, and (for a price word) the words that were refused. */
export interface ClaimReport {
  problems: string[];
  /** The refused price or discount words as they stand in the text, so the director can be told which one to change. */
  words: string[];
}

const PRICE_WORD = "a price or discount word";
const WORD_SPLIT = /[\s.,;:!?،؛()«»"']+/;

/**
 * What in these texts claims a number, a percentage, a link or a discount that is not in `allowed` (the
 * owner's own request, the brand and product names and the price line the shop's data gives), and which
 * words were refused.
 */
export function claimReport(texts: string[], allowed: string, o: ClaimOptions = {}): ClaimReport {
  const allow = asciiDigits(allowed).toLowerCase();
  const allowNumbers = new Set(allow.match(/\d+/g) ?? []);
  const allowWords = new Set(allow.split(WORD_SPLIT).filter(Boolean));
  const allowEn = new Set((allow.match(EN_CLAIM) ?? []).map(enClaimKey));
  const story = o.kind === "story";
  const found = new Set<string>();
  const refused = new Set<string>();
  for (const raw of texts) {
    // Hashtags are the post's tags, not claims.
    const text = asciiDigits(raw.replace(/#[^\s#]+/g, " ")).toLowerCase();
    if (!story || o.spoken) {
      for (const n of text.match(/\d+/g) ?? []) if (!allowNumbers.has(n)) found.add("a number");
    }
    if (!story && /[%٪]/.test(text) && !/[%٪]/.test(allow)) found.add("a percentage");
    if (LINK.test(text) && !LINK.test(allow)) found.add("a link");
    if (story) continue;
    const tokens = text.split(WORD_SPLIT).filter(Boolean);
    for (const stem of CLAIM_STEMS) {
      if (text.includes(stem) && !allow.includes(stem)) {
        found.add(PRICE_WORD);
        refused.add(tokens.find((t) => t.includes(stem)) ?? stem);
      }
    }
    for (const w of tokens) {
      if (CLAIM_WORDS.has(w) && !allowWords.has(w)) {
        found.add(PRICE_WORD);
        refused.add(w);
      }
    }
    if (o.lang === "en") {
      for (const m of text.matchAll(EN_CLAIM)) {
        if (!allowEn.has(enClaimKey(m[0]))) {
          found.add(PRICE_WORD);
          refused.add(m[0]);
        }
      }
    }
  }
  return { problems: [...found], words: [...refused] };
}

/** The kinds of claim found in these texts (see claimReport). */
export function claimProblems(texts: string[], allowed: string, o: ClaimOptions = {}): string[] {
  return claimReport(texts, allowed, o).problems;
}

const unionReports = (...rs: ClaimReport[]): ClaimReport => ({
  problems: [...new Set(rs.flatMap((r) => r.problems))],
  words: [...new Set(rs.flatMap((r) => r.words))],
});

/** The claims in words for an error message, naming the refused word: `a price or discount word ("free")`. */
export function describeClaims(r: ClaimReport): string {
  return r.problems
    .map((p) => (p === PRICE_WORD && r.words.length ? `${p} (${r.words.slice(0, 4).map((w) => `"${w}"`).join(", ")})` : p))
    .join(" and ");
}
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clean = (v: unknown, maxWords: number, maxChars = 120): string => {
  if (typeof v !== "string") return "";
  const w = words(v.replace(/[\r\n]+/g, " "));
  return Array.from(w.slice(0, maxWords).join(" ")).slice(0, maxChars).join("").trim();
};

export interface NormalizeOptions {
  /** How many photos the ad may show (the product's, then the owner's references). */
  photos: number;
  /** How many of the owner's own video clips the ad may use. */
  clips?: number;
  /** The owner asked for something specific (an offer, an occasion): an offer scene may exist. */
  hasTopic: boolean;
  /** Scenes the tier may use. */
  maxScenes: number;
  /** Seed of the day for the look when the model gives none (brand + date). */
  seed?: string;
  /** Looks used lately: the new one is kept apart from them. */
  avoid?: AdLook[];
  /** Everything the shop's own data and the owner's words allow the texts to mention (numbers, names). */
  allowed?: string;
  /** The language of the video; absent = Sorani. English refuses any Arabic-script letter. */
  lang?: VideoLang;
  /** What the video is; absent = an ad. A story has its own scene types, limits and claim rules. */
  kind?: VideoKind;
  /**
   * How a story is told; absent = classic (every ad: nothing below applies). real: the hook and beats carry picture queries and
   * the story's subject is `subject`; fiction: the model's subject name is kept, queries are dropped.
   */
  mode?: StoryMode;
  /**
   * A real story's subject, found by the code before the writer ran (resolveStorySubject). It becomes the spec's subject as it is
   * (its kind forced to "real"); whatever subject the model gives is ignored. Without it a real story's spec has no subject.
   */
  subject?: StorySubject;
  /**
   * A story's shape: "wide" (16:9) is kept in the spec; "vertical" (the default) writes nothing. Ignored for an ad, which is always
   * vertical.
   */
  format?: "vertical" | "wide";
}

export type Normalized = { ok: true; spec: AdSpec } | { ok: false; errors: string[] };

function normalizePlan(raw: unknown): AdPlan | undefined {
  const p = (raw ?? {}) as Record<string, unknown>;
  const objective = (OBJECTIVES as readonly string[]).includes(String(p.objective)) ? (p.objective as Objective) : null;
  if (!objective) return undefined;
  const why = typeof p.why === "string" ? Array.from(p.why.trim().replace(/\s+/g, " ")).slice(0, LIMITS.why).join("") : "";
  return {
    objective,
    why,
    format: clean(p.format, 4, 40) || "showcase",
    priceMode: p.priceMode === "conversion" ? "conversion" : "engagement",
    cta: p.cta === "dm" || p.cta === "comment" ? p.cta : "whatsapp",
  };
}

/** The palettes that read as dark; a story keeps to them. */
const DARK_PALETTES: readonly AdLook["palette"][] = ["brand-dark", "duotone", "midnight"];

// ---- a documented story: the picture queries and the subject ------------------------------------------------------

/** Wikimedia Commons search phrases from the writer: cleaned, de-duplicated, at most 4. A bad one is dropped silently (it never costs a retry). */
function cleanQueries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (/[\/\\]|https?|www\./i.test(item)) continue;
    const q = clean(item.replace(/["“”„‟«»]/g, " "), 3, 40).replace(/^['‘’`´\s]+|['‘’`´\s]+$/g, "");
    // A phrase for a Latin-letter archive: at least one Latin letter (so not only digits) and no Arabic-script letter.
    if (!q || !/\p{Script=Latin}/u.test(q) || hasArabicLetters(q)) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 4) break;
  }
  return out;
}

/** An optional picture or clip index: a whole number inside the list, else none (a missing value is none, not the first). */
function optionalIndex(v: unknown, count: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

/**
 * Turns whatever the model returned into a spec the renderer can draw, or says what is wrong.
 * Repairs what is harmless (too many words, an icon that is not on the list, an extra scene) and
 * refuses what is not: no hook, no spoken lines, digits in speech.
 */
export function normalizeSpec(raw: unknown, o: NormalizeOptions): Normalized {
  const lang = videoLangOf(o.lang);
  const kind = videoKindOf(o.kind);
  const story = kind === "story";
  const lim = limitsFor(kind, lang);
  // How a story is told; an ad and a classic story (the default) are checked and returned exactly as they always were.
  const mode: StoryMode = story ? (o.mode ?? "classic") : "classic";
  const errors: string[] = [];
  const r = (raw ?? {}) as { style?: unknown; look?: unknown; plan?: unknown; scenes?: unknown; caption?: unknown; subject?: unknown };
  const list = Array.isArray(r.scenes) ? r.scenes : [];
  const clips = o.clips ?? 0;
  const scenes: AdScene[] = [];
  for (const item of list) {
    const s = (item ?? {}) as Record<string, unknown>;
    const type = KIND_SCENE_TYPES[kind].includes(s.type as SceneType) ? (s.type as SceneType) : null;
    if (!type) continue;
    // A product scene needs a photo to show, a footage scene a clip, and an offer scene the owner's own words to be about.
    if (type === "product" && o.photos < 1) continue;
    if (type === "footage" && clips < 1) continue;
    if (type === "offer" && !o.hasTopic) continue;
    const voice = clean(s.voice, lim.voiceWords, story ? 400 : 220);
    const text = clean(s.text, lim.textWords, 60);
    const sub = clean(s.sub, lim.subWords, 90);
    if (!voice) {
      errors.push(`scene ${scenes.length + 1} (${type}) has no spoken line`);
      continue;
    }
    if (hasDigit(voice)) {
      errors.push(`scene ${scenes.length + 1} (${type}): the spoken line has digits; write numbers as words or leave them out`);
      continue;
    }
    if (lang === "en" && [text, sub, voice].some(hasArabicLetters)) {
      errors.push(`scene ${scenes.length + 1} (${type}) has Arabic-script letters but this video is in English: write every word, name and brand in Latin letters`);
      continue;
    }
    // A story has no price to protect: its on-screen text may hold a year, and only a link (or a digit in the spoken line)
    // is refused; "free", "sale" or "a thousand" are ordinary words of a tale.
    const claims = story
      ? unionReports(claimReport([text, sub], o.allowed ?? "", { lang, kind }), claimReport([voice], o.allowed ?? "", { lang, kind, spoken: true }))
      : claimReport([text, sub, voice], o.allowed ?? "", { lang });
    if (claims.problems.length) {
      errors.push(
        story
          ? `scene ${scenes.length + 1} (${type}) mentions ${describeClaims(claims)}: leave it out`
          : `scene ${scenes.length + 1} (${type}) mentions ${describeClaims(claims)}: leave out numbers, prices, discounts and links unless the owner's request states them`,
      );
      continue;
    }
    if (type !== "product" && type !== "footage" && !text) {
      errors.push(`scene ${scenes.length + 1} (${type}) has no on-screen text`);
      continue;
    }
    let photo: number | null = null;
    if (type === "product") {
      const n = Number(s.photo);
      photo = Number.isInteger(n) && n >= 0 && n < o.photos ? n : scenes.filter((x) => x.type === "product").length % o.photos;
    }
    let clip: number | null = null;
    if (type === "footage") {
      const n = Number(s.clip);
      clip = Number.isInteger(n) && n >= 0 && n < clips ? n : scenes.filter((x) => x.type === "footage").length % clips;
    }
    // A story beat may sit over one of the owner's pictures or clips; an index that is not there means no backdrop.
    if (type === "story") {
      photo = optionalIndex(s.photo, o.photos);
      clip = optionalIndex(s.clip, clips);
    }
    const icon = (AD_ICONS as readonly string[]).includes(String(s.icon)) ? (s.icon as AdIcon) : null;
    // A documented story's hook and beats carry the phrases a photograph is searched with (a fiction has none: nothing to look up).
    const pictured = mode === "real" && (type === "hook" || type === "story");
    const queries = pictured ? cleanQueries(s.queries) : [];
    const visual = pictured ? clean(s.visual, 12, 120) : "";
    scenes.push({
      type,
      text,
      sub: sub || null,
      voice,
      icon: type === "value" ? icon ?? "sparkles" : null,
      photo,
      clip,
      ...(queries.length ? { queries } : {}),
      ...(visual ? { visual } : {}),
    });
  }

  // A fiction may name its own subject (an invention, so nothing to check it against). A documented story's subject is NOT the
  // model's to name: the code found the case (and its source) before the writer ran, and `o.subject` is what is kept.
  const givenName = mode === "fiction" ? clean(typeof r.subject === "string" ? r.subject : (r.subject as { name?: unknown } | null | undefined)?.name, 10, 100) : "";

  // One hook first and one call to action last, whatever order the model gave.
  const hook = scenes.find((s) => s.type === "hook");
  const cta = [...scenes].reverse().find((s) => s.type === "cta");
  if (!hook) errors.push("no hook scene");
  if (!cta) errors.push("no call-to-action scene");
  if (errors.length) return { ok: false, errors };

  const middle = scenes.filter((s) => s !== hook && s !== cta && s.type !== "hook" && s.type !== "cta");
  const spokenIn = (list: AdScene[]) => list.reduce((n, sc) => n + words(sc.voice).length, 0);
  // A story is never cut to fit its time: dropping beats from the back would delete its turn and its ending and leave a plot
  // that stops before the closing invitation. A story over its words goes back to the director, told how far over it is.
  if (story) {
    const total = spokenIn([hook!, ...middle, cta!]);
    if (total > lim.voiceTotalWords) {
      return {
        ok: false,
        errors: [`the spoken lines total ${total} words but this story may have at most ${lim.voiceTotalWords}: rewrite it shorter (fewer or shorter beats) and keep the ending`],
      };
    }
  }
  const maxScenes = story ? Math.min(o.maxScenes, lim.scenesMax) : o.maxScenes;
  // The same for the number of scenes: a story with more beats than its tier allows goes back to the director, told how many it may have.
  if (story && middle.length + 2 > maxScenes) {
    return { ok: false, errors: [`the story has ${middle.length + 2} scenes but at most ${maxScenes} are allowed: merge or shorten the beats and keep the ending`] };
  }
  const ordered = [hook!, ...middle.slice(0, Math.max(0, maxScenes - 2)), cta!];
  // An ad has a time limit: scenes are dropped from the back of the middle until the spoken words fit. The owner's own
  // offer, a product and the owner's clips stay; the plain value scenes go first, last ones first.
  while (!story && spokenIn(ordered) > lim.voiceTotalWords && ordered.length > lim.scenesMin) {
    let drop = -1;
    for (let k = ordered.length - 2; k >= 1; k--) {
      if (ordered[k].type === "value") {
        drop = k;
        break;
      }
    }
    ordered.splice(drop >= 0 ? drop : ordered.length - 2, 1);
  }
  if (ordered.length < lim.scenesMin) return { ok: false, errors: [`only ${ordered.length} usable scenes; at least ${lim.scenesMin} are needed`] };

  const caption = typeof r.caption === "string" ? Array.from(r.caption.trim()).slice(0, lim.caption).join("") : "";
  if (!caption) return { ok: false, errors: ["no post caption"] };
  if (lang === "en" && hasArabicLetters(caption)) {
    return { ok: false, errors: ["the post caption has Arabic-script letters but this video is in English: write it, with its hashtags, in Latin letters"] };
  }
  const captionClaims = claimReport([caption], o.allowed ?? "", { lang, kind });
  if (captionClaims.problems.length) {
    return {
      ok: false,
      errors: [
        story
          ? `the post caption mentions ${describeClaims(captionClaims)}: leave it out`
          : `the post caption mentions ${describeClaims(captionClaims)}: leave out numbers, prices, discounts and links unless the owner's request states them`,
      ],
    };
  }
  const look = normalizeLook(r.look, o.seed ?? "default", o.avoid ?? []);
  // A look that is nearly the same as a recent one is moved: the point of a daily video is that it is not the last one.
  const avoided = (o.avoid ?? []).some((a) => lookDistance(a, look) >= 6);
  const moved = avoided ? lookFromSeed(`${o.seed ?? "default"}!`, o.avoid ?? []) : look;
  // A story is dark and moody: a light palette (the seed's choice when the model gave none) becomes midnight.
  const finalLook = story && !DARK_PALETTES.includes(moved.palette) ? { ...moved, palette: "midnight" as const } : moved;
  const style = AD_STYLES.includes(r.style as AdStyle) && r.look === undefined ? (r.style as AdStyle) : styleOf(finalLook);
  // The subject's kind is the code's, not the model's: a documented story is real, a fiction is fiction.
  const subject: StorySubject | undefined =
    mode === "real"
      ? o.subject
        ? { ...o.subject, kind: "real", ...(o.subject.images ? { images: o.subject.images.slice(0, 40) } : {}) }
        : undefined
      : mode === "fiction"
        ? { name: givenName || hook!.text, kind: "fiction" }
        : undefined;
  // The shape is the caller's choice (the owner's), never the model's: only a story can be wide, and an ad never carries the key.
  const wide = story && o.format === "wide";
  return {
    ok: true,
    spec: { style, look: finalLook, scenes: ordered, caption, plan: story ? undefined : normalizePlan(r.plan), ...langFields(lang, kind), ...(subject ? { subject } : {}), ...(wide ? { format: "wide" as const } : {}) },
  };
}
