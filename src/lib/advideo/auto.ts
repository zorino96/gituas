// The AI video automation and the minute-by-minute housekeeping of video jobs. Called from the
// per-minute clock (src/app/api/cron/scheduled): never throws, one failing store never stops the rest.

import { db } from "@/lib/db";
import { adVideoEnabled } from "./enabled";
import { startOfShopDay } from "@/lib/shop/pipeline";
import type { StorePlan } from "@/lib/shop/plans";
import { AD_CLAIM_MS, AD_MAX_TRIES, createAdVideo, prepareQueued, type Target } from "./prepare";
import { allowance, countVideo, isVideoTier, videosUsed } from "./limits";
import { publishAdVideo } from "./publish";

const HOUR = 3_600_000;
/** A post that has sat in POSTING this long was cut off: it is not retried by itself, in case it already went out. */
const POSTING_STUCK_MS = 20 * 60 * 1000;

/** Hour of the day in Baghdad (UTC+3, no daylight saving). */
export function baghdadHour(now: number): number {
  return new Date(now + 3 * HOUR).getUTCHours();
}

/** Whether a store's daily video is due: its hour has come and none was made since the shop day began. */
export function isVideoDue(store: { videoAutoHour: number; videoAutoLastAt: Date | null }, now: number): boolean {
  if (baghdadHour(now) < store.videoAutoHour) return false;
  return !store.videoAutoLastAt || store.videoAutoLastAt < startOfShopDay(new Date(now));
}

/** The product whose last video is the oldest (or that never had one): products with photos only. */
export function pickProductForVideo(products: { id: string; hasPhoto: boolean }[], lastUsed: Map<string, number>): string | null {
  const usable = products.filter((p) => p.hasPhoto);
  if (!usable.length) return null;
  return usable.reduce((best, p) => ((lastUsed.get(p.id) ?? 0) < (lastUsed.get(best.id) ?? 0) ? p : best)).id;
}

/** Makes the day's video for every store whose automation is due. Returns counts by outcome. */
export async function runVideoAutomation(now = Date.now()): Promise<Record<string, number>> {
  const stores = await db.store.findMany({
    where: { videoAutoMode: { in: ["DRAFT", "PUBLISH"] }, pausedReason: null },
    orderBy: { videoAutoLastAt: { sort: "asc", nulls: "first" } },
    select: { id: true, tenantId: true, plan: true, videoAutoMode: true, videoAutoTier: true, videoAutoHour: true, videoAutoLastAt: true, fbPageId: true, igUserId: true, tenant: { select: { ownerId: true } } },
    take: 30,
  });
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  for (const s of stores) {
    try {
      if (!isVideoDue(s, now)) continue;
      if (!isVideoTier(s.videoAutoTier)) continue;
      const a = allowance(s.plan as StorePlan, s.videoAutoTier, await videosUsed(s.id, s.videoAutoTier));
      if (a.left < 1) {
        bump("no_allowance");
        continue;
      }
      // Claim the day first, so two overlapping ticks never make two videos.
      const claim = await db.store.updateMany({ where: { id: s.id, videoAutoLastAt: s.videoAutoLastAt }, data: { videoAutoLastAt: new Date(now) } });
      if (claim.count !== 1) continue;

      const targets = [s.fbPageId ? "FB" : null, s.igUserId ? "IG" : null].filter((t): t is Target => !!t);
      const [products, recent] = await Promise.all([
        db.product.findMany({ where: { storeId: s.id, active: true }, select: { id: true, photos: true } }),
        db.adVideo.findMany({ where: { storeId: s.id, productId: { not: null }, createdAt: { gt: new Date(now - 90 * 24 * HOUR) } }, select: { productId: true, createdAt: true } }),
      ]);
      const lastUsed = new Map<string, number>();
      for (const r of recent) if (r.productId) lastUsed.set(r.productId, Math.max(lastUsed.get(r.productId) ?? 0, r.createdAt.getTime()));
      const productId = pickProductForVideo(products.map((p) => ({ id: p.id, hasPhoto: p.photos.length > 0 })), lastUsed);

      const made = await createAdVideo({
        tenantId: s.tenantId,
        storeId: s.id,
        tier: s.videoAutoTier,
        topic: null,
        productId,
        voice: "shilan",
        targets,
        autoPost: s.videoAutoMode === "PUBLISH" && targets.length > 0,
        source: "AUTO",
        createdById: s.tenant.ownerId ?? null,
      });
      bump(made.ok ? "queued" : `refused_${made.error}`);
    } catch (e) {
      console.error("[advideo] automation failed for a store:", e instanceof Error ? e.message : "unknown error");
      bump("failed");
    }
  }
  return counts;
}

/**
 * One tick: the day's videos are queued, one waiting video gets its script and voice, rendered
 * videos that should be posted are posted, and abandoned jobs are cleaned up.
 */
export async function tickAdVideos(opts: { deadline: number }): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // The kill switch (AD_VIDEO_ENABLED): closed, nothing is made, prepared or posted.
  if (!adVideoEnabled()) return { disabled: 1 };
  try {
    const automation = await runVideoAutomation();
    for (const [k, v] of Object.entries(automation)) out[`auto_${k}`] = v;

    out.prepared = await prepareQueued(opts.deadline, 1);

    // Rendered videos that were asked to post themselves.
    const toPost = await db.adVideo.findMany({ where: { status: "RENDERED", autoPost: true }, orderBy: { updatedAt: "asc" }, take: 2, select: { id: true } });
    out.posted = 0;
    for (const j of toPost) {
      const r = await publishAdVideo(j.id);
      if (r.ok) out.posted++;
      else if (r.error === "targets" || r.error === "media") {
        // Nothing to post to (a Page was disconnected): stop trying; the owner sees it in the list.
        await db.adVideo.updateMany({ where: { id: j.id, status: "RENDERED" }, data: { autoPost: false, error: r.error === "targets" ? "no connected page" : "video file missing" } });
      }
    }

    // A post cut off mid-way may already be out: never retried by itself.
    await db.adVideo.updateMany({
      where: { status: "POSTING", updatedAt: { lt: new Date(Date.now() - POSTING_STUCK_MS) } },
      data: { status: "RENDERED", autoPost: false, error: "Posting did not finish: check the page before posting again." },
    });
    // A render that was handed out, never reported and has no tries left: failed, and the allowance goes back.
    const dead = await db.adVideo.findMany({
      where: { status: "RENDERING", tries: { gte: AD_MAX_TRIES }, claimedAt: { lt: new Date(Date.now() - AD_CLAIM_MS) } },
      select: { id: true, storeId: true, tier: true },
      take: 10,
    });
    for (const d of dead) {
      const c = await db.adVideo.updateMany({ where: { id: d.id, status: "RENDERING" }, data: { status: "FAILED", error: "the render did not finish" } });
      if (c.count === 1 && d.storeId && isVideoTier(d.tier)) await countVideo(d.storeId, d.tier, -1);
    }
  } catch (e) {
    console.error("[advideo] tick failed:", e instanceof Error ? e.message : "unknown error");
    out.failed = (out.failed ?? 0) + 1;
  }
  return out;
}
