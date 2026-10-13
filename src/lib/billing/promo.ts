// The launch offer (owner, 2026-10-13, announced with the video ad): the first three NEW shops get the Pro plan
// free for a week. "New" means both the workspace and its owner's account were created after the offer started, so
// no existing user (the owner's own accounts included) can take a place. The place is given when the shop's first
// page or account is connected (that is when the shop exists), at most once per workspace and three times in all.
// When the week is over the plan works as Free again by itself (a lapsed plan reads as Free everywhere).

import { db } from "@/lib/db";

export const LAUNCH_PROMO = {
  code: "launch-pro-week",
  /** 2026-10-13 23:05 Baghdad time. */
  startsAt: new Date("2026-10-13T20:05:00Z"),
  slots: 3,
  plan: "PRO",
  days: 7,
} as const;

const DAY = 86_400_000;
/** The offer's own counter: Usage rows have no tenant relation, so a fixed key holds the number of places given. */
const COUNTER = { tenantId: `promo:${LAUNCH_PROMO.code}`, month: "all", metric: "claims" } as const;
/** The mark on a workspace that got a place (also how the app shows it, and how the owner lists who got it). */
export const promoMark = (tenantId: string) => ({ tenantId, month: "promo", metric: LAUNCH_PROMO.code });

const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/** Gives a new shop the offer if it qualifies and a place is left. Never throws: a failure only means no offer. */
export async function claimLaunchPromo(tenantId: string, storeId: string, now = new Date()): Promise<boolean> {
  try {
    if (now < LAUNCH_PROMO.startsAt) return false;
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { kind: true, createdAt: true, memberships: { where: { role: "OWNER" }, select: { user: { select: { createdAt: true } } } } },
    });
    if (!tenant || tenant.kind !== "MERCHANT" || tenant.createdAt < LAUNCH_PROMO.startsAt) return false;
    // A new person: every owner of the workspace signed up after the offer started.
    if (!tenant.memberships.length || tenant.memberships.some((m) => m.user.createdAt < LAUNCH_PROMO.startsAt)) return false;

    const store = await db.store.findUnique({ where: { id: storeId }, select: { tenantId: true, plan: true, planPaidUntil: true } });
    if (!store || store.tenantId !== tenantId) return false;
    const paying = store.plan !== "FREE" && !!store.planPaidUntil && store.planPaidUntil > now;
    if (paying) return false;

    // Once per workspace: the mark is created only once (a second try hits the unique key).
    try {
      await db.usage.create({ data: { ...promoMark(tenantId), count: 1 } });
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
    // Three in all: take a place; when there was none left, give it back and take the mark away.
    const taken = await takePlace();
    if (taken > LAUNCH_PROMO.slots) {
      await db.usage.update({ where: { tenantId_month_metric: COUNTER }, data: { count: { decrement: 1 } } });
      await db.usage.delete({ where: { tenantId_month_metric: promoMark(tenantId) } });
      return false;
    }
    await db.store.update({ where: { id: storeId }, data: { plan: LAUNCH_PROMO.plan, planPaidUntil: new Date(now.getTime() + LAUNCH_PROMO.days * DAY) } });
    console.log(`[promo] ${LAUNCH_PROMO.code}: place ${taken} of ${LAUNCH_PROMO.slots} given`);
    return true;
  } catch (e) {
    console.error("[promo] could not give the offer:", e instanceof Error ? e.name : "unknown error");
    return false;
  }
}

/** The counter after taking one place (two shops connecting at once both get a number; the database decides). */
async function takePlace(): Promise<number> {
  for (let i = 0; i < 2; i++) {
    try {
      const row = await db.usage.upsert({ where: { tenantId_month_metric: COUNTER }, create: { ...COUNTER, count: 1 }, update: { count: { increment: 1 } }, select: { count: true } });
      return row.count;
    } catch (e) {
      // Two first claims at the same moment: one created the row, the other retries as an update.
      if (!isUnique(e) || i === 1) throw e;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/** How many places are left (for the owner's check; not shown to buyers). */
export async function promoPlacesLeft(): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: COUNTER }, select: { count: true } });
  return Math.max(0, LAUNCH_PROMO.slots - (row?.count ?? 0));
}

/** The workspace got the offer and it is still running: until when (for the banner on Today). */
export async function promoUntil(tenantId: string, now = new Date()): Promise<Date | null> {
  const mark = await db.usage.findUnique({ where: { tenantId_month_metric: promoMark(tenantId) }, select: { count: true } });
  if (!mark) return null;
  const store = await db.store.findFirst({ where: { tenantId, plan: LAUNCH_PROMO.plan, planPaidUntil: { gt: now } }, orderBy: { planPaidUntil: "desc" }, select: { planPaidUntil: true } });
  return store?.planPaidUntil ?? null;
}
