"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { isVideoTier } from "@/lib/advideo/limits";
import { aiFor } from "@/lib/ai/for-store";
import { createAdVideo, prepareAdVideo, type Target } from "@/lib/advideo/prepare";
import { publishAdVideo } from "@/lib/advideo/publish";
import { isVideoLang, voiceFor } from "@/lib/advideo/lang";
import { isRefPath, removeRef } from "@/lib/advideo/refs";
import { getDailyBrief, loadMarketNotes, readTodaysBrief, saveMarketNotes } from "@/lib/advideo/strategy";
import { dict, getLang } from "@/lib/i18n";
import { ownerJobError } from "@/lib/advideo/job-error";
import { reviewIdea, ReviewFailed } from "@/lib/ai/review-idea";
import { can } from "@/lib/newsroom/roles";
import { currentWorkspace } from "@/app/app/data";
import { videoChoice } from "./choice";

export type VideoResult = { ok: true; id?: string; reviewed?: { text: string; summary: string } } | { ok: false; error: string };

const HOURS = Array.from({ length: 24 }, (_, i) => i);

async function ownedStore(storeId: string, role: "publish" | "configure") {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  const e = t.video.errors;
  if (!ws || !adVideoEnabled()) return { ok: false, error: e.signIn } as const;
  if (!can(ws.role, role)) return { ok: false, error: e.notAllowed } as const;
  const store = await db.store.findFirst({ where: { id: storeId, tenantId: ws.id }, select: { id: true, plan: true, fbPageId: true, igUserId: true, videoLang: true } });
  if (!store) return { ok: false, error: e.store } as const;
  return { ok: true, ws, store, e } as const;
}

const targetsOf = (raw: unknown, store: { fbPageId: string | null; igUserId: string | null }): Target[] =>
  (Array.isArray(raw) ? raw : []).filter((t): t is Target => (t === "FB" && !!store.fbPageId) || (t === "IG" && !!store.igUserId));

/**
 * Queues one video; its script and voice are written right after the answer is sent, the render follows on its own.
 * `lang` ("ckb", "ar" or "en") and `kind` ("ad" or "story") are the person's choice; left out, the store's video language (Sorani when
 * it has none) decides the language, and the kind is an ad when a product is chosen, else what the page is for decides
 * (src/app/app/video/choice.ts). A story needs no product and is never reviewed.
 */
