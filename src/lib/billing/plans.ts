export type Metric = "draft" | "improve" | "publish" | "video";
export type Plan = "LITE" | "MANUAL" | "AUTO" | "ENTERPRISE";

export interface NewsLimits extends Record<Metric, number> {
  sources: number;
  seats: number;
  desks: number;
  /** How often the desk's stories are refreshed, in seconds. */
  refreshSec: number;
  /** Whether the autopilot may publish by itself (every plan may auto-draft). */
  autoPublish: boolean;
  /** News by prompt: none, one focus prompt, or focus + exclude prompt + broad matching. */
  promptFilter: PromptFilter;
}

export type PromptFilter = "none" | "focus" | "full";

/** Monthly quotas plus team size (seats, owner included), desks a person may own, and the plan's speed and autopilot. */
export const NEWS_LIMITS: Record<Plan, NewsLimits> = {
  LITE: { draft: 100, improve: 10, publish: 100, video: 0, sources: 5, seats: 1, desks: 1, refreshSec: 300, autoPublish: false, promptFilter: "none" },
  MANUAL: { draft: 300, improve: 30, publish: 300, video: 0, sources: 10, seats: 2, desks: 1, refreshSec: 120, autoPublish: false, promptFilter: "none" },
  AUTO: { draft: 3000, improve: 300, publish: 3000, video: 300, sources: 30, seats: 5, desks: 3, refreshSec: 60, autoPublish: true, promptFilter: "focus" },
  ENTERPRISE: { draft: 20000, improve: 2000, publish: 20000, video: 3000, sources: 100, seats: 1000, desks: 20, refreshSec: 30, autoPublish: true, promptFilter: "full" },
};

/** Automatic videos a plan may make in a month; an unknown plan makes none. */
export function videoQuotaFor(plan: Plan | string | null | undefined): number {
  return isPlan(plan) ? NEWS_LIMITS[plan].video : 0;
}

/** What news-by-prompt a plan includes; an unknown plan gets none. */
export function promptFilterFor(plan: Plan | string | null | undefined): PromptFilter {
  return isPlan(plan) ? NEWS_LIMITS[plan].promptFilter : "none";
}

/** Seconds between refreshes for a plan; an unknown plan is served like MANUAL. */
export function refreshSecFor(plan: Plan | string | null | undefined): number {
  return (isPlan(plan) ? NEWS_LIMITS[plan] : NEWS_LIMITS.MANUAL).refreshSec;
}

/** Whether a plan lets the autopilot publish without a person. */
export function canAutoPublish(plan: Plan | string | null | undefined): boolean {
  return isPlan(plan) && NEWS_LIMITS[plan].autoPublish;
}

function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && Object.hasOwn(NEWS_LIMITS, v);
}

/** Seats still free: members and live invites both take one. */
export function seatsLeft(seats: number, members: number, pendingInvites: number): number {
  return Math.max(0, seats - members - pendingInvites);
}

/** Desks a person may own: the best plan among the desks they already own. */
export function deskLimit(ownedPlans: readonly Plan[]): number {
  return Math.max(NEWS_LIMITS.MANUAL.desks, ...ownedPlans.map((p) => NEWS_LIMITS[p].desks));
}
