"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { isVideoTier } from "@/lib/advideo/limits";
import { aiFor } from "@/lib/ai/for-store";
import { createAdVideo, prepareAdVideo, type Target } from "@/lib/advideo/prepare";
import { publishAdVideo } from "@/lib/advideo/publish";
import { isVideoLang, langAndKindOf, storyFictionAsked, voiceFor } from "@/lib/advideo/lang";
import { parseVideoAutoPlan } from "@/lib/advideo/plan";
import { isRefPath, removeRef } from "@/lib/advideo/refs";
import { getDailyBrief, loadMarketNotes, readTodaysBrief, saveMarketNotes } from "@/lib/advideo/strategy";
import { dict, getLang } from "@/lib/i18n";
import { ownerJobError } from "@/lib/advideo/job-error";
import { reviewIdea, ReviewFailed } from "@/lib/ai/review-idea";
import { can } from "@/lib/newsroom/roles";
import { currentWorkspace } from "@/app/app/data";
import { videoChoice } from "./choice";
import { creditsOf } from "@/lib/advideo/credits";
import { ownerWaitNote } from "@/lib/advideo/wait-note";
import { prepareDeadline, storyTooShort, subjectViewOf, type StoryStatusView, type VideoFacts } from "./story-form";

/**
 * `reviewed`: the owner asked for the review and Gituas rewrote the idea. `reviewSkipped`: the owner asked for it but there was nothing to read (Gituas
 * does not know the page yet), so the owner's words were used as written: the screen and the chat say so with a neutral sentence, never "Reviewed".
 * `facts`: what the started video really is, read back from the stored job (see VideoFacts); left out when the job could not be read.
 */
export type VideoResult =
  | { ok: true; id?: string; reviewed?: { text: string; summary: string }; reviewSkipped?: { summary: string }; facts?: VideoFacts }
  | { ok: false; error: string };

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
 * What a started video really is, read back from its stored job (the spec stub createAdVideo wrote): the language and kind, the shape (wide only when
 * the stub says so) and, for a story, whether its photographs are on, switched off or none (fiction). Nothing here is what was asked for: when the
 * job cannot be read there are no facts (undefined), never a guess.
 */
async function factsOf(jobId: string, fiction: boolean): Promise<VideoFacts | undefined> {
  try {
    const row = await db.adVideo.findUnique({ where: { id: jobId }, select: { spec: true } });
    if (!row) return undefined;
    const spec = (row.spec ?? {}) as { format?: unknown; noPhotos?: unknown; fiction?: unknown };
    const { lang, kind } = langAndKindOf(row.spec);
    const facts: VideoFacts = { lang, kind, format: kind === "story" && spec.format === "wide" ? "wide" : "vertical" };
    if (kind === "story") facts.photos = fiction || spec.fiction === true ? "fiction" : spec.noPhotos === true ? "off" : "on";
    return facts;
  } catch {
    return undefined;
  }
}

/**
 * Queues one video; its script and voice are written right after the answer is sent, the render follows on its own.
 * `lang` ("ckb", "ar" or "en") and `kind` ("ad" or "story") are the person's choice; left out, the store's video language (Sorani when
 * it has none) decides the language, and the kind is an ad when a product is chosen, else what the page is for decides
 * (src/app/app/video/choice.ts).
 *
 * A story (any language) needs no product and is told from ONE real, documented case: the one the idea names, or, when it names none, one
 * Gituas chooses (the writer decides, not this action). `review` is the owner's choice for the idea: true = Gituas reads the page and its
 * earlier videos and rewrites the idea first (a story's review is src/lib/ai/review-idea.ts, kind "story"); false or left out = the owner's
 * words go through exactly as typed (a story is then LITERAL: the writer gets only the request). An ad's review works as it always did.
 * `photos` (a story about a real case): false switches the Wikimedia Commons photographs off; left out they are on.
 * `format` ("vertical" or "wide"; a story only, an ad ignores it): "wide" makes a 16:9 story for YouTube; left out it is vertical 9:16.
 *
 * Whether a story is told as fiction is decided HERE, once, from the owner's own original words (before any review rewrites them) and sent on as
 * a fact; the pipeline never decides it again from the rewritten text.
 */
