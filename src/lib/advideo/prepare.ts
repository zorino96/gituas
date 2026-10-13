// A video's life before the renderer: QUEUED → (script by the director, voice by Pawan) → READY.
// The renderer (GitHub Actions, adfilm/) takes READY jobs; src/app/api/cron/ad-jobs hands them out.
//
// `tries` counts script/voice attempts while a job is QUEUED and render attempts while it is
// RENDERING: it goes back to 0 when the job becomes READY, so the two never eat each other's tries.
// An attempt holds a short lease (claimedAt) so two callers never prepare one video at once.

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { loadAdBrief, type AdBrief } from "./brief";
import { adVideoEnabled } from "./enabled";
import { aiFor } from "@/lib/ai/for-store";
import { chooseTier } from "@/lib/ai/meter";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { claimVideoSlot, isVideoTier, refundVideo, workspaceVideos, type Allowance, type VideoTier } from "./limits";
import { refImagesForModel, listRefs } from "./refs";
import { PLAIN_VIDEO_NOTE } from "./job-error";
import type { AdLook, AdPlan, AdScene, AdSpec } from "./spec";
import { baghdadDate, getDailyBrief } from "./strategy";
import { voiceScenes, voiceWasPaid, type VoicedScene } from "./voice";
import { writeAdSpec } from "./write";

/** A job is tried this many times (script + voice, then render) before it is given up and its allowance returned. */
export const AD_MAX_TRIES = 3;
/** A render claimed this long ago and never reported is handed out again. */
export const AD_CLAIM_MS = 25 * 60 * 1000;
/** A script + voice attempt owns its job for this long; after that another caller may take over. */
export const AD_PREPARE_LEASE_MS = 90 * 1000;
/** The day's plan, made inside a video's preparation, may take this long (a page can wait longer). */
const PLAN_TIMEOUT_MS = 12_000;
/** Videos one store may have in the making at once. */
export const AD_IN_FLIGHT_MAX = 3;

export type Target = "FB" | "IG";

/** Videos ready to render, or rendering for so long that the worker must be gone. */
export function waitingFilter(now = Date.now()) {
  return { OR: [{ status: "READY" }, { status: "RENDERING", claimedAt: { lt: new Date(now - AD_CLAIM_MS) } }], tries: { lt: AD_MAX_TRIES } };
}

export interface CreateInput {
  tenantId: string;
  storeId: string;
  tier: VideoTier;
  topic: string | null;
  productId: string | null;
  voice: string;
  targets: Target[];
  autoPost: boolean;
  source: "MANUAL" | "AUTO";
  createdById: string | null;
}

export type Created = { ok: true; id: string } | { ok: false; error: "tier" | "limit" | "daily" | "ai" | "store" | "product" | "busy" };

/**
 * Queues one video, if the workspace's plans allow another one of this tier this month and today, and
 * the AI allowance has room for the script. The place in the day and the month is taken before the
 * row is made, in one step each (claimVideoSlot), so parallel requests cannot all pass.
 */
