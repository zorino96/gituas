export type Metric = "draft" | "improve" | "publish";
export type Plan = "LITE" | "MANUAL" | "AUTO" | "ENTERPRISE";

/** Monthly quotas plus team size (seats, owner included) and desks a person may own. */
export const NEWS_LIMITS: Record<Plan, Record<Metric, number> & { sources: number; seats: number; desks: number }> = {
  LITE: { draft: 100, improve: 10, publish: 100, sources: 5, seats: 1, desks: 1 },
  MANUAL: { draft: 300, improve: 30, publish: 300, sources: 10, seats: 2, desks: 1 },
  AUTO: { draft: 3000, improve: 300, publish: 3000, sources: 30, seats: 5, desks: 3 },
  ENTERPRISE: { draft: 20000, improve: 2000, publish: 20000, sources: 100, seats: 1000, desks: 20 },
};

/** Seats still free: members and live invites both take one. */
export function seatsLeft(seats: number, members: number, pendingInvites: number): number {
  return Math.max(0, seats - members - pendingInvites);
}

/** Desks a person may own: the best plan among the desks they already own. */
export function deskLimit(ownedPlans: readonly Plan[]): number {
  return Math.max(NEWS_LIMITS.MANUAL.desks, ...ownedPlans.map((p) => NEWS_LIMITS[p].desks));
}
