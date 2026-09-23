/** Caption limits each platform enforces. Facebook's is effectively unbounded. */
export const CAPTION_LIMITS = { FB: 63206, IG: 2200, TT: 2200 } as const;
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

export function mergeHashtags(caption: string, tags: readonly string[]): string {
  const present = new Set(caption.match(HASHTAG) ?? []);
  const missing = tags.filter((t) => !present.has(t));
  return missing.length ? `${caption.trimEnd()}\n\n${missing.join(" ")}` : caption;
}
