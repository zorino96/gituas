// The AI video automation and the minute-by-minute housekeeping of video jobs. Called from the
// per-minute clock (src/app/api/cron/scheduled): never throws, one failing store never stops the rest.

import { db } from "@/lib/db";
import { adVideoEnabled } from "./enabled";
import { startOfShopDay } from "@/lib/shop/pipeline";
import type { StorePlan } from "@/lib/shop/plans";
import { giveBackAutoDay } from "./auto-day";
import { AD_CLAIM_MS, AD_MAX_TRIES, createAdVideo, prepareQueued, type Target } from "./prepare";
import { chooseTier } from "@/lib/ai/meter";
import { loadProfiles } from "@/lib/shop/profile";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { providersFor } from "@/lib/voice/tts";
import { kindForGoal, storyConceptOf, storyFictionAsked, videoLangOf, voiceFor, type VideoKind, type VideoLang } from "./lang";
import { parseVideoAutoPlan, type VideoAutoPlan } from "./plan";
import { connectedVideoTargets } from "./targets";
import { defaultTierFor, isVideoTier, refundVideo, videosToday, videosUsed, type VideoTier } from "./limits";
import { publishAdVideo } from "./publish";
import { voiceWasPaid } from "./voice";

const HOUR = 3_600_000;
/** A post that has sat in POSTING this long was cut off: it is not retried by itself, in case it already went out. */
const POSTING_STUCK_MS = 20 * 60 * 1000;
/** A QUEUED video whose attempts ran out without an answer (the function was killed) is failed after this. */
const QUEUED_STUCK_MS = 5 * 60 * 1000;
/** An automatic story that failed this recently, before any voice was paid, gives its store's day back (see auto-day.ts). */
const FAILED_AUTO_LOOKBACK_MS = 30 * 60 * 1000;
/** The reviewer's time for a plan's idea (the clock tick has the rest of its minute to spend). */
const PLAN_REVIEW_MS = 12_000;

/**
 * The words a plan's video is made from. Its own idea, verbatim: when the plan asks Gituas to read the page first (review) the idea
 * is reviewed (a story's review reads what is known about the page; an ad's reads the shop), and any failure of the review, a slow
 * answer or "nothing to read" falls back on the owner's own words, so a broken reviewer never costs the day's video.
 */
async function topicOfPlan(s: { id: string; tenantId: string }, plan: VideoAutoPlan, lang: VideoLang): Promise<string | null> {
  const brief = plan.brief.trim();
  if (!brief) return null;
  if (!plan.review) return brief;
  try {
    // (loaded only here: the reviewer is not needed by a store without a plan, nor by a plan whose words go through as written)
    const { reviewIdea } = await import("@/lib/ai/review-idea");
    const rev = await reviewIdea({
      tenantId: s.tenantId,
      storeId: s.id,
      productId: null,
      idea: brief,
      kind: plan.kind === "story" ? "story" : "video",
      lang,
      budgetMs: PLAN_REVIEW_MS,
    });
    return !rev.kept && typeof rev.text === "string" && rev.text.trim() ? rev.text : brief;
  } catch (e) {
    console.warn("[advideo] the plan's idea could not be reviewed; the owner's words are used:", e instanceof Error ? e.name : "unknown error");
    return brief;
  }
}

/**
 * Where a plan's video goes: the platforms the plan names that are really connected now (Facebook for a store with a Page, Instagram for
 * one with an account, YouTube for a workspace with a channel). A read that fails leaves Facebook and Instagram by the store's own
 * accounts and no YouTube: a platform that cannot be confirmed is never posted to.
 */
async function targetsOfPlan(s: { tenantId: string; fbPageId: string | null; igUserId: string | null }, plan: VideoAutoPlan): Promise<Target[]> {
  if (!plan.targets.length) return [];
  try {
    const connected = await connectedVideoTargets(s.tenantId, { fbPageId: s.fbPageId, igUserId: s.igUserId }, plan.targets);
    return plan.targets.filter((t) => connected.includes(t));
  } catch (e) {
    console.warn("[advideo] the connected platforms could not be read:", e instanceof Error ? e.name : "unknown error");
    return plan.targets.filter((t) => (t === "FB" ? !!s.fbPageId : t === "IG" ? !!s.igUserId : false));
  }
}

