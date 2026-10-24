// What the Video form shows and sends for a story. A plain module (no "use server", no browser code) so the form, the action and the tests
// read the same rule.
//
// Every story, in every video language (Sorani, Arabic, English), is a short documentary told from ONE real, well-documented case: the one
// the owner names, or, when the idea names none, one Gituas chooses itself. The owner is never asked to name a case.
//
//   fiction    the idea asks for an invented story (the word fiction, or its Arabic and Sorani forms): told as fiction, no real photographs,
//              so the form shows a note instead of the photo switch.
//   realStory  the rest: told from what is documented, with photographs from Wikimedia Commons where free ones are found; this is the
//              only story with the photo switch, and the only one that sends the owner's choice.
//
// A story also has a SHAPE: vertical 9:16 (the default, for Reels) or wide 16:9 (for YouTube). Only a story has the choice; an ad is always
// vertical and never sends one.

import { storyFictionAsked, type VideoKind, type VideoLang } from "@/lib/advideo/lang";

/** A story is told from the owner's idea: this is the least it needs (the action checks the same). A short word is enough: "Titanic". */
export const STORY_MIN = 4;

export interface StoryForm {
  story: boolean;
  fiction: boolean;
  realStory: boolean;
}

export function storyFormOf(kind: VideoKind, topic: string): StoryForm {
  const story = kind === "story";
  const fiction = story && storyFictionAsked(topic);
  return { story, fiction, realStory: story && !fiction };
}

/** The `photos` field of createVideoAction: only a story about a real case sends the owner's choice; an ad and a fiction send none. */
export function photosField(form: StoryForm, photos: boolean): { photos?: boolean } {
  return form.realStory ? { photos } : {};
}

/** The shape of a video: vertical 9:16 (Reels, the default) or wide 16:9 (YouTube; stories only). */
export type VideoFormat = "vertical" | "wide";

export const VIDEO_FORMATS: readonly VideoFormat[] = ["vertical", "wide"];

export function isVideoFormat(v: unknown): v is VideoFormat {
  return v === "vertical" || v === "wide";
}

/** The `format` field of createVideoAction: only a story sends its shape; an ad is always vertical and sends none. */
export function formatField(form: StoryForm, format: VideoFormat): { format?: VideoFormat } {
  return form.story ? { format } : {};
}

/**
 * What a video started from here really is, read back from the stored job (its spec stub) and not from what was asked: the chat repeats
 * exactly this to the owner, so it can never claim a shape, a language or a photograph the job does not have.
 */
export interface VideoFacts {
  lang: VideoLang;
  kind: VideoKind;
  /** "wide" only for a story that was made wide; everything else is vertical. */
  format: VideoFormat;
  /** A story only: photographs from Wikimedia Commons where free ones are found (on), switched off by the owner (off), or none because it is fiction. */
  photos?: "on" | "off" | "fiction";
}

/** The shortest idea a story can be told from, in characters (letters of any script, not UTF-16 units). */
export const storyTooShort = (topic: string): boolean => Array.from(topic.trim()).length < STORY_MIN;

/**
 * The text the owner copies for a finished story: its caption, then the photo credits with the Commons page of each file (the licence and the
 * author travel with the video wherever it is posted or uploaded). The caption already carries a short credit line; this adds the pages.
 */
