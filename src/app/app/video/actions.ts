"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { isVideoTier } from "@/lib/advideo/limits";
import { createAdVideo, prepareAdVideo, type Target } from "@/lib/advideo/prepare";
import { publishAdVideo } from "@/lib/advideo/publish";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { isPawanVoice } from "@/lib/voice/voices";
import { currentWorkspace } from "@/app/app/data";

export type VideoResult = { ok: true; id?: string } | { ok: false; error: string };

const HOURS = Array.from({ length: 24 }, (_, i) => i);

async function ownedStore(storeId: string, role: "publish" | "configure") {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  const e = t.video.errors;
  if (!ws || !adVideoEnabled()) return { ok: false, error: e.signIn } as const;
  if (!can(ws.role, role)) return { ok: false, error: e.notAllowed } as const;
  const store = await db.store.findFirst({ where: { id: storeId, tenantId: ws.id }, select: { id: true, fbPageId: true, igUserId: true } });
  if (!store) return { ok: false, error: e.store } as const;
  return { ok: true, ws, store, e } as const;
}

const targetsOf = (raw: unknown, store: { fbPageId: string | null; igUserId: string | null }): Target[] =>
  (Array.isArray(raw) ? raw : []).filter((t): t is Target => (t === "FB" && !!store.fbPageId) || (t === "IG" && !!store.igUserId));

/** Queues one video; its script and voice are written right after the answer is sent, the render follows on its own. */
export async function createVideoAction(
  storeId: string,
  input: { tier: string; topic: string; productId: string | null; voice: string; publish: boolean; targets: string[] },
): Promise<VideoResult> {
  const r = await ownedStore(storeId, "publish");
  if (!r.ok) return r;
  if (!isVideoTier(input.tier)) return { ok: false, error: r.e.tier };
  const targets = targetsOf(input.targets, r.store);
  if (input.publish && !targets.length) return { ok: false, error: r.e.targets };
  const made = await createAdVideo({
    tenantId: r.ws.id,
    storeId: r.store.id,
    tier: input.tier,
    topic: input.topic.trim() || null,
    productId: input.productId || null,
    voice: isPawanVoice(input.voice) ? input.voice : "shilan",
    targets,
    autoPost: input.publish && targets.length > 0,
    source: "MANUAL",
    createdById: null,
  });
  if (!made.ok) return { ok: false, error: r.e[made.error] ?? r.e.failed };
  // The script and voice take 15 to 40 seconds: start them now, the clock picks them up if this is cut short.
  after(() => prepareAdVideo(made.id).then(() => undefined));
  revalidatePath("/app/video");
  return { ok: true, id: made.id };
}

/** Posts a rendered video to the chosen platforms. */
export async function publishVideoAction(jobId: string, targets: string[]): Promise<VideoResult> {
  const ws = await currentWorkspace();
  const t = dict(await getLang()).video.errors;
  if (!ws || !adVideoEnabled()) return { ok: false, error: t.signIn };
  if (!can(ws.role, "publish")) return { ok: false, error: t.notAllowed };
  const job = await db.adVideo.findFirst({ where: { id: jobId, tenantId: ws.id }, select: { id: true, storeId: true } });
  if (!job?.storeId) return { ok: false, error: t.state };
  const store = await db.store.findUnique({ where: { id: job.storeId }, select: { fbPageId: true, igUserId: true } });
  const picked = store ? targetsOf(targets, store) : [];
  if (!picked.length) return { ok: false, error: t.targets };
  const r = await publishAdVideo(job.id, picked);
  revalidatePath("/app/video");
  return r.ok ? { ok: true, id: job.id } : { ok: false, error: t[r.error] ?? t.failed };
}

/** The daily video automation of one store. */
export async function saveVideoAutoAction(storeId: string, input: { mode: string; tier: string; hour: number }): Promise<VideoResult> {
  const r = await ownedStore(storeId, "configure");
  if (!r.ok) return r;
  if (!["OFF", "DRAFT", "PUBLISH"].includes(input.mode) || !isVideoTier(input.tier) || !HOURS.includes(Math.round(Number(input.hour)))) {
    return { ok: false, error: r.e.tier };
  }
  await db.store.update({
    where: { id: r.store.id },
    data: { videoAutoMode: input.mode, videoAutoTier: input.tier, videoAutoHour: Math.round(Number(input.hour)) },
  });
  revalidatePath("/app/video");
  return { ok: true };
}
