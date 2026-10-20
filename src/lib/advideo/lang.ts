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
