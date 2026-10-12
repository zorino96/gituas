// A video's life before the renderer: QUEUED → (script by the director, voice by Pawan) → READY.
// The renderer (GitHub Actions, adfilm/) takes READY jobs; src/app/api/cron/ad-jobs hands them out.

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { StorePlan } from "@/lib/shop/plans";
import { loadAdBrief, type AdBrief } from "./brief";
import { allowance, countVideo, isVideoTier, videosUsed, type VideoTier } from "./limits";
import type { AdScene, AdSpec } from "./spec";
import { voiceScenes, type VoicedScene } from "./voice";
import { writeAdSpec } from "./write";

/** A job is tried this many times (script + voice, and render) before it is given up and its allowance returned. */
export const AD_MAX_TRIES = 3;
/** A render claimed this long ago and never reported is handed out again. */
export const AD_CLAIM_MS = 25 * 60 * 1000;

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

export type Created = { ok: true; id: string } | { ok: false; error: "tier" | "limit" | "store" | "product" };

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
 * allowance given back) after the last try.
 */
export async function prepareAdVideo(jobId: string): Promise<boolean> {
  const found = await db.adVideo.findUnique({ where: { id: jobId } });
  if (!found || found.status !== "QUEUED" || found.tries >= AD_MAX_TRIES) return false;
  // Whoever flips the try counter owns this attempt; an attempt cut off mid-way still used one try.
  const took = await db.adVideo.updateMany({ where: { id: found.id, status: "QUEUED", tries: found.tries }, data: { tries: { increment: 1 } } });
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
    await db.adVideo.updateMany({ where: { id: found.id, status: "QUEUED" }, data: { error, status: last ? "FAILED" : "QUEUED" } });
    if (last && found.storeId && isVideoTier(found.tier)) await countVideo(found.storeId, found.tier, -1);
    console.error("[advideo] prepare failed:", error);
    return false;
  }
}

/** Prepares queued videos, oldest first, while the call has time (one at a time: a PRO script can take 40 s). */
export async function prepareQueued(deadline: number, take = 3): Promise<number> {
  const queued = await db.adVideo.findMany({
    where: { status: "QUEUED", tries: { lt: AD_MAX_TRIES } },
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

