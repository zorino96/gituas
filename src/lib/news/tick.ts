import { refreshSecFor } from "@/lib/billing/plans";
import { newsroomAccess } from "@/lib/billing/trial";
import { db } from "@/lib/db";
import { runAutopilot } from "./autopilot";
import { classifyPending } from "./classify";
import { ingest } from "./ingest";

/**
 * The background clock wakes a little early or late, so a desk counts as due (and ingest lets it
 * through) this much before its interval is up. Without it a 5-minute desk would be skipped for a
 * whole extra round whenever a tick came 3 seconds early.
 */
export const TICK_GRACE_MS = 20_000;
/** A 30-second desk gets a second pass at this mark, if the first pass left time for it. */
const SECOND_PASS_AT_MS = 30_000;
/** No second pass when the first one already took this long. */
const SECOND_PASS_LATEST_START_MS = 25_000;
/** The tick answers by this mark whatever is still running (the route's limit is 60 s). */
const HARD_STOP_MS = 50_000;
const CONCURRENCY = 3;
/** Desks served per tick, most overdue first; the rest wait for the next tick. */
const MAX_DESKS = 40;
const FAST_SEC = 30;

export interface Desk {
  tenantId: string;
  plan: string;
  lastFetchedAt: Date | null;
}

/** The desks whose plan interval is up (less the grace), the most overdue first; a desk never fetched comes first. */
export function dueDesks<T extends { plan: string; lastFetchedAt: Date | null }>(desks: T[], now: number, graceMs = TICK_GRACE_MS): T[] {
  const age = (d: T) => (d.lastFetchedAt ? d.lastFetchedAt.getTime() : -Infinity);
  return desks
    .filter((d) => !d.lastFetchedAt || now - d.lastFetchedAt.getTime() >= refreshSecFor(d.plan) * 1000 - graceMs)
    .sort((a, b) => age(a) - age(b));
}

/** How long to wait before the second pass for 30-second desks, or null when there should be none. */
export function secondPassDelay(elapsedMs: number, fastDesks: number): number | null {
  if (fastDesks === 0 || elapsedMs >= SECOND_PASS_LATEST_START_MS) return null;
  return Math.max(0, SECOND_PASS_AT_MS - elapsedMs);
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export interface TickResult {
  /** Desks with the autopilot on that are not frozen. */
  desks: number;
  /** Of those, how many were due and handled. */
  served: number;
  /** Desks handled again in the second pass (30-second plans). */
  secondPass: number;
  added: number;
  drafted: number;
  published: number;
  /** Steps (ingest, classify, autopilot) that failed, and desks cut off by the time limit. */
  errors: number;
  timedOut: number;
  ms: number;
}

/** Resolves with the work's result, or "timeout" once `ms` has passed; the work is left to finish or fail on its own. */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => {});
  try {
    return await Promise.race([work, new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** One desk, one pass: fetch its stories, classify them, then let the autopilot act. A failing step never stops the next. */
async function serveDesk(tenantId: string, graceMs: number, totals: Pick<TickResult, "added" | "drafted" | "published" | "errors">): Promise<void> {
  try {
    totals.added += (await ingest(tenantId, { graceMs })).added;
  } catch (e) {
    totals.errors++;
    console.error("[news tick] ingest failed:", e instanceof Error ? e.message : "unknown error");
  }
  try {
    await classifyPending(tenantId);
  } catch (e) {
    totals.errors++;
    console.error("[news tick] classify failed:", e instanceof Error ? e.message : "unknown error");
  }
  try {
    const r = await runAutopilot(tenantId);
    totals.drafted += r.drafted;
    totals.published += r.published;
  } catch (e) {
    totals.errors++;
    console.error("[news tick] autopilot failed:", e instanceof Error ? e.message : "unknown error");
  }
}

/**
 * Serves every newsroom that has the autopilot on, not frozen and due by its plan interval: ingest,
 * classify, then the autopilot. After the first pass, if a 30-second desk was served and less than
 * 25 s have gone, it waits for the 30 s mark and serves the 30-second desks once more. It never
 * runs past 50 s.
 */
export async function tickNewsrooms(clock: Clock = realClock): Promise<TickResult> {
  const started = clock.now();
  const deadline = started + HARD_STOP_MS;
  const totals: TickResult = { desks: 0, served: 0, secondPass: 0, added: 0, drafted: 0, published: 0, errors: 0, timedOut: 0, ms: 0 };

  const settings = await db.newsSettings.findMany({ where: { autoMode: { not: "OFF" } }, select: { tenantId: true, lastFetchedAt: true } });
  const tenants = settings.length
    ? await db.tenant.findMany({
        where: { id: { in: settings.map((s) => s.tenantId) }, kind: "NEWS" },
        select: { id: true, kind: true, plan: true, planPaidUntil: true, trialEndsAt: true },
      })
    : [];
  const at = new Date(started);
  const live = new Map(tenants.filter((t) => newsroomAccess(t, at).active).map((t) => [t.id, t.plan]));
  const desks: Desk[] = settings.filter((s) => live.has(s.tenantId)).map((s) => ({ tenantId: s.tenantId, plan: live.get(s.tenantId)!, lastFetchedAt: s.lastFetchedAt }));
  totals.desks = desks.length;

  /** Serve `list` with a few desks at a time, until `deadline`. Returns how many were handled. */
  async function pass(list: Desk[]): Promise<number> {
    let next = 0;
    let handled = 0;
    const worker = async () => {
      while (next < list.length) {
        const desk = list[next++];
        const left = deadline - clock.now();
        if (left <= 0) {
          totals.timedOut++;
          continue;
        }
        const r = await withDeadline(serveDesk(desk.tenantId, TICK_GRACE_MS, totals), left);
        if (r === "timeout") totals.timedOut++;
        else handled++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
    return handled;
  }

  const due = dueDesks(desks, started).slice(0, MAX_DESKS);
  totals.served = await pass(due);

  const fast = due.filter((d) => refreshSecFor(d.plan) === FAST_SEC);
  const wait = secondPassDelay(clock.now() - started, fast.length);
  if (wait !== null) {
    await clock.sleep(wait);
    totals.secondPass = await pass(fast);
  }

  totals.ms = clock.now() - started;
  return totals;
}