export async function createAdVideo(input: CreateInput): Promise<Created> {
  if (!isVideoTier(input.tier)) return { ok: false, error: "tier" };
  const store = await db.store.findFirst({ where: { id: input.storeId, tenantId: input.tenantId }, select: { id: true } });
  if (!store) return { ok: false, error: "store" };
  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, storeId: store.id, active: true }, select: { id: true } });
    if (!p) return { ok: false, error: "product" };
  }
  const limits = await limitsOf(input.tenantId);
  if (limits.videos[input.tier] === 0) return { ok: false, error: "tier" };
  // Without room in the AI allowance there is no script: the video would be a fixed template, with the voice still paid for.
  if (!(await chooseTier({ scope: input.tenantId }, "haiku").catch(() => "haiku" as const))) return { ok: false, error: "ai" };
  // Not a pile of videos at once on one store.
  const inFlight = await db.adVideo.count({ where: { storeId: store.id, status: { in: ["QUEUED", "READY", "RENDERING"] } } });
  if (inFlight >= AD_IN_FLIGHT_MAX) return { ok: false, error: "busy" };
  const slot = await claimVideoSlot(input.tenantId, input.tier, { month: limits.videos[input.tier], day: limits.videosPerDay });
  if (!slot.ok) return { ok: false, error: slot.error };
  try {
    const row = await db.adVideo.create({
      data: {
        tenantId: input.tenantId,
        storeId: store.id,
        tier: input.tier,
        source: input.source,
        topic: input.topic?.trim() ? Array.from(input.topic.trim()).slice(0, 300).join("") : null,
        productId: input.productId,
        voice: input.voice,
        targets: input.targets,
        autoPost: input.autoPost,
        createdById: input.createdById,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    await refundVideo(input.tenantId, input.tier).catch(() => undefined);
    throw e;
  }
}

export interface RenderScene extends AdScene {
  /** Public URL of the voice clip for this scene. */
  audio: string;
}

export interface RenderProps {
  version: 1;
  size: [number, number];
  style: AdSpec["style"];
  /** The design chosen for this brand and this day. */
  look: AdLook;
  /** What the video is for (the renderer shows the price only in conversion mode). */
  plan: Pick<AdPlan, "objective" | "priceMode" | "cta"> | null;
  brand: { name: string; tagline: string | null; primary: string; accent: string; logoUrl: string | null; handle: string | null; phone: string | null };
  product: { name: string; priceLine: string | null } | null;
  photos: string[];
  /** The owner's own clips. */
  clips: string[];
  scenes: RenderScene[];
  music: { style: "ambient" | "lofi" | "drive"; bpm: number; key: string; mode: "minor" | "major" };
}

const MUSIC: Record<AdSpec["style"], RenderProps["music"]> = {
  elegant: { style: "ambient", bpm: 84, key: "D", mode: "minor" },
  clean: { style: "lofi", bpm: 92, key: "C", mode: "major" },
  bold: { style: "drive", bpm: 118, key: "F", mode: "minor" },
};

/** Everything the renderer needs, as plain JSON (no secrets): brand, photos, the scenes with their voice clips. */
export function buildRenderProps(brief: AdBrief, spec: Pick<AdSpec, "style" | "look" | "plan">, voiced: VoicedScene[]): RenderProps {
  const style = spec.style;
  return {
    version: 1,
    size: [1080, 1920],
    style,
    look: spec.look,
    plan: spec.plan ? { objective: spec.plan.objective, priceMode: spec.plan.priceMode, cta: spec.plan.cta } : null,
    brand: {
      name: brief.name,
      tagline: brief.tagline,
      primary: brief.primary,
      accent: brief.accent,
      logoUrl: brief.logoUrl,
      handle: brief.handle,
      phone: brief.phone,
    },
    product: brief.product ? { name: brief.product.name, priceLine: brief.product.priceLine } : null,
    photos: brief.photos,
    clips: brief.clips,
    scenes: voiced.map((v) => ({ ...v.scene, audio: v.url })),
    music: MUSIC[style],
  };
}

/**
 * Writes the script and the voice of one QUEUED video and marks it READY. Returns true when the
 * video is READY. A failure leaves it QUEUED for the next tick, or FAILED (and the month's
 * allowance given back) after the last try. A killed attempt is picked up again when its lease ends.
 */
export async function prepareAdVideo(jobId: string): Promise<boolean> {
  if (!adVideoEnabled()) return false;
  const now = Date.now();
  const found = await db.adVideo.findUnique({ where: { id: jobId } });
  if (!found || found.status !== "QUEUED" || found.tries >= AD_MAX_TRIES) return false;
  if (found.claimedAt && now - found.claimedAt.getTime() < AD_PREPARE_LEASE_MS) return false;
  // Whoever flips the try counter owns this attempt; an attempt cut off mid-way still used one try.
  const took = await db.adVideo.updateMany({
    where: {
      id: found.id,
      status: "QUEUED",
      tries: found.tries,
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now - AD_PREPARE_LEASE_MS) } }],
    },
    data: { tries: { increment: 1 }, claimedAt: new Date(now) },
  });
  if (took.count !== 1) return false;
  const tries = found.tries + 1;
  try {
    if (!found.storeId) throw new Error("no store");
    const tier: VideoTier = found.tier === "PRO" ? "PRO" : "LITE";
    // Every model call of this video is counted against the store's monthly AI allowance.
    const ai = aiFor({ tenantId: found.tenantId }, { opus: tier === "PRO" });
    // The owner's reference pictures and clips, and today's plan (made once a day, the strategist always on the quick model).
    const [refs, planned] = await Promise.all([
      listRefs(found.tenantId, found.storeId),
      getDailyBrief({ tenantId: found.tenantId, storeId: found.storeId, tier: "LITE", timeoutMs: PLAN_TIMEOUT_MS, meter: ai?.meter }).catch(() => null),
    ]);
    const day = planned?.brief ?? null;
    // What the owner asked for wins over the day's plan: their own words, or a product other than the plan's.
    const ownerDirected = !!found.topic?.trim() || (!!found.productId && !!day && found.productId !== day.productId);
    let plan = ownerDirected ? null : day;
    // A video made without a product is the strategist's to aim: the product it picked, or the shop as a whole.
    let productId = found.productId ?? plan?.productId ?? null;
    let brief = await loadAdBrief(found.storeId, productId, refs);
    if (!brief) throw new Error("store not found");
    // A product the plan picked this morning may have sold out or lost its photo since: the video is then about the shop.
    if (!found.productId && productId && (!brief.product || !brief.product.inStock || brief.product.photos.length === 0)) {
      productId = null;
      plan = null;
      brief = await loadAdBrief(found.storeId, null, refs);
      if (!brief) throw new Error("store not found");
    }
    const recent = await db.adVideo.findMany({
      where: { storeId: found.storeId, id: { not: found.id }, spec: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { spec: true },
    });
    const recentSpecs = recent.map((r) => r.spec as { look?: AdLook; scenes?: { type?: string; text?: string }[] } | null);
    const avoidLooks = recentSpecs.map((r) => r?.look).filter((l): l is AdLook => !!l);
    const recentHooks = recentSpecs.map((r) => r?.scenes?.find((x) => x.type === "hook")?.text).filter((t): t is string => !!t);
    const images = await refImagesForModel(refs);
    // A script an earlier attempt wrote and then lost to a failing voice is kept: the director (Opus on the Opus
    // tier) is paid for once, not once per attempt.
    const earlier = found.spec as { scenes?: unknown } | null;
    const reuse = !found.props && earlier && Array.isArray(earlier.scenes) && earlier.scenes.length > 0 ? earlier : null;
    const written = reuse
      ? { spec: reuse as unknown as AdSpec, model: (found.model ?? "reused").replace(/ \(plain storyboard\)$/, ""), fallback: /plain storyboard/.test(found.model ?? "") }
      : await writeAdSpec({
          tier, brief, topic: found.topic, plan, avoidLooks, recentHooks, images, meter: ai?.meter,
          seed: `${found.storeId}:${baghdadDate(now)}:${found.id}`,
        });
    if (!reuse) {
      await db.adVideo.updateMany({
        where: { id: found.id, status: "QUEUED" },
        data: {
          spec: written.spec as unknown as Prisma.InputJsonValue,
          caption: written.spec.caption,
          model: `${written.model}${written.fallback ? " (plain storyboard)" : ""}`.slice(0, 120),
        },
      });
    }
    const voiced = await voiceScenes({ tenantId: found.tenantId, jobId: found.id, voice: found.voice, scenes: written.spec.scenes, meter: ai?.meter });
    const props = buildRenderProps(brief, written.spec, voiced);
    const spec: AdSpec = { ...written.spec, scenes: voiced.map((v) => v.scene) };
    await db.adVideo.updateMany({
      where: { id: found.id, status: "QUEUED" },
      data: {
        status: "READY",
        // The render starts with a clean count of its own.
        tries: 0,
        claimedAt: null,
        spec: spec as unknown as Prisma.InputJsonValue,
        props: props as unknown as Prisma.InputJsonValue,
        caption: written.spec.caption,
        productId,
        // A plain storyboard (the AI could not write this one) is never posted by itself: the owner looks at it first.
        ...(written.fallback ? { autoPost: false } : {}),
        model: `${written.model}${written.fallback ? " (plain storyboard)" : ""}`.slice(0, 120),
        error: written.fallback ? PLAIN_VIDEO_NOTE : null,
      },
    });
    return true;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const last = tries >= AD_MAX_TRIES;
    const res = await db.adVideo.updateMany({ where: { id: found.id, status: "QUEUED" }, data: { error, claimedAt: null, status: last ? "FAILED" : "QUEUED" } });
    // The month's place always goes back. The day's goes back too when no voice was paid for: a failure before
    // any money was spent should not use up the day's one video.
    if (last && res.count === 1 && isVideoTier(found.tier)) {
      await refundVideo(found.tenantId, found.tier, found.createdAt, { keepDay: await voiceWasPaid(found.tenantId, found.id) });
    }
    console.error("[advideo] prepare failed:", error);
    return false;
  }
}

/** Prepares queued videos, oldest first, while the call has time (one at a time: a PRO script can take 40 s). */
export async function prepareQueued(deadline: number, take = 3): Promise<number> {
  if (!adVideoEnabled()) return 0;
  const leaseEnds = new Date(Date.now() - AD_PREPARE_LEASE_MS);
  const queued = await db.adVideo.findMany({
    where: { status: "QUEUED", tries: { lt: AD_MAX_TRIES }, OR: [{ claimedAt: null }, { claimedAt: { lt: leaseEnds } }] },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, tier: true },
  });
  let done = 0;
  for (const q of queued) {
    // A PRO script needs most of a minute's budget; do not start one with less than 50 s left.
    if (deadline - Date.now() < (q.tier === "PRO" ? 50_000 : 30_000)) break;
    if (await prepareAdVideo(q.id)) done++;
  }
  return done;
}

/** What a store's plan allows, for the page. */
export async function allowances(tenantId: string): Promise<Record<VideoTier, Allowance> & { today: { used: number; max: number } }> {
  return workspaceVideos(tenantId);
}