export function captionWithCredits(job: { caption: string | null; credits?: { title: string; author: string | null; licence: string; page: string }[] }, creditsLabel: string): string {
  const parts: string[] = [];
  if (job.caption?.trim()) parts.push(job.caption.trim());
  if (job.credits && job.credits.length > 0) {
    parts.push(`${creditsLabel}:\n${job.credits.map((c) => `- ${c.title}${c.author ? ` - ${c.author}` : ""} - ${c.licence} - ${c.page}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * The time the script and voice of a video started now may use (epoch ms), so that the function that hosts them is never killed in the middle of
 * a paid call. The Video screen's own action has 55 s from its start. The chat's turn runs inside the same 60 s function, and its deadline is
 * `turnMs` after the function started: what is left after the chat's deadline is only a few seconds, and nothing may run past 57 s from the start
 * of the function.
 */
export function prepareDeadline(requestStart: number, chatDeadline?: number, turnMs = 50_000): number {
  const own = requestStart + 55_000;
  if (typeof chatDeadline !== "number" || !Number.isFinite(chatDeadline)) return own;
  const functionStart = chatDeadline - turnMs;
  return Math.min(own, chatDeadline + 5_000, functionStart + 57_000);
}

/** What a finished story shows besides the video: the case, whether it was told from a read article, whether it is very recent, and the photo credits. */
export interface StoryStatusView {
  subject: string | null;
  /** The English Wikipedia article the case was told from: only when it was really read (a story told from memory has none). */
  subjectUrl: string | null;
  chosen: boolean;
  fromMemory: boolean;
  recent: boolean;
  fiction: boolean;
  wide: boolean;
  /** Why the story was not posted by itself when it was meant to be, in the owner's words (null: it was not held back). */
  waited: string | null;
  credits: { title: string; author: string | null; licence: string; page: string }[];
}

const WIKIPEDIA_ARTICLE = /^https:\/\/en\.wikipedia\.org\/wiki\//;

/** The story facts of a stored job's spec (never throws; a spec that is not what it should be reads as a story about nothing). */
export function subjectViewOf(rawSpec: unknown): Pick<StoryStatusView, "subject" | "subjectUrl" | "chosen" | "fromMemory" | "recent" | "fiction"> {
  const spec = (rawSpec && typeof rawSpec === "object" ? rawSpec : {}) as { subject?: { name?: unknown; kind?: unknown; url?: unknown; chosen?: unknown; fromMemory?: unknown; recent?: unknown } };
  const s = spec.subject ?? {};
  const subject = typeof s.name === "string" && s.name.trim() ? s.name.trim() : null;
  const url = typeof s.url === "string" && WIKIPEDIA_ARTICLE.test(s.url.trim()) ? s.url.trim() : null;
  const fromMemory = !!subject && s.fromMemory === true;
  return {
    subject,
    subjectUrl: subject && url && !fromMemory ? url : null,
    chosen: !!subject && s.chosen === true,
    fromMemory,
    recent: !!subject && s.recent === true,
    fiction: s.kind === "fiction",
  };
}

/** The letters of the three scripts are compared in one form (Arabic yeh and kaf become the Persian ones the Sorani letters use). */
const squash = (text: string): string => text.toLowerCase().replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک");

/**
 * Whether one of these words stands alone in the text (not inside a longer word of any script). A word of the Arabic script may carry the small
 * prefixes that stick to it (the article and the joining letters: "al-youtube"), as the owner writes them.
 */
function hasWord(text: string, list: readonly string[]): boolean {
  return list.some((w) => {
    const prefix = /^[a-z0-9]/.test(w) ? "" : "(?:\\u0627\\u0644|\\u0644\\u0644|\\u0648\\u0627\\u0644|\\u0628\\u0627\\u0644|\\u0641\\u0627\\u0644|\\u0648|\\u0628|\\u0644|\\u0641)?";
    return new RegExp("(?<![\\p{L}\\p{N}])" + prefix + w + "(?![\\p{L}\\p{N}])", "u").test(text);
  });
}

/** The name of YouTube in the three scripts: distinctive enough to be found inside a longer word (a suffix or a prefix sticks to it in Sorani and Arabic). */
const YOUTUBE_NAMES = ["youtube", "youtu.be", "یوتیوب", "یوتوب"];
const WIDE_WORDS = ["16\\s*[:x×]\\s*9", "wide", "widescreen", "landscape", "horizontal", "عریض", "افقی", "أفقی", "ئاسۆیی", "پان"];
const VERTICAL_WORDS = ["vertical", "9\\s*[:x×]\\s*16", "reels?", "tiktok", "ستوونی", "ڕیلز", "ریلز", "عمودی", "طولی"];

/**
 * Whether the owner's recent words ask for a wide (16:9, for YouTube) video: they mention YouTube, 16:9, wide, landscape or horizontal (in English,
 * Arabic or Sorani) and do not ask for a vertical one. The chat sets a story wide by itself in that case and says so on the card; it never fights
 * an explicit wish for the vertical shape.
 */
export function wantsWide(text: string): boolean {
  const t = squash(text);
  const wide = YOUTUBE_NAMES.some((n) => t.includes(n)) || hasWord(t, WIDE_WORDS);
  return wide && !hasWord(t, VERTICAL_WORDS);
}

/**
 * The address that makes a browser SAVE the video. The browser ignores the `download` attribute of a link to another origin, and a finished video
 * lives at a Vercel Blob address; Blob sends it as an attachment when the address carries download=1. Any other address is returned as it is.
 */
export function downloadHref(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com")) {
      u.searchParams.set("download", "1");
      return u.toString();
    }
  } catch {
    /* not an address: left as it is */
  }
  return url;
}
