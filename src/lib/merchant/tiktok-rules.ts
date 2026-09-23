/**
 * The posting rules TikTok's Direct Post guidelines impose, as the audited
 * screen at /dashboard/post/tiktok enforces them. The merchant composer must
 * never be looser than the screen TikTok approved, so both check the same
 * things: a privacy level the creator chose from what TikTok offered (no
 * default), a type once commercial content is declared, no branded content
 * visible only to the creator, and the creator's maximum video length.
 */
export interface TikTokChoice {
  privacy: string | null;
  commercial: boolean;
  yourBrand: boolean;
  branded: boolean;
  durationSec?: number;
}

export interface TikTokCreatorLimits {
  privacyOptions: string[];
  maxDurationSec?: number;
}

export type TikTokProblem = "privacy" | "commercial" | "branded-private" | "duration";

export function tiktokProblems(c: TikTokChoice, info: TikTokCreatorLimits): TikTokProblem[] {
  const p: TikTokProblem[] = [];
  if (!c.privacy || !info.privacyOptions.includes(c.privacy)) p.push("privacy");
  if (c.commercial && !c.yourBrand && !c.branded) p.push("commercial");
  if (c.commercial && c.branded && c.privacy === "SELF_ONLY") p.push("branded-private");
  if (c.durationSec !== undefined && info.maxDurationSec !== undefined && c.durationSec > info.maxDurationSec) {
    p.push("duration");
  }
  return p;
}
