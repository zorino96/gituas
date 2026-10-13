// The AI video automation and the minute-by-minute housekeeping of video jobs. Called from the
// per-minute clock (src/app/api/cron/scheduled): never throws, one failing store never stops the rest.

import { db } from "@/lib/db";
import { adVideoEnabled } from "./enabled";
import { startOfShopDay } from "@/lib/shop/pipeline";
import type { StorePlan } from "@/lib/shop/plans";
import { AD_CLAIM_MS, AD_MAX_TRIES, createAdVideo, prepareQueued, type Target } from "./prepare";
import { chooseTier } from "@/lib/ai/meter";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { defaultTierFor, isVideoTier, refundVideo, videosToday, videosUsed, type VideoTier } from "./limits";
import { publishAdVideo } from "./publish";
import { voiceWasPaid } from "./voice";

const HOUR = 3_600_000;
/** A post that has sat in POSTING this long was cut off: it is not retried by itself, in case it already went out. */
const POSTING_STUCK_MS = 20 * 60 * 1000;
/** A QUEUED video whose attempts ran out without an answer (the function was killed) is failed after this. */
const QUEUED_STUCK_MS = 5 * 60 * 1000;

/** Hour of the day in Baghdad (UTC+3, no daylight saving). */
export function baghdadHour(now: number): number {
  return new Date(now + 3 * HOUR).getUTCHours();
}

/** Whether a store's daily video is due: its hour has come and none was made since the shop day began. */
export function isVideoDue(store: { videoAutoHour: number; videoAutoLastAt: Date | null }, now: number): boolean {
  if (baghdadHour(now) < store.videoAutoHour) return false;
  return !store.videoAutoLastAt || store.videoAutoLastAt < startOfShopDay(new Date(now));
}

/** Makes the day's video for every store whose automation is due. Returns counts by outcome. */
export async function runVideoAutomation(now = Date.now()): Promise<Record<string, number>> {
  const stores = await db.store.findMany({
    // A store on the free plan has no video allowance: it must not sit at the front of the queue forever.
    where: { videoAutoMode: { in: ["DRAFT", "PUBLISH"] }, pausedReason: null, plan: { not: "FREE" } },
    orderBy: { videoAutoLastAt: { sort: "asc", nulls: "first" } },
    select: { id: true, tenantId: true, plan: true, videoAutoMode: true, videoAutoTier: true, videoAutoHour: true, videoAutoLastAt: true, fbPageId: true, igUserId: true, tenant: { select: { ownerId: true } } },
    take: 50,
  });
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  for (const s of stores) {
    try {
      if (!isVideoDue(s, now)) continue;
      // The tier follows the workspace's plans: Opus videos if it has the Opus plan, else Haiku.
      const lim = await limitsOf(s.tenantId);
      const wanted: VideoTier = isVideoTier(s.videoAutoTier) ? s.videoAutoTier : "LITE";
      const tier: VideoTier = lim.videos[wanted] > 0 ? wanted : defaultTierFor(s.plan as StorePlan);
      if ((await videosUsed(s.tenantId, tier)) >= lim.videos[tier]) {
        bump("no_allowance");
        continue;
      }
      // Checked before the day is claimed, so a full day or a spent AI allowance is not retried every minute.
      if ((await videosToday(s.tenantId)) >= lim.videosPerDay) {
        bump("daily_full");
        continue;
      }
      if (!(await chooseTier({ scope: s.tenantId }, "haiku").catch(() => "haiku" as const))) {
        bump("no_ai_allowance");
        continue;
      }
      // Claim the day first, so two overlapping ticks never make two videos.
      const claimedAt = new Date(now);
      const claim = await db.store.updateMany({ where: { id: s.id, videoAutoLastAt: s.videoAutoLastAt }, data: { videoAutoLastAt: claimedAt } });
      if (claim.count !== 1) continue;

      const targets = [s.fbPageId ? "FB" : null, s.igUserId ? "IG" : null].filter((t): t is Target => !!t);
      const made = await createAdVideo({
        tenantId: s.tenantId,
        storeId: s.id,
        tier,
        topic: null,
        // No product chosen here: the daily plan aims the video (the product buyers ask about, an occasion, or the whole shop).
        productId: null,
        voice: "shilan",
        targets,
        autoPost: s.videoAutoMode === "PUBLISH" && targets.length > 0,
        source: "AUTO",
        createdById: s.tenant.ownerId ?? null,
      });
      if (!made.ok) {
        // Nothing was made: the day is not spent (busy and limit refusals try again at the next tick).
        await db.store.updateMany({ where: { id: s.id, videoAutoLastAt: claimedAt }, data: { videoAutoLastAt: s.videoAutoLastAt } });
        bump(`refused_${made.error}`);
      } else {
        bump("queued");
      }
    } catch (e) {
      console.error("[advideo] automation failed for a store:", e instanceof Error ? e.message : "unknown error");
      bump("failed");
    }
  }
  return counts;
}

