// What an AI video needs to be uploaded to YouTube: the owner's two declarations (who can see it, and whether it is made for kids) kept in
// the job's spec, and the title and description the upload carries. Pure: no database, no network.
//
// YouTube's rules (YouTube API policy III.E.3.f and III.J.2.b, and the shared publisher in src/lib/merchant/publish-core.ts): every upload
// carries the owner's OWN privacy and audience. Nothing here fills them in: a job without both declarations is never uploaded.

import { YT_DESCRIPTION_MAX, YT_PRIVACY, YT_TITLE_MAX, youtubeOptionProblems, ytDescriptionBytes, type YouTubeOptions, type YtPrivacy } from "@/lib/merchant/caption";

/** The owner's two declarations for a video that is to go to YouTube. */
export interface YoutubeChoice {
  privacy: YtPrivacy;
  madeForKids: boolean;
}

/**
 * The declarations as the spec keeps them (`spec.youtube`): both must be there and valid, or nothing is returned. A tolerant reader: any
 * other shape, a privacy YouTube does not have, or an audience that is not a plain true or false gives null (never a guess).
 */
export function youtubeChoiceOf(raw: unknown): YoutubeChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { privacy?: unknown; madeForKids?: unknown };
  if (typeof r.privacy !== "string" || !(YT_PRIVACY as readonly string[]).includes(r.privacy)) return null;
  if (typeof r.madeForKids !== "boolean") return null;
  return { privacy: r.privacy as YtPrivacy, madeForKids: r.madeForKids };
}

/** A line of text for YouTube: no control or format characters, no angle brackets (YouTube rejects them), spaces collapsed. */
const oneLine = (s: string): string => s.replace(/[<>]/g, " ").replace(/\p{Cc}/gu, " ").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();

/** A description YouTube accepts: no angle brackets, line breaks kept, at most 5000 UTF-8 bytes (cut at a whole character, never in the middle of one). */
export function ytDescriptionOf(caption: string | null | undefined): string {
  const text = (caption ?? "")
    .split(/\r\n|\r|\n/)
    .map(oneLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  let bytes = 0;
  let out = "";
  for (const ch of text) {
    bytes += ytDescriptionBytes(ch);
    if (bytes > YT_DESCRIPTION_MAX) break;
    out += ch;
  }
  return out.trim();
}

interface SpecLike {
  subject?: { name?: unknown } | null;
  scenes?: { type?: unknown; text?: unknown }[] | null;
}

/**
 * The title of the upload: the story's case (spec.subject.name), else the hook's text (what a video opens with), else the first line of
 * the caption. At most 100 characters, no angle brackets. Empty when there is nothing to name it by.
 */
export function ytTitleOf(spec: unknown, caption: string | null | undefined): string {
  const s = (spec && typeof spec === "object" ? spec : {}) as SpecLike;
  const candidates: unknown[] = [
    s.subject?.name,
    Array.isArray(s.scenes) ? s.scenes.find((x) => x?.type === "hook")?.text : null,
    (caption ?? "").split(/\r?\n/)[0],
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const t = oneLine(c);
    if (t) return Array.from(t).slice(0, YT_TITLE_MAX).join("").trim();
  }
  return "";
}

export type YoutubeBuilt = { ok: true; options: YouTubeOptions } | { ok: false; reason: string };

/**
 * The options of one YouTube upload from a finished job: title and description made from the spec and the caption, privacy and audience
 * from the owner's declarations in `spec.youtube`. A job without valid declarations (or with nothing to title it by) gives a reason and no
 * options: it is skipped, never uploaded with a guess.
 */
export function youtubeOptionsOf(spec: unknown, caption: string | null | undefined): YoutubeBuilt {
  const choice = youtubeChoiceOf((spec && typeof spec === "object" ? (spec as { youtube?: unknown }).youtube : null) ?? null);
  if (!choice) return { ok: false, reason: "YouTube was skipped: the owner has not said who can see the video and whether it is made for kids" };
  const options: YouTubeOptions = { title: ytTitleOf(spec, caption), description: ytDescriptionOf(caption), privacy: choice.privacy, madeForKids: choice.madeForKids };
  const problems = youtubeOptionProblems(options);
  if (problems.length) return { ok: false, reason: `YouTube was skipped: the upload is not valid (${problems.join(", ")})` };
  return { ok: true, options };
}
