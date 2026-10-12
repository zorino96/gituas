// A video's life before the renderer: QUEUED → (script by the director, voice by Pawan) → READY.
// The renderer (GitHub Actions, adfilm/) takes READY jobs; src/app/api/cron/ad-jobs hands them out.
//
// `tries` counts script/voice attempts while a job is QUEUED and render attempts while it is
// RENDERING: it goes back to 0 when the job becomes READY, so the two never eat each other's tries.
// An attempt holds a short lease (claimedAt) so two callers never prepare one video at once.

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { StorePlan } from "@/lib/shop/plans";
import { loadAdBrief, type AdBrief } from "./brief";
import { adVideoEnabled } from "./enabled";
import { allowance, countVideo, isVideoTier, videosUsed, type VideoTier } from "./limits";
import type { AdScene, AdSpec } from "./spec";
import { voiceScenes, type VoicedScene } from "./voice";
import { writeAdSpec } from "./write";

/** A job is tried this many times (script + voice, then render) before it is given up and its allowance returned. */
export const AD_MAX_TRIES = 3;
/** A render claimed this long ago and never reported is handed out again. */
export const AD_CLAIM_MS = 25 * 60 * 1000;
/** A script + voice attempt owns its job for this long; after that another caller may take over. */
export const AD_PREPARE_LEASE_MS = 90 * 1000;
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

export type Created = { ok: true; id: string } | { ok: false; error: "tier" | "limit" | "store" | "product" | "busy" };

/** Queues one video, if the store's plan allows another one of this tier this month. */
export async function createAdVideo(input: CreateInput): Promise<Created> {
  if (!isVideoTier(input.tier)) return { ok: false, error: "tier" };
  const store = await db.store.findFirst({ where: { id: input.storeId, tenantId: input.tenantId }, select: { id: true, plan: true } });
  if (!store) return { ok: false, error: "store" };
  if (input.productId) {
    const p = await db.product.findFirst({ where: { id: input.productId, storeId: store.id, active: true }, select: { id: true } });
    if (!p) return { ok: false, error: "product" };
  }
  const plan = store.plan as StorePlan;
  const a = allowance(plan, input.tier, await videosUsed(store.id, input.tier));
  if (a.left < 1) return { ok: false, error: a.limit === 0 ? "tier" : "limit" };
  // Not a pile of videos at once: parallel clicks can neither flood the render queue nor race the allowance.
  const inFlight = await db.adVideo.count({ where: { storeId: store.id, status: { in: ["QUEUED", "READY", "RENDERING"] } } });
  if (inFlight >= AD_IN_FLIGHT_MAX) return { ok: false, error: "busy" };
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
  await countVideo(store.id, input.tier, 1);
  return { ok: true, id: row.id };
}

export interface RenderScene extends AdScene {
  /** Public URL of the voice clip for this scene. */
  audio: string;
}

export interface RenderProps {
  version: 1;
  size: [number, number];
  style: AdSpec["style"];
  brand: { name: string; tagline: string | null; primary: string; accent: string; logoUrl: string | null; handle: string | null; phone: string | null };
  product: { name: string; priceLine: string | null } | null;
  photos: string[];
  scenes: RenderScene[];
  music: { style: "ambient" | "lofi" | "drive"; bpm: number; key: string; mode: "minor" | "major" };
}

const MUSIC: Record<AdSpec["style"], RenderProps["music"]> = {
  elegant: { style: "ambient", bpm: 84, key: "D", mode: "minor" },
  clean: { style: "lofi", bpm: 92, key: "C", mode: "major" },
  bold: { style: "drive", bpm: 118, key: "F", mode: "minor" },
};

/** Everything the renderer needs, as plain JSON (no secrets): brand, photos, the scenes with their voice clips. */
export function buildRenderProps(brief: AdBrief, style: AdSpec["style"], voiced: VoicedScene[]): RenderProps {
  return {
    version: 1,
    size: [1080, 1920],
    style,
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
    const brief = await loadAdBrief(found.storeId, found.productId);
    if (!brief) throw new Error("store not found");
    const tier: VideoTier = found.tier === "PRO" ? "PRO" : "LITE";
    const written = await writeAdSpec({ tier, brief, topic: found.topic });
    const voiced = await voiceScenes({ tenantId: found.tenantId, jobId: found.id, voice: found.voice, scenes: written.spec.scenes });
    const props = buildRenderProps(brief, written.spec.style, voiced);
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
        model: `${written.model}${written.fallback ? " (plain storyboard)" : ""}`.slice(0, 120),
        error: null,
      },
    });
    return true;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const last = tries >= AD_MAX_TRIES;
    const res = await db.adVideo.updateMany({ where: { id: found.id, status: "QUEUED" }, data: { error, claimedAt: null, status: last ? "FAILED" : "QUEUED" } });
    if (last && res.count === 1 && found.storeId && isVideoTier(found.tier)) await countVideo(found.storeId, found.tier, -1);
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
export async function allowances(storeId: string, plan: StorePlan): Promise<Record<VideoTier, { limit: number; used: number; left: number }>> {
  const [lite, pro] = await Promise.all([videosUsed(storeId, "LITE"), videosUsed(storeId, "PRO")]);
  return { LITE: allowance(plan, "LITE", lite), PRO: allowance(plan, "PRO", pro) };
}