/**
 * One tick: the day's videos are queued, then ONE heavy thing is done (a rendered video is posted, or
 * one waiting video gets its script and voice: both can take most of the minute), and abandoned jobs
 * are cleaned up.
 */
export async function tickAdVideos(opts: { deadline: number }): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // The kill switch (AD_VIDEO_ENABLED): closed, nothing is made, prepared or posted.
  if (!adVideoEnabled()) return { disabled: 1 };
  try {
    const automation = await runVideoAutomation();
    for (const [k, v] of Object.entries(automation)) out[`auto_${k}`] = v;

    // Rendered videos that were asked to post themselves go first; a prepare would only wait behind them.
    const toPost = await db.adVideo.findFirst({ where: { status: "RENDERED", autoPost: true }, orderBy: { updatedAt: "asc" }, select: { id: true } });
    out.posted = 0;
    out.prepared = 0;
    if (toPost) {
      const r = await publishAdVideo(toPost.id);
      if (r.ok) out.posted++;
      else if (r.error === "targets" || r.error === "media") {
        // Nothing to post to (a Page was disconnected): stop trying; the owner sees it in the list.
        await db.adVideo.updateMany({ where: { id: toPost.id, status: "RENDERED" }, data: { autoPost: false, error: r.error === "targets" ? "no connected page" : "video file missing" } });
      }
    } else {
      out.prepared = await prepareQueued(opts.deadline, 1);
    }

    // A post cut off mid-way may already be out: never retried by itself.
    await db.adVideo.updateMany({
      where: { status: "POSTING", updatedAt: { lt: new Date(Date.now() - POSTING_STUCK_MS) } },
      data: { status: "RENDERED", autoPost: false, error: "Posting did not finish: check the page before posting again." },
    });
    // Jobs that ran out of tries without ever answering (a function killed on its last attempt, or a render that was
    // handed out and never reported): failed, and the allowance goes back.
    const stuck = await db.adVideo.findMany({
      where: {
        OR: [
          { status: "RENDERING", tries: { gte: AD_MAX_TRIES }, claimedAt: { lt: new Date(Date.now() - AD_CLAIM_MS) } },
          { status: { in: ["QUEUED", "READY"] }, tries: { gte: AD_MAX_TRIES }, updatedAt: { lt: new Date(Date.now() - QUEUED_STUCK_MS) } },
        ],
      },
      select: { id: true, tenantId: true, storeId: true, tier: true, status: true, createdAt: true },
      take: 10,
    });
    for (const d of stuck) {
      const c = await db.adVideo.updateMany({ where: { id: d.id, status: d.status, tries: { gte: AD_MAX_TRIES } }, data: { status: "FAILED", error: "the video could not be made", claimedAt: null } });
      if (c.count === 1 && isVideoTier(d.tier)) await refundVideo(d.tenantId, d.tier, d.createdAt, { keepDay: await voiceWasPaid(d.tenantId, d.id) });
    }
  } catch (e) {
    console.error("[advideo] tick failed:", e instanceof Error ? e.message : "unknown error");
    out.failed = (out.failed ?? 0) + 1;
  }
  return out;
}
