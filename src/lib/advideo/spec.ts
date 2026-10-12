// The script of an AI video ad: what the director model writes and the renderer (adfilm/) draws.
// The model only fills this shape; it never writes drawing code. Everything it gives is checked and
// cut to size here, and anything outside the vocabulary (an unknown icon, a photo that does not
// exist, digits in a spoken line) is dropped or repaired before the job goes on.

export type SceneType = "hook" | "value" | "product" | "offer" | "cta";
export const SCENE_TYPES: readonly SceneType[] = ["hook", "value", "product", "offer", "cta"];

/** Looks the renderer knows. The brand's own colours come from its Brand kit whatever the style. */
export type AdStyle = "elegant" | "bold" | "clean";
export const AD_STYLES: readonly AdStyle[] = ["elegant", "bold", "clean"];

/** Lucide icon names the renderer ships (adfilm/assets/icons), kept to ones that read well for a shop. */
export const AD_ICONS = [
  "gem", "shield-check", "heart-handshake", "sparkles", "truck", "badge-check", "star", "clock", "leaf",
  "gift", "thumbs-up", "crown", "zap", "smile", "package", "map-pin", "phone-call", "heart", "award", "flame",
] as const;
export type AdIcon = (typeof AD_ICONS)[number];

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
  /** product scenes: which of the product's photos (0-based). */
  photo: number | null;
}

export interface AdSpec {
  style: AdStyle;
  scenes: AdScene[];
  /** The post text that goes with the video. */
  caption: string;
}

export const LIMITS = {
  scenesMin: 3,
  scenesMax: 7,
  textWords: 5,
  subWords: 8,
  voiceWords: 16,
  caption: 500,
} as const;

const hasDigit = (s: string) => /[0-9٠-٩۰-۹]/.test(s);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clean = (v: unknown, maxWords: number, maxChars = 120): string => {
  if (typeof v !== "string") return "";
  const w = words(v.replace(/[\r\n]+/g, " "));
  return Array.from(w.slice(0, maxWords).join(" ")).slice(0, maxChars).join("").trim();
};

export interface NormalizeOptions {
  /** How many photos the product (or shop) has: a product scene needs one. */
  photos: number;
  /** The owner asked for something specific (an offer, an occasion): an offer scene may exist. */
  hasTopic: boolean;
  /** Scenes the tier may use. */
  maxScenes: number;
}

export type Normalized = { ok: true; spec: AdSpec } | { ok: false; errors: string[] };

/**
 * Turns whatever the model returned into a spec the renderer can draw, or says what is wrong.
 * Repairs what is harmless (too many words, an icon that is not on the list, an extra scene) and
 * refuses what is not: no hook, no spoken lines, digits in speech.
 */
export function normalizeSpec(raw: unknown, o: NormalizeOptions): Normalized {
  const errors: string[] = [];
  const r = (raw ?? {}) as { style?: unknown; scenes?: unknown; caption?: unknown };
  const list = Array.isArray(r.scenes) ? r.scenes : [];
  const scenes: AdScene[] = [];
  for (const item of list) {
    const s = (item ?? {}) as Record<string, unknown>;
    const type = SCENE_TYPES.includes(s.type as SceneType) ? (s.type as SceneType) : null;
    if (!type) continue;
    // A product scene needs a photo to show; an offer scene needs the owner's own words to be about.
    if (type === "product" && o.photos < 1) continue;
    if (type === "offer" && !o.hasTopic) continue;
    const voice = clean(s.voice, LIMITS.voiceWords, 220);
    const text = clean(s.text, LIMITS.textWords, 60);
    if (!voice) {
      errors.push(`scene ${scenes.length + 1} (${type}) has no spoken line`);
      continue;
    }
    if (hasDigit(voice)) {
      errors.push(`scene ${scenes.length + 1} (${type}): the spoken line has digits; write numbers as words or leave them out`);
      continue;
    }
    if (type !== "product" && !text) {
      errors.push(`scene ${scenes.length + 1} (${type}) has no on-screen text`);
      continue;
    }
    let photo: number | null = null;
    if (type === "product") {
      const n = Number(s.photo);
      photo = Number.isInteger(n) && n >= 0 && n < o.photos ? n : scenes.filter((x) => x.type === "product").length % o.photos;
    }
    const icon = (AD_ICONS as readonly string[]).includes(String(s.icon)) ? (s.icon as AdIcon) : null;
    scenes.push({
      type,
      text,
      sub: clean(s.sub, LIMITS.subWords, 90) || null,
      voice,
      icon: type === "value" ? icon ?? "sparkles" : null,
      photo,
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
  if (ordered.length < LIMITS.scenesMin) return { ok: false, errors: [`only ${ordered.length} usable scenes; at least ${LIMITS.scenesMin} are needed`] };

  const style = AD_STYLES.includes(r.style as AdStyle) ? (r.style as AdStyle) : "elegant";
  const caption = typeof r.caption === "string" ? Array.from(r.caption.trim()).slice(0, LIMITS.caption).join("") : "";
  if (!caption) return { ok: false, errors: ["no post caption"] };
  return { ok: true, spec: { style, scenes: ordered, caption } };
}
