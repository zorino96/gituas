// A story that goes to several Pages of one desk does not go to all of them in the same minute:
// the first Page of each platform gets it at once, the others follow a few minutes apart through
// the scheduled-post clock. Identical posts landing on many accounts at the same moment are what
// a spam system reads as a network; the gap, with the per-platform cap, keeps the desk's own Pages
// looking like what they are.

import type { AutoTarget } from "./autopilot-settings";

/** Minutes between one Page and the next of the same platform. */
export const STAGGER_GAP_MIN = 5;

export interface StaggerLater {
  target: AutoTarget;
  accountId: string;
  /** Minutes after the first post. */
  afterMin: number;
}

/**
 * Splits the chosen accounts: the first of each platform goes now, the rest follow `gapMin` apart.
 * Platforms with no list (a single connection) are left to the publisher's default.
 */
export function splitForStagger(
  accounts: Partial<Record<AutoTarget, string[]>> | undefined,
  gapMin: number = STAGGER_GAP_MIN,
): { now: Partial<Record<AutoTarget, string[]>> | undefined; later: StaggerLater[] } {
  if (!accounts) return { now: undefined, later: [] };
  const now: Partial<Record<AutoTarget, string[]>> = {};
  const later: StaggerLater[] = [];
  for (const [target, ids] of Object.entries(accounts) as [AutoTarget, string[] | undefined][]) {
    if (!ids?.length) continue;
    now[target] = ids.slice(0, 1);
    ids.slice(1).forEach((accountId, i) => later.push({ target, accountId, afterMin: gapMin * (i + 1) }));
  }
  return { now: Object.keys(now).length ? now : undefined, later };
}

/** Marks a stored scheduled post as the later half of an autopilot story (see recordNewsPublish). */
export function isStaggered(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as { stagger?: unknown }).stagger === true;
}