/** Hour of the day in Baghdad (UTC+3, no daylight saving). */
export function baghdadHour(now: number): number {
  return new Date(now + 3 * HOUR).getUTCHours();
}

/** Whether a store's daily video is due: its hour has come and none was made since the shop day began. */
export function isVideoDue(store: { videoAutoHour: number; videoAutoLastAt: Date | null }, now: number): boolean {
  if (baghdadHour(now) < store.videoAutoHour) return false;
  return !store.videoAutoLastAt || store.videoAutoLastAt < startOfShopDay(new Date(now));
}

/**
 * Makes the day's video for every store whose automation is due. Returns counts by outcome.
 * The video follows the store's own choices: its video language (Store.videoLang, Sorani when unset) and its kind.
 * A page that earns from its content (goal monetize or grow) AND has written what it is about (an offer line or a goal
 * in words: a bare category such as "content" is not a concept) makes stories; every other store makes the ad it always
 * made, so a store is never skipped because of the kind and a seller is never switched. Without a plan a story is always a draft: a
 * story told by an AI is read before it goes out, even in PUBLISH mode.
 *
 * The daily story of a store WITHOUT a plan names NO case (topic null, in every language, Sorani included) and is not "literal": when
 * it is prepared the system chooses a real, well documented case (resolveStorySubject in subject.ts) by the page's concept and the
 * store's recent subjects, so it never repeats and it never fails for want of a subject; the owner is never asked to name one.
 *
 * A store WITH a plan (Store.videoAutoPlan, see plan.ts: "every day make me a video in this style and publish it") makes what the plan
 * says: its kind, shape and photographs; the owner's own words as the idea, the same every day (a generic idea gets a different real
 * case each day through the store's recent subjects), used exactly as written unless the plan asks Gituas to read the page first; and,
 * in mode PUBLISH, a post by itself to the platforms the plan names that are connected now, stories included. A story told from memory
 * or about a very recent case still waits as a draft (prepare.ts decides that when the script is written). Mode DRAFT keeps it for reading.
 */
