// Gives a store's daily AI video back when the automatic STORY it was claimed for failed before any voice was paid.
//
// runVideoAutomation claims the shop day (Store.videoAutoLastAt) before it queues the day's video, so two overlapping ticks never make
// two. When that video then fails for good before a voice was paid (the case could not be read, the writer was down, the three tries
// ran out), the day would be lost: isVideoDue stays false until tomorrow. A failed attempt that cost nothing gives the day back.
//
// This is bounded: at most AUTO_DAY_RESTORES_MAX failed automatic stories per store per shop day give the day back, so a failure that
// keeps coming back (a provider down for hours) tries a few times and then waits for tomorrow instead of retrying every minute.
// Only an automatic STORY is given back; an ad, or a story the owner made by hand, is never touched here.

import { db } from "@/lib/db";
import { startOfShopDay } from "@/lib/shop/pipeline";

/** How many failed automatic stories of one store, in one shop day, may give the day back. */
export const AUTO_DAY_RESTORES_MAX = 2;
/**
 * The claim is made just BEFORE the job is created (a few database calls apart): the claim this job belongs to lies within this long
 * before its creation, or this long after it. A newer claim (made after the day was given back) is minutes later and is never touched,
 * so giving a day back twice for the same job is harmless.
 */
const CLAIM_BEFORE_MS = 60_000;
const CLAIM_AFTER_MS = 10_000;

export interface FailedJob {
  storeId: string | null;
  source: string;
  createdAt: Date;
  /** The job's stored spec (its kind decides whether it is a story). */
  spec?: unknown;
}

const kindOf = (spec: unknown): string | null => {
  const k = spec && typeof spec === "object" ? (spec as { kind?: unknown }).kind : null;
  return typeof k === "string" ? k : null;
};

/**
 * Makes the store's automatic video due again, once, when `job` is an automatic story that failed before any voice was paid. Returns
 * true when the day was given back. Never throws (a housekeeping step must not turn a failure into another one).
 */
export async function giveBackAutoDay(job: FailedJob, opts: { voicePaid: boolean; now?: number }): Promise<boolean> {
  try {
    if (opts.voicePaid || job.source !== "AUTO" || !job.storeId || kindOf(job.spec) !== "story") return false;
    const failedToday = await db.adVideo.count({
      where: {
        storeId: job.storeId,
        source: "AUTO",
        status: "FAILED",
        createdAt: { gte: startOfShopDay(new Date(opts.now ?? Date.now())) },
        spec: { path: ["kind"], equals: "story" },
      },
    });
    if (failedToday > AUTO_DAY_RESTORES_MAX) return false;
    const at = job.createdAt.getTime();
    const r = await db.store.updateMany({
      where: { id: job.storeId, videoAutoLastAt: { gte: new Date(at - CLAIM_BEFORE_MS), lte: new Date(at + CLAIM_AFTER_MS) } },
      data: { videoAutoLastAt: null },
    });
    return r.count === 1;
  } catch (e) {
    console.error("[advideo] giving the day back failed:", e instanceof Error ? e.message : "unknown error");
    return false;
  }
}
