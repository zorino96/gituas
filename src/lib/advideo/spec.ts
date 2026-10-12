// The script of an AI video ad: what the director model writes and the renderer (adfilm/) draws.
// The model only fills this shape; it never writes drawing code. Everything it gives is checked and
// cut to size here, and anything outside the vocabulary (an unknown icon, a photo that does not
// exist, digits in a spoken line) is dropped or repaired before the job goes on.

export type SceneType = "hook" | "value" | "product" | "offer" | "footage" | "cta";
export const SCENE_TYPES: readonly SceneType[] = ["hook", "value", "product", "offer", "footage", "cta"];

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
  /** Spoken by the voice: Sorani, no digits. */
  voice: string;
  /** value scenes: a Lucide icon. */
  icon: AdIcon | null;
  /** product scenes: which of the photos (0-based). */
  photo: number | null;
  /** footage scenes: which of the owner's own clips (0-based). */
  clip: number | null;
}

export interface AdSpec {
  style: AdStyle;
  look: AdLook;
  scenes: AdScene[];
  /** The post text that goes with the video. */
  caption: string;
  plan?: AdPlan;
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

const hasDigit = (s: string) => /\p{Nd}/u.test(s.normalize("NFKC"));

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

/**
 * What in these texts claims a number, a percentage, a link or a discount that is not in `allowed` (the
 * owner's own request, the brand and product names and the price line the shop's data gives).
 */
export function claimProblems(texts: string[], allowed: string): string[] {
  const allow = asciiDigits(allowed).toLowerCase();
  const allowNumbers = new Set(allow.match(/\d+/g) ?? []);
  const allowWords = new Set(allow.split(/[\s.,;:!?،؛()«»"']+/).filter(Boolean));
  const found = new Set<string>();
  for (const raw of texts) {
    // Hashtags are the post's tags, not claims.
    const text = asciiDigits(raw.replace(/#[^\s#]+/g, " ")).toLowerCase();
    for (const n of text.match(/\d+/g) ?? []) if (!allowNumbers.has(n)) found.add("a number");
    if (/[%٪]/.test(text) && !/[%٪]/.test(allow)) found.add("a percentage");
    if (LINK.test(text) && !LINK.test(allow)) found.add("a link");
    for (const stem of CLAIM_STEMS) if (text.includes(stem) && !allow.includes(stem)) found.add("a price or discount word");
    for (const w of text.split(/[\s.,;:!?،؛()«»"']+/)) if (CLAIM_WORDS.has(w) && !allowWords.has(w)) found.add("a price or discount word");
  }
  return [...found];
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

/**
 * Turns whatever the model returned into a spec the renderer can draw, or says what is wrong.
 * Repairs what is harmless (too many words, an icon that is not on the list, an extra scene) and
 * refuses what is not: no hook, no spoken lines, digits in speech.
 */
export function normalizeSpec(raw: unknown, o: NormalizeOptions): Normalized {
  const errors: string[] = [];
  const r = (raw ?? {}) as { style?: unknown; look?: unknown; plan?: unknown; scenes?: unknown; caption?: unknown };
  const list = Array.isArray(r.scenes) ? r.scenes : [];
  const clips = o.clips ?? 0;
  const scenes: AdScene[] = [];
  for (const item of list) {
    const s = (item ?? {}) as Record<string, unknown>;
    const type = SCENE_TYPES.includes(s.type as SceneType) ? (s.type as SceneType) : null;
    if (!type) continue;
    // A product scene needs a photo to show, a footage scene a clip, and an offer scene the owner's own words to be about.
    if (type === "product" && o.photos < 1) continue;
    if (type === "footage" && clips < 1) continue;
    if (type === "offer" && !o.hasTopic) continue;
    const voice = clean(s.voice, LIMITS.voiceWords, 220);
    const text = clean(s.text, LIMITS.textWords, 60);
    const sub = clean(s.sub, LIMITS.subWords, 90);
    if (!voice) {
      errors.push(`scene ${scenes.length + 1} (${type}) has no spoken line`);
      continue;
    }
    if (hasDigit(voice)) {
      errors.push(`scene ${scenes.length + 1} (${type}): the spoken line has digits; write numbers as words or leave them out`);
      continue;
    }
    const claims = claimProblems([text, sub, voice], o.allowed ?? "");
    if (claims.length) {
      errors.push(`scene ${scenes.length + 1} (${type}) mentions ${claims.join(" and ")}: leave out numbers, prices, discounts and links unless the owner's request states them`);
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
    const icon = (AD_ICONS as readonly string[]).includes(String(s.icon)) ? (s.icon as AdIcon) : null;
    scenes.push({
      type,
      text,
      sub: sub || null,
      voice,
      icon: type === "value" ? icon ?? "sparkles" : null,
      photo,
      clip,
    });
  }

  // One hook first and one call to action last, whatever order the model gave.
  const hook = scenes.find((s) => s.type === "hook");
  const cta = [...scenes].reverse().find((s) => s.type === "cta");
  if (!hook) errors.push("no hook scene");
  if (!cta) errors.push("no call-to-action scene");
  if (errors.length) return { ok: false, errors };

  const middle = scenes.filter((s) => s !== hook && s !== cta && s.type !== "hook" && s.type !== "cta");
  const ordered = [hook!, ...middle.slice(0, Math.max(0, o.maxScenes - 2)), cta!];
  // A time limit: scenes are dropped from the back of the middle until the spoken words fit.
  const spoken = () => ordered.reduce((n, sc) => n + words(sc.voice).length, 0);
  while (spoken() > LIMITS.voiceTotalWords && ordered.length > LIMITS.scenesMin) {
    // The owner's own offer, a product and the owner's clips stay; the plain value scenes go first, last ones first.
    let drop = -1;
    for (let k = ordered.length - 2; k >= 1; k--) {
      if (ordered[k].type === "value") {
        drop = k;
        break;
      }
    }
    ordered.splice(drop >= 0 ? drop : ordered.length - 2, 1);
  }
  if (ordered.length < LIMITS.scenesMin) return { ok: false, errors: [`only ${ordered.length} usable scenes; at least ${LIMITS.scenesMin} are needed`] };

  const caption = typeof r.caption === "string" ? Array.from(r.caption.trim()).slice(0, LIMITS.caption).join("") : "";
  if (!caption) return { ok: false, errors: ["no post caption"] };
  const captionClaims = claimProblems([caption], o.allowed ?? "");
  if (captionClaims.length) {
    return { ok: false, errors: [`the post caption mentions ${captionClaims.join(" and ")}: leave out numbers, prices, discounts and links unless the owner's request states them`] };
  }
  const look = normalizeLook(r.look, o.seed ?? "default", o.avoid ?? []);
  // A look that is nearly the same as a recent one is moved: the point of a daily video is that it is not the last one.
  const avoided = (o.avoid ?? []).some((a) => lookDistance(a, look) >= 6);
  const finalLook = avoided ? lookFromSeed(`${o.seed ?? "default"}!`, o.avoid ?? []) : look;
  const style = AD_STYLES.includes(r.style as AdStyle) && r.look === undefined ? (r.style as AdStyle) : styleOf(finalLook);
  return { ok: true, spec: { style, look: finalLook, scenes: ordered, caption, plan: normalizePlan(r.plan) } };
}
