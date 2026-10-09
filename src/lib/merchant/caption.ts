/** Caption limits each platform enforces. Facebook's is effectively unbounded. YouTube's 5000 is the description limit. */
export const CAPTION_LIMITS = { FB: 63206, IG: 2200, TT: 2200, YT: 5000 } as const;
export type Target = keyof typeof CAPTION_LIMITS;

/** True only for a platform we publish to. A plain `in` check would also let "toString" through. */
export function isKnownTarget(t: unknown): t is Target {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(CAPTION_LIMITS, t);
}

/**
 * A file this workspace uploaded to Vercel Blob: https, a Blob host, and this workspace's own folder.
 * The URL is parsed, so dot-segments are resolved before the folder is checked. Used wherever the
 * server fetches or republishes a URL the browser sent.
 */
export function isOwnBlobUrl(raw: string, workspaceId: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com") && u.pathname.startsWith(`/merchant/${workspaceId}/`);
  } catch {
    return false;
  }
}

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

/** YouTube's privacy settings; the person picks one for every upload. */
export const YT_PRIVACY = ["public", "unlisted", "private"] as const;
export type YtPrivacy = (typeof YT_PRIVACY)[number];

/**
 * What the person sets for a YouTube upload (videos.insert snippet.title, snippet.description,
 * status.privacyStatus, status.selfDeclaredMadeForKids). Privacy and audience have no default.
 */
export interface YouTubeOptions {
  title: string;
  description: string;
  privacy: YtPrivacy | null;
  madeForKids: boolean | null;
}

export const YT_TITLE_MAX = 100;
/** YouTube counts the description in UTF-8 bytes: Kurdish and Arabic letters take two each. */
export const YT_DESCRIPTION_MAX = 5000;
export const ytDescriptionBytes = (s: string): number => new TextEncoder().encode(s).length;

/** Why YouTube would refuse these options: no title, too long, angle brackets (YouTube rejects them), or no privacy or audience chosen. */
export function youtubeOptionProblems(o: YouTubeOptions): ("title" | "description" | "brackets" | "privacy" | "audience")[] {
  const out: ("title" | "description" | "brackets" | "privacy" | "audience")[] = [];
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const description = typeof o.description === "string" ? o.description : "";
  if (!title || Array.from(title).length > YT_TITLE_MAX) out.push("title");
  if (ytDescriptionBytes(description) > YT_DESCRIPTION_MAX) out.push("description");
  if (/[<>]/.test(title + description)) out.push("brackets");
  if (!o.privacy || !(YT_PRIVACY as readonly string[]).includes(o.privacy)) out.push("privacy");
  if (typeof o.madeForKids !== "boolean") out.push("audience");
  return out;
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
