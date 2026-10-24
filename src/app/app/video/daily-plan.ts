// The daily video's own plan as the chat's tool builds it (a plain module: the card and the run share these rules, so the card shows exactly what
// Confirm saves). The plan itself (its shape, its tolerant reader) is src/lib/advideo/plan.ts; this only turns the arguments of set_daily_video,
// on top of the plan already saved, into the plan that will be saved.
//
// The idea is the owner's own words, copied as they said them: it is stored exactly (trimmed), never cut or rewritten here. The two YouTube
// declarations (who may watch, made for kids) are the owner's; nothing here ever fills them in.

import { PLAN_BRIEF_MAX, type VideoAutoPlan } from "@/lib/advideo/plan";

/** The arguments of set_daily_video that belong to the plan (the rest is the mode, the hour and the video language). */
export const PLAN_KEYS = ["idea", "kind", "format", "review", "photos", "publishTo", "youtubePrivacy", "youtubeMadeForKids"] as const;

/** The longest idea a plan keeps, in characters (letters of any script). The card refuses a longer one instead of cutting it. */
export const PLAN_IDEA_MAX = PLAN_BRIEF_MAX;

export type DailyArgs = Partial<{
  idea: string;
  kind: "ad" | "story";
  format: "vertical" | "wide";
  review: boolean;
  photos: boolean;
  publishTo: ("FB" | "IG" | "YT")[];
  youtubePrivacy: "public" | "unlisted" | "private";
  youtubeMadeForKids: boolean;
}>;

/** Whether the call carries anything of the plan. */
export function hasPlanArgs(args: object): boolean {
  const a = args as Record<string, unknown>;
  return PLAN_KEYS.some((k) => a[k] !== undefined);
}

export const ideaLength = (idea: string): number => Array.from(idea.trim()).length;

/**
 * The plan that results from the call on top of the saved one (null when none is saved). Left out, a field keeps what the saved plan has; a new
 * plan starts literal (the words go straight to the writer), with the photographs on, vertical, kept as drafts (no platform). `kind` is the
 * given one, else the saved plan's, else `fallbackKind` (what the page is for). The returned object is raw: parseVideoAutoPlan reads it.
 * `needs` says what is still missing: the YouTube answers when YouTube is wanted and the owner has not given them.
 */
export function mergeDailyPlan(args: DailyArgs, saved: VideoAutoPlan | null, fallbackKind: "ad" | "story"): { raw: Record<string, unknown>; needs: "youtube" | null } {
  const kind = args.kind ?? saved?.kind ?? fallbackKind;
  const targets = [...new Set(args.publishTo ?? saved?.targets ?? [])];
  const wide = kind === "story" && (args.format ?? saved?.format) === "wide";
  const privacy = args.youtubePrivacy ?? saved?.youtube?.privacy;
  const kids = args.youtubeMadeForKids ?? saved?.youtube?.madeForKids;
  const wantsYoutube = targets.includes("YT");
  const needs = wantsYoutube && (privacy === undefined || kids === undefined) ? "youtube" : null;
  const raw: Record<string, unknown> = {
    brief: typeof args.idea === "string" ? args.idea.trim() : saved?.brief ?? "",
    kind,
    review: args.review ?? saved?.review ?? false,
    photos: args.photos ?? saved?.photos ?? true,
    targets,
    ...(wide ? { format: "wide" } : {}),
    ...(wantsYoutube && privacy !== undefined && kids !== undefined ? { youtube: { privacy, madeForKids: kids } } : {}),
  };
  return { raw, needs };
}
