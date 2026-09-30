/** Caption limits each platform enforces. Facebook's is effectively unbounded. YouTube's 5000 is the description limit. */
export const CAPTION_LIMITS = { FB: 63206, IG: 2200, TT: 2200, YT: 5000 } as const;
export type Target = keyof typeof CAPTION_LIMITS;

/**
 * The composite city tags Kurdish sellers use for region-wide discovery: one in
 * Kurdish script, one in Latin, so a buyer searching in either script finds it.
 */
export const CITY_TAGS = ["#کوردستان_هەولێر_سلێمانی", "#hawler_slemani_dhok_karkuk_hallabja"] as const;

const HASHTAG = /#[\p{L}\p{N}\p{M}_]+/gu;

export function captionProblems(caption: string, targets: readonly Target[]): { target: Target; problem: string }[] {
  const out: { target: Target; problem: string }[] = [];
  // Count code points, not UTF-16 units, so Kurdish text is measured the way
  // the platforms measure it.
  const length = [...caption].length;
  const tags = caption.match(HASHTAG)?.length ?? 0;
  for (const t of targets) {
    if (length > CAPTION_LIMITS[t]) out.push({ target: t, problem: "length" });
    else if (t === "IG" && tags > 30) out.push({ target: t, problem: "hashtags" });
  }
  return out;
}

export const YT_VIDEO_ONLY = "یوتیوب تەنها ڤیدیۆ وەردەگرێت.";

/** YouTube takes only a video: text alone or an image with a YT target is a problem. */
export function youtubeProblem(targets: readonly Target[], media?: { type: "IMAGE" | "VIDEO" } | null): string | null {
  return targets.includes("YT") && media?.type !== "VIDEO" ? YT_VIDEO_ONLY : null;
}

/** A YouTube title: the caption's first line, at most 100 characters (code points), or "ڤیدیۆ" when it has none. */
export function youtubeTitle(caption: string): string {
  const firstLine = caption.trim().split(/\r?\n/)[0].trim();
  return Array.from(firstLine).slice(0, 100).join("") || "ڤیدیۆ";
}

/** TikTok and Instagram photo posts accept only JPEG (WebP works for TikTok, but not Instagram). */
export function isJpegPath(pathname: string): boolean {
  return /\.jpe?g$/i.test(pathname);
}

export function mergeHashtags(caption: string, tags: readonly string[]): string {
  const present = new Set(caption.match(HASHTAG) ?? []);
  const missing = tags.filter((t) => !present.has(t));
  return missing.length ? `${caption.trimEnd()}\n\n${missing.join(" ")}` : caption;
}
