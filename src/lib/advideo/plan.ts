// The daily routine's plan: what the owner asked for when he said "every day make me a video in this style and publish it".
//
// It is stored on the store (Store.videoAutoPlan, a Json column) next to the old switches (videoAutoMode: OFF | DRAFT | PUBLISH,
// videoAutoTier, videoAutoHour). The plan carries HIS OWN WORDS and choices: the idea verbatim, the kind of video (story or ad), the
// shape, whether Gituas may read the page first (review) or must use his words exactly as written, whether real photographs are looked
// for, and the platforms the video goes to by itself. Mode PUBLISH means "publish to plan.targets automatically"; DRAFT means "make it
// and keep it for reading". A store without a plan keeps exactly the behaviour it always had.
//
// Pure module (no database, no network): the chat tool, the Video screen and the clock all read the same plan through
// parseVideoAutoPlan, which is tolerant (it clamps, drops what is not valid and never throws) and never guesses the owner's
// YouTube declarations (who may see the video, whether it is made for children): without both, YouTube is dropped from the plan.

import type { VideoLang } from "./lang";

export type VideoPlanTarget = "FB" | "IG" | "YT";

export type VideoAutoPlan = {
  /** The owner's words verbatim (trimmed, at most 600 characters); may be empty for "the usual". */
  brief: string;
  kind: "story" | "ad";
  /** A story only: the 16:9 shape for YouTube (an ad is always vertical). */
  format?: "wide";
  /** True = Gituas reads the page and rewrites the idea first; false = the owner's words go straight to the video maker (literal). */
  review: boolean;
  /** A story only in effect: real photographs behind the beats. */
  photos: boolean;
  /** What the video is published to by itself; empty = it is only kept as a draft. */
  targets: VideoPlanTarget[];
  /** The owner's declarations; present exactly when `targets` has "YT". */
  youtube?: { privacy: "public" | "unlisted" | "private"; madeForKids: boolean };
};

/** The most characters of the owner's words a plan keeps. */
export const PLAN_BRIEF_MAX = 600;

const TARGET_ORDER: readonly VideoPlanTarget[] = ["FB", "IG", "YT"];
const PRIVACY = ["public", "unlisted", "private"] as const;

/** Control characters other than a tab or a line break are not part of anyone's words. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** The owner's words, trimmed and cut at PLAN_BRIEF_MAX characters (code points, so no letter is split). */
export function planBrief(text: unknown): string {
  if (typeof text !== "string") return "";
  return Array.from(text.replace(CONTROL, "").trim()).slice(0, PLAN_BRIEF_MAX).join("").trim();
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Reads a stored plan. Null for anything that is not a plan (nothing stored, not an object, a kind that is neither story nor ad). It is
 * tolerant: the words are clamped, a shape other than wide (or any shape of an ad) is dropped, platforms that are not Facebook,
 * Instagram or YouTube are dropped, and YouTube is dropped as well when the owner's two declarations are not both there.
 */
export function parseVideoAutoPlan(raw: unknown): VideoAutoPlan | null {
  const r = asRecord(raw);
  if (!r) return null;
  const kind = r.kind === "story" || r.kind === "ad" ? r.kind : null;
  if (!kind) return null;
  const wanted = new Set<VideoPlanTarget>();
  if (Array.isArray(r.targets)) for (const t of r.targets) if (typeof t === "string" && (TARGET_ORDER as readonly string[]).includes(t)) wanted.add(t as VideoPlanTarget);
  const yt = asRecord(r.youtube);
  const youtube =
    wanted.has("YT") && yt && (PRIVACY as readonly unknown[]).includes(yt.privacy) && typeof yt.madeForKids === "boolean"
      ? { privacy: yt.privacy as (typeof PRIVACY)[number], madeForKids: yt.madeForKids }
      : null;
  // YouTube is never guessed: without both declarations it is not in the plan.
  if (!youtube) wanted.delete("YT");
  return {
    brief: planBrief(r.brief),
    kind,
    ...(kind === "story" && r.format === "wide" ? { format: "wide" as const } : {}),
    review: r.review === true,
    photos: r.photos !== false,
    targets: TARGET_ORDER.filter((t) => wanted.has(t)),
    ...(youtube ? { youtube } : {}),
  };
}

// ---- one plain line for a card or a screen ----------------------------------------------------------------------------------

interface LineWords {
  story: string;
  ad: string;
  wide: string;
  vertical: string;
  usual: string;
  exact: string;
  reads: string;
  names: Record<VideoPlanTarget, string>;
  draft: string;
  and: string;
  /** How the idea is quoted. */
  quote: (s: string) => string;
}

const WORDS: Record<VideoLang, LineWords> = {
  en: {
    story: "Story video",
    ad: "Ad video",
    wide: "wide (16:9)",
    vertical: "vertical",
    usual: "the usual",
    exact: "uses exactly your words",
    reads: "Gituas reads your page first",
    names: { FB: "Facebook", IG: "Instagram", YT: "YouTube" },
    draft: "kept as a draft for you to read",
    and: " and ",
    quote: (s) => `“${s}”`,
  },
  ar: {
    story: "فيديو قصة",
    ad: "فيديو إعلان",
    wide: "عريض (16:9)",
    vertical: "عمودي",
    usual: "المعتاد",
    exact: "بكلماتك أنت كما كتبتها",
    reads: "Gituas يقرأ صفحتك أولاً",
    names: { FB: "فيسبوك", IG: "إنستغرام", YT: "يوتيوب" },
    draft: "يبقى مسودة لتقرأه",
    and: " و",
    quote: (s) => `«${s}»`,
  },
  ckb: {
    story: "ڤیدیۆی چیرۆک",
    ad: "ڤیدیۆی ڕیکلام",
    wide: "پان (16:9)",
    vertical: "ستوونی",
    usual: "ئاسایی",
    exact: "ڕێک بە وشەکانی خۆت",
    reads: "گیتواس سەرەتا پەیجەکەت دەخوێنێتەوە",
    names: { FB: "فەیسبووک", IG: "ئینستاگرام", YT: "یوتیوب" },
    draft: "وەک ڕەشنووس دەمێنێتەوە تا بیخوێنیتەوە",
    and: " و ",
    quote: (s) => `«${s}»`,
  },
};

/** The idea cut for a line (one line, at most 80 characters). */
function shortIdea(brief: string): string {
  const one = brief.replace(/\s+/g, " ").trim();
  const chars = Array.from(one);
  return chars.length > 80 ? `${chars.slice(0, 79).join("").trimEnd()}…` : one;
}

/**
 * One plain line about a plan, for a card or a screen: the idea in the owner's words, the kind and the shape, whether his words are
 * used exactly, and where the video goes. (A screen or a card may use its own dictionary instead.) The hour is not part of the plan.
 */
export function planLine(plan: VideoAutoPlan, lang: VideoLang): string {
  const w = WORDS[lang] ?? WORDS.ckb;
  const idea = plan.brief ? w.quote(shortIdea(plan.brief)) : w.usual;
  const names = plan.targets.map((t) => w.names[t]);
  const where = names.length ? names.join(names.length === 2 ? w.and : ", ") : w.draft;
  const shape = plan.kind === "story" ? (plan.format === "wide" ? w.wide : w.vertical) : w.vertical;
  return `${plan.kind === "story" ? w.story : w.ad}, ${shape}: ${idea}; ${plan.review ? w.reads : w.exact}; ${where}`;
}