export async function runVideoAutomation(now = Date.now()): Promise<Record<string, number>> {
  const stores = await db.store.findMany({
    // A store on the free plan has no video allowance: it must not sit at the front of the queue forever.
    where: { videoAutoMode: { in: ["DRAFT", "PUBLISH"] }, pausedReason: null, plan: { not: "FREE" } },
    orderBy: { videoAutoLastAt: { sort: "asc", nulls: "first" } },
    select: { id: true, tenantId: true, plan: true, videoAutoMode: true, videoAutoTier: true, videoAutoHour: true, videoAutoLastAt: true, videoLang: true, videoAutoPlan: true, fbPageId: true, igUserId: true, tenant: { select: { ownerId: true } } },
    take: 50,
  });
  // Only the stores whose video is due have their profile read (most minutes of the day none is): their goal decides the kind
  // of video, and a story follows what the page is about. (loadProfiles never throws: a failed read is no profile, so an ad.)
  const due = stores.filter((s) => isVideoDue(s, now));
  const profiles = due.length ? await loadProfiles(due.map((s) => s.id)) : null;
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  for (const s of due) {
    try {
      const lang = videoLangOf(s.videoLang);
      const profile = profiles?.get(s.id) ?? null;
      // The owner's own plan, when he made one (a column that is missing or holds anything else reads as no plan).
      const plan = parseVideoAutoPlan(s.videoAutoPlan);
      // A story only for a page that earns from its content and has said what it is about; any other store, and a content
      // page with nothing written, gets the ad as before. The store is never skipped for its kind. A plan says its own kind.
      const kind: VideoKind = plan ? plan.kind : kindForGoal(profile?.goal) === "story" && storyConceptOf(profile) ? "story" : "ad";
      // Arabic and English are read by Gemini: without its key nothing is claimed or paid for.
      if (lang !== "ckb" && providersFor(lang).length === 0) {
        bump("no_voice");
        continue;
      }
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

      // Without a plan: the store's own Facebook Page and Instagram account, and only an ad posts itself. With one: what the plan names
      // and is connected now, and the video posts itself in PUBLISH mode whatever its kind (the safety rule for a story told from memory
      // or about a recent case is in prepare.ts).
      const targets: Target[] = plan ? await targetsOfPlan(s, plan) : [s.fbPageId ? "FB" : null, s.igUserId ? "IG" : null].filter((t): t is Target => !!t);
      const autoPost = (plan ? true : kind === "ad") && s.videoAutoMode === "PUBLISH" && targets.length > 0;
      if (plan && s.videoAutoMode === "PUBLISH" && !autoPost) bump("draft_no_targets");
      const topic = plan ? await topicOfPlan(s, plan, lang) : null;
      const made = await createAdVideo({
        tenantId: s.tenantId,
        storeId: s.id,
        tier,
        topic,
        // No product chosen here: the daily plan aims the video (the product buyers ask about, an occasion, or the whole shop).
        productId: null,
        voice: voiceFor(lang, null, kind),
        targets,
        autoPost,
        source: "AUTO",
        createdById: s.tenant.ownerId ?? null,
        lang,
        kind,
        ...(plan && kind === "story"
          ? {
              // The owner's words go straight to the video maker unless the plan asks for the page to be read first (and with no words of
              // his own there is nothing to be literal about: the page's own concept steers the choice). Fiction is decided from HIS words,
              // before any review.
              literal: !plan.review && !!plan.brief,
              photos: plan.photos,
              format: plan.format === "wide" ? ("wide" as const) : ("vertical" as const),
              fiction: storyFictionAsked(plan.brief),
            }
          : {}),
        ...(plan?.youtube && targets.includes("YT") ? { youtube: plan.youtube } : {}),
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
      select: { id: true, tenantId: true, storeId: true, tier: true, status: true, createdAt: true, source: true, spec: true },
      take: 10,
    });
    for (const d of stuck) {
      const c = await db.adVideo.updateMany({ where: { id: d.id, status: d.status, tries: { gte: AD_MAX_TRIES } }, data: { status: "FAILED", error: "the video could not be made", claimedAt: null } });
      if (c.count === 1 && isVideoTier(d.tier)) {
        const voicePaid = await voiceWasPaid(d.tenantId, d.id);
        await refundVideo(d.tenantId, d.tier, d.createdAt, { keepDay: voicePaid });
        // An automatic story that failed before any voice was paid does not use up the store's day (bounded, see auto-day.ts).
        await giveBackAutoDay(d, { voicePaid });
      }
    }

    // An automatic story whose prepare failed for good (its last try) before any voice was paid does not use up the store's day.
    // (Giving the day back twice for the same job is harmless: the claim it belongs to is gone after the first time.)
    const failedStories = await db.adVideo.findMany({
      where: { source: "AUTO", status: "FAILED", updatedAt: { gte: new Date(Date.now() - FAILED_AUTO_LOOKBACK_MS) }, spec: { path: ["kind"], equals: "story" } },
      select: { id: true, tenantId: true, storeId: true, createdAt: true, source: true, spec: true },
      take: 10,
    });
    for (const d of failedStories) {
      if (!(await voiceWasPaid(d.tenantId, d.id)) && (await giveBackAutoDay(d, { voicePaid: false }))) out.day_given_back = (out.day_given_back ?? 0) + 1;
    }
  } catch (e) {
    console.error("[advideo] tick failed:", e instanceof Error ? e.message : "unknown error");
    out.failed = (out.failed ?? 0) + 1;
  }
  return out;
}