export async function createVideoAction(
  storeId: string,
  input: { tier: string; topic: string; productId: string | null; voice: string; publish: boolean; targets: string[]; review?: boolean; lang?: string; kind?: string },
): Promise<VideoResult> {
  const r = await ownedStore(storeId, "publish");
  if (!r.ok) return r;
  if (!isVideoTier(input.tier)) return { ok: false, error: r.e.tier };
  const targets = targetsOf(input.targets, r.store);
  if (input.publish && !targets.length) return { ok: false, error: r.e.targets };
  const { lang: videoLang, kind } = await videoChoice(r.store.id, r.store.videoLang, { lang: input.lang, kind: input.kind, hasProduct: !!input.productId });
  const story = kind === "story";
  let topic = input.topic.trim();
  // A story is told from the owner's idea: with no idea there is nothing to tell.
  if (story && Array.from(topic).length < 10) return { ok: false, error: r.e.topic };
  // Gituas reviews the owner's idea against the brand first (when asked, and when there is an idea): a review that
  // cannot be done stops here, before anything is counted, and the owner chooses. It frames the idea as a shop ad, so a story skips it.
  let reviewed: { text: string; summary: string } | undefined;
  if (!story && input.review === true && topic.length >= 3) {
    try {
      const lang = await getLang();
      const rev = await reviewIdea({ tenantId: r.ws.id, storeId: r.store.id, productId: input.productId || null, idea: topic, kind: "video", lang });
      if (!rev.kept) {
        topic = rev.text;
        reviewed = { text: rev.text, summary: rev.summary };
      }
    } catch (err) {
      if (err instanceof ReviewFailed) return { ok: false, error: r.e.reviewFailed };
      throw err;
    }
  }
  const made = await createAdVideo({
    tenantId: r.ws.id,
    storeId: r.store.id,
    tier: input.tier,
    topic: topic || null,
    productId: story ? null : input.productId || null,
    voice: voiceFor(videoLang, input.voice, kind),
    targets,
    autoPost: input.publish && targets.length > 0,
    source: "MANUAL",
    createdById: null,
    lang: videoLang,
    kind,
  });
  if (!made.ok) return { ok: false, error: r.e[made.error] ?? r.e.failed };
  // The script and voice take 15 to 40 seconds: start them now, the clock picks them up if this is cut short.
  after(() => prepareAdVideo(made.id).then(() => undefined));
  revalidatePath("/app/video");
  return { ok: true, id: made.id, ...(reviewed ? { reviewed } : {}) };
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

/**
 * The daily video automation of one store. `lang` is the store's video language (the daily video, the Video form and the chat use it):
 * given, it must be one of the three and is saved with the rest; left out, the saved one stays as it is. `mode` works the same way: left
 * out (the chat changing only the language or the hour), the daily video stays on, or off, exactly as it was.
 */
export async function saveVideoAutoAction(storeId: string, input: { mode?: string; tier: string; hour: number; lang?: string }): Promise<VideoResult> {
  const r = await ownedStore(storeId, "configure");
  if (!r.ok) return r;
  if (
    (input.mode !== undefined && !["OFF", "DRAFT", "PUBLISH"].includes(input.mode)) ||
    !isVideoTier(input.tier) ||
    !HOURS.includes(Math.round(Number(input.hour))) ||
    (input.lang !== undefined && !isVideoLang(input.lang))
  ) {
    return { ok: false, error: r.e.tier };
  }
  await db.store.update({
    where: { id: r.store.id },
    data: {
      ...(input.mode !== undefined ? { videoAutoMode: input.mode } : {}),
      videoAutoTier: input.tier,
      videoAutoHour: Math.round(Number(input.hour)),
      ...(isVideoLang(input.lang) ? { videoLang: input.lang } : {}),
    },
  });
  revalidatePath("/app/video");
  return { ok: true };
}

/** A plan made less than this long ago is not made again (each one is a model call). */
const REPLAN_GAP_MS = 90_000;

/** Makes (or makes again) today's plan for a store. */
export async function refreshPlanAction(storeId: string): Promise<VideoResult> {
  const r = await ownedStore(storeId, "publish");
  if (!r.ok) return r;
  const existing = await readTodaysBrief(r.ws.id, r.store.id);
  if (existing?.madeAt && Date.now() - existing.madeAt < REPLAN_GAP_MS) {
    revalidatePath("/app/video");
    return { ok: true };
  }
  const made = await getDailyBrief({ tenantId: r.ws.id, storeId: r.store.id, tier: "LITE", force: true, meter: aiFor({ tenantId: r.ws.id }).meter });
  if (!made) return { ok: false, error: r.e.store };
  revalidatePath("/app/video");
  // The model could not be reached: the plan made earlier today (if any) stays, and the owner is told.
  return made.failed ? { ok: false, error: r.e.planFailed } : { ok: true };
}

/** The owner's own words about the market; the plan reads them every day. Saving them makes the plan again. */
export async function saveMarketNotesAction(storeId: string, text: string): Promise<VideoResult> {
  const r = await ownedStore(storeId, "publish");
  if (!r.ok) return r;
  if (typeof text !== "string") return { ok: false, error: r.e.failed };
  try {
    const before = await loadMarketNotes(r.ws.id, r.store.id);
    await saveMarketNotes(r.ws.id, r.store.id, text);
    // Words that did not change are no reason to ask the model again.
    if (before.trim() === Array.from(text.trim()).slice(0, 800).join("")) {
      revalidatePath("/app/video");
      return { ok: true };
    }
  } catch {
    return { ok: false, error: r.e.failed };
  }
  // New notes are always a reason to think again: no waiting period here.
  const made = await getDailyBrief({ tenantId: r.ws.id, storeId: r.store.id, tier: "LITE", force: true, meter: aiFor({ tenantId: r.ws.id }).meter });
  revalidatePath("/app/video");
  if (!made) return { ok: false, error: r.e.store };
  return made.failed ? { ok: false, error: r.e.notesPlanFailed } : { ok: true };
}

/** Removes one of the store's reference pictures or clips. */
export async function removeRefAction(storeId: string, pathname: string): Promise<VideoResult> {
  const r = await ownedStore(storeId, "publish");
  if (!r.ok) return r;
  if (!isRefPath(pathname, r.ws.id, r.store.id)) return { ok: false, error: r.e.state };
  const done = await removeRef(r.ws.id, r.store.id, pathname);
  revalidatePath("/app/video");
  return done ? { ok: true } : { ok: false, error: r.e.failed };
}

export type VideoJobStatus =
  | { ok: true; status: string; url: string | null; pathname: string | null; caption: string | null; error: string | null }
  | { ok: false; error: string };

/** Where one of this workspace's AI videos stands: the publish page waits on it while the video is made. */
export async function videoJobStatusAction(jobId: string): Promise<VideoJobStatus> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws || !adVideoEnabled()) return { ok: false, error: t.video.errors.signIn };
  if (!can(ws.role, "publish")) return { ok: false, error: t.video.errors.notAllowed };
  const job = await db.adVideo.findFirst({ where: { id: String(jobId), tenantId: ws.id }, select: { status: true, videoUrl: true, videoPath: true, caption: true, error: true } });
  if (!job) return { ok: false, error: t.video.errors.state };
  const ready = ["RENDERED", "POSTING", "POSTED"].includes(job.status);
  return { ok: true, status: job.status, url: ready ? job.videoUrl : null, pathname: ready ? job.videoPath : null, caption: job.caption, error: ownerJobError(job.status, job.error, t.video.errors) };
}