export async function createVideoAction(
  storeId: string,
  input: {
    tier: string;
    topic: string;
    productId: string | null;
    voice: string;
    publish: boolean;
    targets: string[];
    review?: boolean;
    lang?: string;
    kind?: string;
    photos?: boolean;
    format?: string;
    /** The chat's own deadline (epoch ms): the chat turn is part of the same 60 s function, so the script and voice stop in time for it. */
    deadline?: number;
  },
): Promise<VideoResult> {
  // The function has 60 seconds from here: the script and voice that run after the answer share what is left of them (see the deadline below).
  const requestStart = Date.now();
  const r = await ownedStore(storeId, "publish");
  if (!r.ok) return r;
  if (!isVideoTier(input.tier)) return { ok: false, error: r.e.tier };
  const targets = targetsOf(input.targets, r.store);
  if (input.publish && !targets.length) return { ok: false, error: r.e.targets };
  const { lang: videoLang, kind } = await videoChoice(r.store.id, r.store.videoLang, { lang: input.lang, kind: input.kind, hasProduct: !!input.productId });
  const story = kind === "story";
  const original = input.topic.trim();
  let topic = original;
  // A story is told from the owner's idea: with no idea (a word or two at least) there is nothing to go on.
  if (story && storyTooShort(topic)) return { ok: false, error: r.e.topic };
  // The owner's own words decide whether the story is invented (never the rewritten idea of a review), and whether it is wide (stories only).
  const fiction = story && storyFictionAsked(original);
  const wide = story && input.format === "wide";
  // Gituas reviews the owner's idea first (when asked, and when there is an idea): an ad against the brand and its products, a story against the
  // page and its earlier videos. A review that cannot be done stops here, before anything is counted, and the owner chooses.
  let reviewed: { text: string; summary: string } | undefined;
  let reviewSkipped: { summary: string } | undefined;
  if (input.review === true && (story || topic.length >= 3)) {
    try {
      const lang = await getLang();
      const rev = await reviewIdea({ tenantId: r.ws.id, storeId: r.store.id, productId: story ? null : input.productId || null, idea: topic, kind: story ? "story" : "video", lang });
      if (!rev.kept) {
        topic = rev.text;
        reviewed = { text: rev.text, summary: rev.summary };
      } else if (rev.skipped === true || (story && rev.summary)) {
        // Nothing is known about the page yet: the owner's words stand, and the owner is told so plainly (not as a review that happened).
        reviewSkipped = { summary: rev.summary };
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
    // Real photographs from Wikimedia Commons for a true story: on unless the owner switched them off (the pipeline decides when they apply).
    photos: input.photos,
    // A story the owner did not ask Gituas to review goes through literally: the writer gets the request as typed and nothing about the page.
    ...(story ? { literal: input.review !== true } : {}),
    // Decided once, from the owner's own words (true when they asked for fiction, false when not): the pipeline keeps it in the job and every attempt
    // follows it; it never decides again from the (possibly rewritten) idea. An ad carries none.
    ...(story ? { fiction } : {}),
    // 16:9 for YouTube: only a story, and only when it was asked (absent = vertical 9:16, as every video was).
    ...(wide ? { format: "wide" as const } : {}),
  });
  if (!made.ok) return { ok: false, error: r.e[made.error] ?? r.e.failed };
  // The script and voice take 15 to 40 seconds: start them now, the clock picks them up if this is cut short. They are held to the end of THIS
  // function's 60 seconds (the review above and the loads before it already used some), not to 55 seconds from whenever they start; when the chat
  // started this, its turn is part of the same function, so its own deadline counts too (prepareDeadline).
  const deadline = prepareDeadline(requestStart, input.deadline);
  after(() => prepareAdVideo(made.id, deadline).then(() => undefined));
  revalidatePath("/app/video");
  const facts = await factsOf(made.id, fiction);
  return { ok: true, id: made.id, ...(reviewed ? { reviewed } : {}), ...(reviewSkipped ? { reviewSkipped } : {}), ...(facts ? { facts } : {}) };
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
 *
 * `plan` is the daily video's own plan, in the owner's words (src/lib/advideo/plan.ts): left out (undefined) the saved plan stays as it is; null
 * removes it (the daily video goes back to its usual way); anything else is read by parseVideoAutoPlan and must be a plan, and every platform
 * it names must really be connected (the daily run checks again, so a plan never posts anywhere that is not).
 */
export async function saveVideoAutoAction(storeId: string, input: { mode?: string; tier: string; hour: number; lang?: string; plan?: unknown }): Promise<VideoResult> {
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
  let plan: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
  if (input.plan === null) plan = Prisma.DbNull;
  else if (input.plan !== undefined) {
    const parsed = parseVideoAutoPlan(input.plan);
    if (!parsed) return { ok: false, error: r.e.failed };
    if (parsed.targets.length > 0) {
      const { connectedVideoTargets } = await import("@/lib/advideo/targets");
      const connected = await connectedVideoTargets(r.ws.id, r.store, parsed.targets);
      if (parsed.targets.some((t) => !connected.includes(t))) return { ok: false, error: r.e.targets };
    }
    plan = parsed as unknown as Prisma.InputJsonValue;
  }
  await db.store.update({
    where: { id: r.store.id },
    data: {
      ...(input.mode !== undefined ? { videoAutoMode: input.mode } : {}),
      videoAutoTier: input.tier,
      videoAutoHour: Math.round(Number(input.hour)),
      ...(isVideoLang(input.lang) ? { videoLang: input.lang } : {}),
      ...(plan !== undefined ? { videoAutoPlan: plan } : {}),
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
  | { ok: true; status: string; url: string | null; pathname: string | null; caption: string | null; error: string | null; story?: StoryStatusView }
  | { ok: false; error: string };

/**
 * Where one of this workspace's AI videos stands: the publish page waits on it while the video is made, and the chat shows a finished story with
 * what the owner needs to check it (the case, the told-from-memory and recent notes, the photo credits) from `story`.
 */
export async function videoJobStatusAction(jobId: string): Promise<VideoJobStatus> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws || !adVideoEnabled()) return { ok: false, error: t.video.errors.signIn };
  if (!can(ws.role, "publish")) return { ok: false, error: t.video.errors.notAllowed };
  const job = await db.adVideo.findFirst({ where: { id: String(jobId), tenantId: ws.id }, select: { status: true, videoUrl: true, videoPath: true, caption: true, error: true, spec: true } });
  if (!job) return { ok: false, error: t.video.errors.state };
  const ready = ["RENDERED", "POSTING", "POSTED"].includes(job.status);
  const { kind } = langAndKindOf(job.spec);
  const story: StoryStatusView | undefined =
    kind === "story"
      ? {
          ...subjectViewOf(job.spec),
          wide: (job.spec as { format?: unknown } | null)?.format === "wide",
          waited: ownerWaitNote(job.error, { memory: t.video.waitMemory, recent: t.video.waitRecent, fiction: t.video.waitFiction }),
          credits: creditsOf(job.spec).map((c) => ({ title: c.title, author: c.author, licence: c.licence, page: c.page })),
        }
      : undefined;
  return { ok: true, status: job.status, url: ready ? job.videoUrl : null, pathname: ready ? job.videoPath : null, caption: job.caption, error: ownerJobError(job.status, job.error, t.video.errors), ...(story ? { story } : {}) };
}
