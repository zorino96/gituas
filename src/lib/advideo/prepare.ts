// A video's life before the renderer: QUEUED → (script by the director, voice by Pawan) → READY.
// The renderer (GitHub Actions, adfilm/) takes READY jobs; src/app/api/cron/ad-jobs hands them out.
//
// `tries` counts script/voice attempts while a job is QUEUED and render attempts while it is
// RENDERING: it goes back to 0 when the job becomes READY, so the two never eat each other's tries.
// An attempt holds a short lease (claimedAt) so two callers never prepare one video at once.

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { loadAdBrief, type AdBrief } from "./brief";
import { crimeLike, deletePhotos, eraOfTexts, findStoryPhotos, isOwnPhotoUrl, STORY_PHOTO_BUDGET_MS, type Era, type FoundPhoto, type PhotoWanted } from "./commons";
import { creditRoom, creditScreen, creditsOf, fitCredits, storyCaption, type PhotoCredit, type PhotoFormat } from "./credits";
import { giveBackAutoDay } from "./auto-day";
import { adVideoEnabled } from "./enabled";
import { aiFor } from "@/lib/ai/for-store";
import { chooseTier } from "@/lib/ai/meter";
import { loadProfile } from "@/lib/shop/profile";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { providersFor } from "@/lib/voice/tts";
import { claimVideoSlot, isVideoTier, refundVideo, workspaceVideos, type Allowance, type VideoTier } from "./limits";
import { refImagesForModel, listRefs } from "./refs";
import { PLAIN_VIDEO_NOTE, StorySubjectMissing } from "./job-error";
import { channelAboutOf, langAndKindOf, langFields, storyModeOf, storyPhotosOn, videoKindOf, videoLangOf, voiceFor, type StoryMode, type StoryModeStub, type VideoKind, type VideoLang } from "./lang";
import type { AdLook, AdPlan, AdScene, AdSpec, YouTubeChoice } from "./spec";
import { baghdadDate, getDailyBrief } from "./strategy";
import { voiceScenes, voiceWasPaid, type VoicedScene } from "./voice";
import { waitNoteFor } from "./wait-note";
import { youtubeChoiceOf } from "./youtube";
import { writeAdSpec } from "./write";

/** A job is tried this many times (script + voice, then render) before it is given up and its allowance returned. */
export const AD_MAX_TRIES = 3;
/** A render claimed this long ago and never reported is handed out again. */
export const AD_CLAIM_MS = 25 * 60 * 1000;
/** A script + voice attempt owns its job for this long; after that another caller may take over. */
export const AD_PREPARE_LEASE_MS = 90 * 1000;
/** The day's plan, made inside a video's preparation, may take this long (a page can wait longer). */
const PLAN_TIMEOUT_MS = 12_000;
/** A function that prepares a video has about this long when it is not told its deadline (the cron routes give a PREPARE 55 of their 60 seconds). */
export const AD_PREPARE_BUDGET_MS = 55_000;
/** Kept back, after the voice is expected to be done, for storing the clips and saving the job. */
const VOICE_MARGIN_MS = 4_000;
/** The photo search starts only with this much of the budget left, and leaves this much for the voice's end and the save. */
const PHOTO_MIN_MS = 4_000;
const PHOTO_MARGIN_MS = 8_000;
/** After a failed voice, the photo stage (told to stop) is given this long to be over before the failure is saved. */
const PHOTO_SETTLE_MS = 2_500;

/**
 * About how long the voice of a script takes in one go. Pawan answers one request at a time (a beat takes some
 * five seconds); Gemini reads three at a time (a round takes some nine seconds).
 */
export function voiceEstimateMs(lang: VideoLang, scenes: number): number {
  return lang === "ckb" ? scenes * 5_000 : Math.ceil(scenes / 3) * 9_000;
}

/**
 * The time a queued video needs before it is worth starting. A PRO script needs most of a minute; a Haiku script 30 s. A
 * story that has no script yet needs more (a long answer and, in Sorani, the proofreader), so it is not started with less.
 */
export function prepareNeedMs(q: { tier: string; spec?: unknown }): number {
  if (q.tier === "PRO") return 50_000;
  const scenes = (q.spec as { scenes?: unknown } | null | undefined)?.scenes;
  const scripted = Array.isArray(scenes) && scenes.length > 0;
  return langAndKindOf(q.spec).kind === "story" && !scripted ? 45_000 : 30_000;
}
/** Videos one store may have in the making at once. */
export const AD_IN_FLIGHT_MAX = 3;

/** Where a video can be posted: the store's Facebook Page, its Instagram account, or the workspace's YouTube channel. */
export type Target = "FB" | "IG" | "YT";

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
  /** The language of the video; absent = Sorani. */
  lang?: VideoLang;
  /** What the video is; absent = an ad. A story has no product and its idea is the story to tell. */
  kind?: VideoKind;
  /** A documented story: false = no Wikimedia Commons photographs behind its beats (absent = with them). */
  photos?: boolean;
  /**
   * A story only: true = the owner's words go through exactly as typed (the idea was not reviewed), so the writer gets the request
   * and nothing of the page's profile or of its earlier videos' wording. Kept in the spec stub until the script is written.
   */
  literal?: boolean;
  /**
   * A story only: "wide" = a 16:9 video for YouTube (1920x1080); absent or "vertical" = the 9:16 reel. An ad is always vertical and ignores
   * it. Kept in the spec stub as `format: "wide"` (written only for a wide story) and read back by every attempt.
   */
  format?: "vertical" | "wide";
  /**
   * A story only: whether the owner's OWN words (as he typed them, before any review rewrote them) asked for fiction. Decided once by the
   * caller and kept in the spec stub as `fiction` (true when asked, false when decided against); every attempt then follows the stub,
   * and only a stub without it (a video queued before the flag existed) reads the topic. Absent = not decided: no flag is written.
   */
  fiction?: boolean;
  /**
   * The owner's own answers for YouTube (who can see the video, and whether it is made for kids), for a video that goes to YouTube
   * (`targets` holds "YT"). Kept in the spec stub as `youtube` and read back when the video is posted; both answers must be valid or nothing
   * is kept (the video is then never uploaded: no answer is guessed). Ignored when `targets` has no "YT".
   */
  youtube?: YouTubeChoice;
}

export type Created = { ok: true; id: string } | { ok: false; error: "tier" | "limit" | "daily" | "ai" | "store" | "product" | "busy" | "voice" | "topic" };

/** The longest idea a video keeps: a story is told from a longer request than an ad's. */
const TOPIC_MAX = { ad: 300, story: 1200 } as const;

/**
 * Queues one video, if the workspace's plans allow another one of this tier this month and today, and
 * the AI allowance has room for the script. The place in the day and the month is taken before the
 * row is made, in one step each (claimVideoSlot), so parallel requests cannot all pass.
 */
export async function createAdVideo(input: CreateInput): Promise<Created> {
  if (!isVideoTier(input.tier)) return { ok: false, error: "tier" };
  const lang = videoLangOf(input.lang);
  const kind = videoKindOf(input.kind);
  const story = kind === "story";
  // A story the owner makes by hand is told from their request; the daily automation may leave it empty (it picks the story).
  if (story && input.source === "MANUAL" && !input.topic?.trim()) return { ok: false, error: "topic" };
  const store = await db.store.findFirst({ where: { id: input.storeId, tenantId: input.tenantId }, select: { id: true } });
  if (!store) return { ok: false, error: "store" };
  // A story is about no product.
  if (!story && input.productId) {
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
  // Arabic and English are read by Gemini: without its key the voice would fail after the script was paid for.
  if (lang !== "ckb" && providersFor(lang).length === 0) return { ok: false, error: "voice" };
  const slot = await claimVideoSlot(input.tenantId, input.tier, { month: limits.videos[input.tier], day: limits.videosPerDay });
  if (!slot.ok) return { ok: false, error: slot.error };
  try {
    const topic = input.topic?.trim() ? Array.from(input.topic.trim()).slice(0, TOPIC_MAX[kind]).join("") : null;
    // The language and kind are kept in the spec until the script is written (a Sorani ad stores nothing); so is the owner's
    // choice of no photographs, but only for a story that would have had them, and a story's literal flag.
    const asked = story && typeof input.fiction === "boolean" ? { fiction: input.fiction } : null;
    const declared = Array.isArray(input.targets) && input.targets.includes("YT") ? youtubeChoiceOf(input.youtube) : null;
    const stub = {
      ...langFields(lang, kind),
      ...(story && input.photos === false && storyModeOf(kind, lang, topic, asked) === "real" ? { noPhotos: true as const } : {}),
      ...(story && input.literal === true ? { literal: true as const } : {}),
      ...(story && input.format === "wide" ? { format: "wide" as const } : {}),
      ...(asked ?? {}),
      ...(declared ? { youtube: declared } : {}),
    };
    const row = await db.adVideo.create({
      data: {
        tenantId: input.tenantId,
        storeId: store.id,
        tier: input.tier,
        source: input.source,
        topic,
        productId: story ? null : input.productId,
        voice: voiceFor(lang, input.voice, kind),
        targets: input.targets,
        autoPost: input.autoPost,
        createdById: input.createdById,
        ...(Object.keys(stub).length ? { spec: stub as Prisma.InputJsonValue } : {}),
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
  /** The language of the video (text direction, fonts per string stay per string); absent = Sorani. */
  lang?: VideoLang;
  /** What the video is; absent = an ad. */
  kind?: VideoKind;
  /** Written only for a story asked wide (16:9, size 1920x1080); absent = the vertical 9:16 reel. */
  format?: "wide";
  /** A story's photo credits as the few short lines the closing scene draws (credits.ts: creditScreen); absent when there are none. */
  credits?: string[];
  /** A story draws the page's mark (its logo, else a letter tile) only when the owner's request asked for it; absent = none. */
  mark?: true;
}

/** Whether the owner's own words ask for the page's logo / brand mark on the video (Sorani, Arabic, English). */
export function asksForMark(topic: string | null | undefined): boolean {
  return /لۆگ[ۆو]|لوگو|شعار|\blogo\b|watermark/iu.test(topic ?? "");
}

/** Whether the owner's own words ask for his uploaded reference pictures / clips in a story (Sorani, Arabic, English). */
export function asksForRefs(topic: string | null | undefined): boolean {
  return /[ڕر][یي]?فر[ێيی]?ن[سص]|مرجع|\breferences?\b|\bmy (own )?(clips?|videos?|photos?|pictures?)\b|ڤیدیۆکەم|ڤیدیۆکانم|وێنەکەم|وێنەکانم|کلیپەکەم|کلیپەکانم/iu.test(topic ?? "");
}

const MUSIC: Record<AdSpec["style"], RenderProps["music"]> = {
  elegant: { style: "ambient", bpm: 84, key: "D", mode: "minor" },
  clean: { style: "lofi", bpm: 92, key: "C", mode: "major" },
  bold: { style: "drive", bpm: 118, key: "F", mode: "minor" },
};

/**
 * Everything the renderer needs, as plain JSON (no secrets): brand, photos, the scenes with their voice clips.
 * The language and the kind are written only when they are not Sorani and not an ad. A story shows no product,
 * no plan and no phone number, and is set to the slow ambient music.
 */
export function buildRenderProps(brief: AdBrief, spec: Pick<AdSpec, "style" | "look" | "plan"> & { lang?: VideoLang; kind?: VideoKind; format?: "vertical" | "wide"; topic?: string | null }, voiced: VoicedScene[]): RenderProps {
  const style = spec.style;
  const lang = videoLangOf(spec.lang);
  const kind = videoKindOf(spec.kind);
  const story = kind === "story";
  // Only a story can be wide; an ad is always the vertical reel.
  const wide = story && spec.format === "wide";
  // An English video has no Arabic-script letters on it: a tagline written in them stays out (Sorani and Arabic send it as it is).
  const tagline = lang === "en" && brief.tagline && /\p{Script=Arabic}/u.test(brief.tagline) ? null : brief.tagline;
  return {
    version: 1,
    size: wide ? [1920, 1080] : [1080, 1920],
    style,
    look: spec.look,
    plan: !story && spec.plan ? { objective: spec.plan.objective, priceMode: spec.plan.priceMode, cta: spec.plan.cta } : null,
    brand: {
      name: brief.name,
      tagline,
      primary: brief.primary,
      accent: brief.accent,
      logoUrl: brief.logoUrl,
      handle: brief.handle,
      phone: story ? null : brief.phone,
    },
    product: !story && brief.product ? { name: brief.product.name, priceLine: brief.product.priceLine } : null,
    photos: brief.photos,
    clips: brief.clips,
    scenes: voiced.map((v) => ({ ...v.scene, audio: v.url })),
    music: story ? MUSIC.elegant : MUSIC[style],
    ...langFields(lang, kind),
    ...(wide ? { format: "wide" as const } : {}),
    ...(story && asksForMark(spec.topic) ? { mark: true as const } : {}),
  };
}

/** The hook and the story beats that want a photograph: they have picture queries and no picture or clip of the owner's. */
function wantedPhotos(scenes: AdScene[]): PhotoWanted[] {
  return scenes.flatMap((s, i) =>
    (s.type === "hook" || s.type === "story") && (s.photo ?? null) === null && (s.clip ?? null) === null && Array.isArray(s.queries) && s.queries.length
      ? [{ scene: i, queries: s.queries }]
      : [],
  );
}

/** Waits for a promise for at most `ms`, whatever it ends in (nothing is thrown). */
async function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([p.then(() => undefined, () => undefined), new Promise<void>((resolve) => (t = setTimeout(resolve, ms)))]);
  if (t) clearTimeout(t);
}

/**
 * Whether a script saved by an earlier attempt can be voiced as it is. An ad's always can. A story told as documented or as
 * invented must carry the subject the code set (a documented story: kind real; an invented one: kind fiction): a script from before
 * subjects existed, or written for another telling, is written again.
 */
export function scriptFitsMode(saved: { subject?: unknown } | null | undefined, mode: StoryMode): boolean {
  if (mode === "classic") return true;
  const kind = (saved?.subject as { kind?: unknown } | null | undefined)?.kind;
  return typeof (saved?.subject as { name?: unknown } | null | undefined)?.name === "string" && kind === (mode === "real" ? "real" : "fiction");
}

/** Subject names kept from the earlier stories (at most this many, of this many characters). */
const RECENT_SUBJECTS_MAX = 20;
const SUBJECT_NAME_MAX = 100;

/**
 * The cases this store's last stories were about (their `spec.subject.name`, newest first, without repeats), so that a case chosen
 * by the system is never one the page has told lately. A tolerant reader: a spec of another shape, a missing name or a failing
 * query gives nothing, never an error.
 */
export function subjectsOfSpecs(rows: { spec: unknown }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const name = (r?.spec as { subject?: { name?: unknown } | null } | null | undefined)?.subject?.name;
    if (typeof name !== "string") continue;
    const n = Array.from(name.replace(/\s+/g, " ").trim()).slice(0, SUBJECT_NAME_MAX).join("");
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
    if (out.length >= RECENT_SUBJECTS_MAX) break;
  }
  return out;
}

async function recentSubjectsOf(storeId: string, exceptId: string): Promise<string[]> {
  try {
    const rows = await db.adVideo.findMany({
      where: { storeId, id: { not: exceptId }, spec: { path: ["kind"], equals: "story" } },
      orderBy: { createdAt: "desc" },
      take: RECENT_SUBJECTS_MAX,
      select: { spec: true },
    });
    return subjectsOfSpecs(Array.isArray(rows) ? rows : []);
  } catch {
    return [];
  }
}

/** A promise that gives up after `ms` with an empty answer (the photo stage has its own clock; this is only a guard). */
function raceTimeout<T>(p: Promise<T[]>, ms: number): Promise<T[]> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve([]), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      () => (clearTimeout(t), resolve([])),
    );
  });
}

/** A promise's value within `ms`, else `fallback` (never throws). */
async function valueWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => (t = setTimeout(() => resolve(fallback), ms)))]);
  } finally {
    if (t) clearTimeout(t);
  }
}

const PHOTO_VIA = new Set(["article", "category", "search"]);

/**
 * The photographs an earlier attempt of this video found and stored, kept in its spec (`photoCache`) so that a retry does not search,
 * download, compose and upload them again. A tolerant reader: only entries that are complete, for a beat that exists, in the same frame
 * format and stored under THIS video's own folder are returned; anything else is ignored.
 */
export function readPhotoCache(spec: unknown, o: { tenantId: string; jobId: string; format: PhotoFormat; scenes: number }): FoundPhoto[] {
  const cache = (spec as { photoCache?: { format?: unknown; shots?: unknown } } | null | undefined)?.photoCache;
  if (!cache || typeof cache !== "object" || cache.format !== o.format || !Array.isArray(cache.shots)) return [];
  const own = `/merchant/${o.tenantId}/advideo/${o.jobId}/`;
  const seen = new Set<number>();
  const out: FoundPhoto[] = [];
  for (const raw of cache.shots) {
    const r = raw as { scene?: unknown; url?: unknown; via?: unknown; credit?: unknown } | null;
    if (!r || typeof r.scene !== "number" || !Number.isInteger(r.scene) || r.scene < 0 || r.scene >= o.scenes || seen.has(r.scene)) continue;
    if (!isOwnPhotoUrl(r.url) || !r.url.includes(own) || typeof r.via !== "string" || !PHOTO_VIA.has(r.via)) continue;
    const credit = creditsOf([{ ...(r.credit as object), scene: r.scene }])[0];
    if (!credit) continue;
    seen.add(r.scene);
    out.push({ scene: r.scene, url: r.url, via: r.via as FoundPhoto["via"], credit });
  }
  return out;
}

/** The photographs of a story as they are kept in its spec between attempts (see readPhotoCache). */
function photoCacheOf(shots: FoundPhoto[], format: PhotoFormat): { format: PhotoFormat; shots: { scene: number; url: string; via: string; credit: PhotoCredit }[] } {
  return { format, shots: shots.map((f) => ({ scene: f.scene, url: f.url, via: f.via, credit: f.credit })) };
}

/** The years a story covers: the subject's own era when the writer's step gave one, else the years its script names. Null = unknown. */
export function storyEraOf(spec: Pick<AdSpec, "scenes" | "caption"> & { subject?: unknown }): Era | null {
  const given = (spec.subject as { era?: { from?: unknown; to?: unknown } } | null | undefined)?.era;
  if (given && Number.isInteger(given.from) && Number.isInteger(given.to) && Number(given.to) >= 1000 && Number(given.to) <= 2100 && Number(given.from) <= Number(given.to)) {
    return { from: Number(given.from), to: Number(given.to) };
  }
  return eraOfTexts([...spec.scenes.flatMap((s) => [s.text, s.sub]), spec.caption]);
}

/** Whether the story is about a crime, a death or a mystery (so photographs of people are not used): read from its subject, picture phrases and words. */
export function storyIsCrime(spec: Pick<AdSpec, "scenes" | "caption"> & { subject?: unknown }): boolean {
  const name = (spec.subject as { name?: unknown } | null | undefined)?.name;
  return crimeLike([name, spec.caption, ...spec.scenes.flatMap((s) => [s.text, s.sub, s.visual, ...(Array.isArray(s.queries) ? s.queries : [])])]);
}

/**
 * Puts the Commons photographs into a story's render props. They come after the owner's own pictures in `photos`, in the order of
 * the beats, and each beat that got one points at it (an owner's picture or clip on a beat is kept and the beat gets no other). The
 * writer's picture queries and notes never reach the renderer. Returns the photographs that were placed (their credits are shown).
 */
export function placeStoryPhotos(props: RenderProps, found: FoundPhoto[]): { props: RenderProps; placed: FoundPhoto[] } {
  const base = props.photos.length;
  const at = new Map<number, number>();
  const placed: FoundPhoto[] = [];
  for (const f of [...found].sort((a, b) => a.scene - b.scene)) {
    const s = props.scenes[f.scene];
    if (!s || at.has(f.scene) || (s.type !== "hook" && s.type !== "story") || (s.photo ?? null) !== null || (s.clip ?? null) !== null) continue;
    at.set(f.scene, base + placed.length);
    placed.push(f);
  }
  const scenes = props.scenes.map((s, i) => {
    const c: RenderScene = { ...s };
    delete c.queries;
    delete c.visual;
    return at.has(i) ? { ...c, photo: at.get(i)! } : c;
  });
  return { props: { ...props, photos: [...props.photos, ...placed.map((f) => f.url)], scenes }, placed };
}

/**
 * Writes the script and the voice of one QUEUED video and marks it READY. Returns true when the
 * video is READY. A failure leaves it QUEUED for the next tick, or FAILED (and the month's
 * allowance given back) after the last try. A killed attempt is picked up again when its lease ends.
 * `deadline` is when the calling function is cut off: a story's writer is held to it, and a story whose script left too
 * little time for its voice is saved and left QUEUED (its try given back) for the next attempt to voice.
 */
export async function prepareAdVideo(jobId: string, deadline: number = Date.now() + AD_PREPARE_BUDGET_MS): Promise<boolean> {
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
  // The stored photographs of this attempt that are not (yet) in a saved spec: removed if the job fails for good.
  let pendingPhotoUrls: string[] = [];
  try {
    if (!found.storeId) throw new Error("no store");
    const tier: VideoTier = found.tier === "PRO" ? "PRO" : "LITE";
    // The video's language and kind were written into its spec when it was queued (a Sorani ad has none: that is the default).
    const { lang, kind } = langAndKindOf(found.spec);
    const story = kind === "story";
    // How a story is told: a documented subject with real photographs, or invented (in every language, Sorani too); an ad is classic.
    // The stub says whether the owner's own words asked for fiction (decided once, when the video was made); only a stub without that
    // flag (queued before it existed) reads the topic.
    const stubSpec = found.spec as { noPhotos?: unknown; literal?: unknown; format?: unknown; fiction?: unknown; youtube?: unknown } | null;
    const mode = storyModeOf(kind, lang, found.topic, stubSpec as StoryModeStub | null);
    const photosOn = storyPhotosOn(mode, stubSpec as { noPhotos?: boolean } | null);
    // The owner's choice of no photographs, of the literal telling of a story, of the wide (16:9) format and the decision about fiction
    // are written back with every save of the spec (langFields alone would drop them).
    const keepNoPhotos = stubSpec?.noPhotos === true ? { noPhotos: true as const } : {};
    const literal = story && stubSpec?.literal === true;
    const keepLiteral = literal ? { literal: true as const } : {};
    // Only a story can be wide; an ad is always the vertical reel.
    const wide = story && stubSpec?.format === "wide";
    const format: PhotoFormat = wide ? "wide" : "vertical";
    const keepFormat = wide ? { format: "wide" as const } : {};
    const keepFiction = story && typeof stubSpec?.fiction === "boolean" ? { fiction: stubSpec.fiction } : {};
    // The owner's answers for YouTube (who may see the video, made for kids or not) travel with every save of the spec, to be read when it is posted.
    const declared = youtubeChoiceOf(stubSpec?.youtube);
    const keepYoutube = declared ? { youtube: declared } : {};
    const keeps = { ...langFields(lang, kind), ...keepNoPhotos, ...keepLiteral, ...keepFormat, ...keepFiction, ...keepYoutube };
    // Every model call of this video is counted against the store's monthly AI allowance.
    const ai = aiFor({ tenantId: found.tenantId }, { opus: tier === "PRO" });
    // The owner's reference pictures and clips, and today's plan (made once a day, the strategist always on the quick model).
    // A story has no daily plan: it is not about a product or an offer.
    const [refs, planned] = await Promise.all([
      listRefs(found.tenantId, found.storeId),
      story ? Promise.resolve(null) : getDailyBrief({ tenantId: found.tenantId, storeId: found.storeId, tier: "LITE", timeoutMs: PLAN_TIMEOUT_MS, meter: ai?.meter }).catch(() => null),
    ]);
    const day = planned?.brief ?? null;
    // What the owner asked for wins over the day's plan: their own words, or a product other than the plan's.
    const ownerDirected = !!found.topic?.trim() || (!!found.productId && !!day && found.productId !== day.productId);
    let plan = story || ownerDirected ? null : day;
    // A video made without a product is the strategist's to aim: the product it picked, or the shop as a whole.
    let productId = story ? null : found.productId ?? plan?.productId ?? null;
    // The language and kind change what the brief holds (price words, no shop facts in a story); a Sorani ad asks as it always did.
    const briefOpts = lang === "ckb" && kind === "ad" ? [] : [{ lang, kind }];
    // A story uses the owner's reference pictures and clips only when his request asks for them (the owner's rule, 2026-10-24).
    const usedRefs = story && !asksForRefs(found.topic) ? [] : refs;
    let brief = await loadAdBrief(found.storeId, productId, usedRefs, ...briefOpts);
    if (!brief) throw new Error("store not found");
    // A product the plan picked this morning may have sold out or lost its photo since: the video is then about the shop.
    if (!story && !found.productId && productId && (!brief.product || !brief.product.inStock || brief.product.photos.length === 0)) {
      productId = null;
      plan = null;
      brief = await loadAdBrief(found.storeId, null, usedRefs, ...briefOpts);
      if (!brief) throw new Error("store not found");
    }
    // What the page is about, for a story to follow (its profile, when the owner filled one in). A literal story is told from the
    // owner's words alone: the page's profile does not steer it.
    const channel = story && !literal ? { about: channelAboutOf(await loadProfile(found.storeId).catch(() => null)) } : undefined;
    // The last videos of the same kind: their looks and hooks are not repeated. A row that only holds the language
    // stub (no scenes yet) says nothing, and a story's hooks are not an ad's.
    const recent = await db.adVideo.findMany({
      where: { storeId: found.storeId, id: { not: found.id }, spec: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { spec: true },
    });
    const recentSpecs = recent
      .map((r) => r.spec as { look?: AdLook; scenes?: { type?: string; text?: string }[] } | null)
      .filter((r) => !!r && Array.isArray(r.scenes) && langAndKindOf(r).kind === kind)
      .slice(0, 6);
    const avoidLooks = recentSpecs.map((r) => r?.look).filter((l): l is AdLook => !!l);
    // (a literal story is not steered by the wording of the page's earlier videos either)
    const recentHooks = literal ? [] : recentSpecs.map((r) => r?.scenes?.find((x) => x.type === "hook")?.text).filter((t): t is string => !!t);
    const images = await refImagesForModel(usedRefs);
    // A script an earlier attempt wrote and then lost to a failing voice is kept: the director (Opus on the Opus
    // tier) is paid for once, not once per attempt. A documented or invented story's saved script is kept only when it carries the
    // subject the code set (a job queued before subjects existed would otherwise go out as a documented story without one).
    const earlier = found.spec as { scenes?: unknown; subject?: unknown } | null;
    const saved = !found.props && earlier && Array.isArray(earlier.scenes) && earlier.scenes.length > 0 ? earlier : null;
    const reuse = saved && scriptFitsMode(saved, mode) ? saved : null;
    // The cases this page's earlier stories were about: a story picked by the system is never one of them.
    const recentSubjects = story && !reuse ? await recentSubjectsOf(found.storeId, found.id) : undefined;
    // (the language and kind are written with it: a retry reads them back from this spec)
    const written = reuse
      ? { spec: reuse as unknown as AdSpec, model: (found.model ?? "reused").replace(/ \(plain storyboard\)$/, ""), fallback: /plain storyboard/.test(found.model ?? "") }
      : await writeAdSpec({
          tier, brief, topic: found.topic, plan, avoidLooks, recentHooks, images, meter: ai?.meter,
          seed: `${found.storeId}:${baghdadDate(now)}:${found.id}`,
          lang, kind, channel, deadline, mode, photos: photosOn,
          ...(story ? { recentSubjects, literal } : {}),
        });
    if (!reuse) {
      await db.adVideo.updateMany({
        where: { id: found.id, status: "QUEUED" },
        data: {
          spec: { ...written.spec, ...keeps } as unknown as Prisma.InputJsonValue,
          caption: written.spec.caption,
          model: `${written.model}${written.fallback ? " (plain storyboard)" : ""}`.slice(0, 120),
        },
      });
      // A story's script and its voice together may not fit one run (the director answers in up to 50 s, Pawan reads a beat at a
      // time). When the script has left too little time, it stays saved and the voice is the next attempt's work, which finds the
      // script and starts with a full run; this attempt did not fail, so its try is given back.
      if (story && deadline - Date.now() < voiceEstimateMs(lang, written.spec.scenes.length) + VOICE_MARGIN_MS) {
        await db.adVideo.updateMany({ where: { id: found.id, status: "QUEUED", tries: { gt: 0 } }, data: { claimedAt: null, tries: { decrement: 1 } } });
        return false;
      }
    }
    // A documented story's beats are shown over Wikimedia Commons photographs. The search runs beside the voice (the English voice
    // alone takes 18 to 27 s) with its own short budget, so it never extends the run; it fails open and is skipped when time is short.
    const sceneCount = written.spec.scenes.length;
    // The photographs an earlier attempt found and stored are kept in the spec; a retry that reuses the script reuses them too (their
    // beats are the script's places) and searches only for the beats that have none. After a new script they are no longer wanted.
    const cached = photosOn && reuse ? readPhotoCache(found.spec, { tenantId: found.tenantId, jobId: found.id, format, scenes: sceneCount }) : [];
    const stale = cacheUrls(found.spec);
    if (stale.length && !(photosOn && reuse)) await deletePhotos(stale);
    const have = new Set(cached.map((f) => f.scene));
    const wanted: PhotoWanted[] = photosOn ? wantedPhotos(written.spec.scenes).filter((w) => !have.has(w.scene)) : [];
    const photoBudget = Math.min(STORY_PHOTO_BUDGET_MS, deadline - Date.now() - PHOTO_MARGIN_MS);
    const searching = wanted.length > 0 && photoBudget >= PHOTO_MIN_MS;
    // A story told from memory (no article was read) is not the article's own: its photographs only show the kind of thing.
    const subject = written.spec.subject as (AdSpec["subject"] & { fromMemory?: unknown }) | undefined;
    const fromMemory = subject?.fromMemory === true;
    // The pictures of the case's own Wikipedia article (set by the subject step) are the finder's first pool; it is stopped, and given a
    // moment to stop, when the voice fails, so that no search or upload goes on after this attempt is over.
    const photoStop = new AbortController();
    // Each photograph is written to the spec's photoCache as soon as it is stored: a function cut off at its time limit (nothing runs after
    // that, not even a catch) still leaves the next attempt the list of what was stored, and the list of what to delete if the job fails for good.
    const arrived: FoundPhoto[] = [];
    let cacheSaves: Promise<unknown> = Promise.resolve();
    const cacheBase = (): object => (reuse ? (found.spec as object) : { ...written.spec, ...keeps });
    const onPhoto = (photo: FoundPhoto): void => {
      arrived.push(photo);
      const all = [...cached, ...arrived];
      pendingPhotoUrls = all.map((f) => f.url);
      cacheSaves = cacheSaves
        .then(() =>
          db.adVideo.updateMany({
            where: { id: found.id, status: "QUEUED" },
            data: { spec: { ...cacheBase(), photoCache: photoCacheOf(all, format) } as unknown as Prisma.InputJsonValue },
          }),
        )
        .catch(() => undefined);
    };
    const searched: Promise<FoundPhoto[]> = searching
      ? raceTimeout(
          findStoryPhotos({
            tenantId: found.tenantId,
            jobId: found.id,
            subject: subject?.name ?? null,
            articleImages: subject?.images,
            wanted,
            budgetMs: photoBudget,
            signal: photoStop.signal,
            format,
            era: storyEraOf(written.spec),
            crime: storyIsCrime(written.spec),
            recent: subject?.recent === true,
            onPhoto,
          }).catch(() => [] as FoundPhoto[]),
          photoBudget + 3_000,
        )
      : Promise.resolve([] as FoundPhoto[]);
    let voiced: VoicedScene[];
    try {
      voiced = await voiceScenes({ tenantId: found.tenantId, jobId: found.id, voice: found.voice, scenes: written.spec.scenes, meter: ai?.meter, lang, kind });
    } catch (e) {
      photoStop.abort();
      // What the search had stored when it was stopped is kept in the spec for the next attempt (and removed if the job fails for good).
      const got = await valueWithin(searched, PHOTO_SETTLE_MS, [] as FoundPhoto[]);
      await valueWithin(cacheSaves, PHOTO_SETTLE_MS, undefined);
      const all = [...cached, ...got];
      if (all.length) {
        pendingPhotoUrls = all.map((f) => f.url);
        await db.adVideo
          .updateMany({ where: { id: found.id, status: "QUEUED" }, data: { spec: { ...cacheBase(), photoCache: photoCacheOf(all, format) } as unknown as Prisma.InputJsonValue } })
          .catch(() => undefined);
      }
      throw e;
    }
    const shots = [...cached, ...(await searched)].sort((a, b) => a.scene - b.scene);
    // (the cache writes of the photographs are over before the job is made READY, so none can land after it)
    await valueWithin(cacheSaves, PHOTO_SETTLE_MS, undefined);
    let props = buildRenderProps(brief, { ...written.spec, lang, kind, format: wide ? "wide" : undefined, topic: found.topic }, voiced);
    let credits: PhotoCredit[] = [];
    const placedUrls = new Set<string>();
    if (mode !== "classic") {
      // The photographs belong to beats by their place in the script: they are used only when the voice kept every beat (a story's always does).
      let usable = voiced.length === written.spec.scenes.length ? shots : [];
      if (fromMemory) usable = usable.map((f) => ({ ...f, credit: { ...f.credit, illustrative: true as const } }));
      // A photograph is shown only when the caption AND the video's own credit lines can name its author (CC BY, CC BY-SA): the ones that do not fit are dropped.
      if (usable.length) {
        const kept = new Set(fitCredits(lang, usable.map((f) => f.credit), creditRoom(written.spec.caption), format));
        usable = usable.filter((f) => kept.has(f.credit));
      }
      const placed = placeStoryPhotos(props, usable);
      props = placed.props;
      credits = placed.placed.map((f) => f.credit);
      for (const f of placed.placed) placedUrls.add(f.url);
      // the credits are drawn on the closing scene of the video itself, not only written in the post
      const screen = creditScreen(lang, credits, format);
      if (screen.lines.length) props = { ...props, credits: screen.lines };
    }
    // The post text names the photographs' authors (CC BY needs it) and, for an invented story, says so: by code, never by the model.
    const caption = mode === "classic" ? written.spec.caption : storyCaption({ caption: written.spec.caption, lang, credits, fiction: mode === "fiction" });
    const clean: Record<string, unknown> = { ...written.spec };
    delete clean.photoCache;
    delete clean.fiction;
    // (the finished spec says "fiction" only when the story is invented; the decision "not fiction" mattered only while it was queued)
    const finished = { ...keeps, ...(keepFiction.fiction === true ? { fiction: true as const } : {}) } as Record<string, unknown>;
    if (keepFiction.fiction !== true) delete finished.fiction;
    const spec = { ...(clean as unknown as AdSpec), scenes: voiced.map((v) => v.scene), caption, ...(credits.length ? { credits } : {}), ...finished } as AdSpec;
    // THE SAFETY RULE. A story is posted by itself (the daily routine, or the owner's own choice for a video made by hand) only when it was
    // told from an article that was really read, about a case that is not recent, as the kind of story the owner asked for. A story told
    // from memory, about a recent case (people in it may be alive), or invented without the owner's own words asking for fiction, is kept
    // as a draft with a plain note for the owner, whatever was asked. A plain storyboard (the AI could not write this one) waits too.
    const waits = story ? waitNoteFor({ mode, fictionAsked: stubSpec?.fiction === true, subject: written.spec.subject as { fromMemory?: unknown; recent?: unknown } | undefined }) : null;
    await db.adVideo.updateMany({
      where: { id: found.id, status: "QUEUED" },
      data: {
        status: "READY",
        // The render starts with a clean count of its own.
        tries: 0,
        claimedAt: null,
        spec: spec as unknown as Prisma.InputJsonValue,
        props: props as unknown as Prisma.InputJsonValue,
        caption,
        productId,
        ...(written.fallback || waits ? { autoPost: false } : {}),
        model: `${written.model}${written.fallback ? " (plain storyboard)" : ""}`.slice(0, 120),
        // The note is kept for a video that was to be posted by itself (it says why it was not); one that was never meant to be posted needs none.
        error: written.fallback ? PLAIN_VIDEO_NOTE : waits && found.autoPost === true ? waits : null,
      },
    });
    // The pictures that were stored and are not in the video (dropped for their credits, or for a beat that is gone) are deleted.
    const unused = shots.filter((f) => !placedUrls.has(f.url)).map((f) => f.url);
    if (unused.length) await deletePhotos(unused);
    return true;
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    // A story with no subject (or one the writer does not know) will not get better by trying again: it fails at once, and since no
    // voice was paid for, the month's place and the day's place both go back.
    const fatal = e instanceof StorySubjectMissing;
    const last = fatal || tries >= AD_MAX_TRIES;
    const res = await db.adVideo.updateMany({ where: { id: found.id, status: "QUEUED" }, data: { error, claimedAt: null, status: last ? "FAILED" : "QUEUED" } });
    // The month's place always goes back. The day's goes back too when no voice was paid for: a failure before
    // any money was spent should not use up the day's one video.
    if (last && res.count === 1 && isVideoTier(found.tier)) {
      const paid = await voiceWasPaid(found.tenantId, found.id);
      await refundVideo(found.tenantId, found.tier, found.createdAt, { keepDay: paid });
      // The daily automation's own day (Store.videoAutoLastAt) is given back when its story could not be made before any money was
      // spent: giveBackAutoDay (auto-day.ts) checks the job (an automatic story, no voice paid) and bounds the tries of a day.
      await giveBackAutoDay(found, { voicePaid: paid });
    }
    // A job that failed for good keeps no stored photographs.
    const stored = [...cacheUrls(found.spec), ...pendingPhotoUrls];
    if (last && stored.length) await deletePhotos(stored);
    console.error("[advideo] prepare failed:", error);
    return false;
  }
}

/** The addresses of the photographs kept in a spec's `photoCache` (any shape: only what is a string is returned). */
function cacheUrls(spec: unknown): string[] {
  const shots = (spec as { photoCache?: { shots?: unknown } } | null | undefined)?.photoCache?.shots;
  return Array.isArray(shots) ? shots.map((x) => (x as { url?: unknown } | null)?.url).filter((u): u is string => typeof u === "string") : [];
}

/** Prepares queued videos, oldest first, while the call has time (one at a time: a PRO script can take 40 s). */
export async function prepareQueued(deadline: number, take = 3): Promise<number> {
  if (!adVideoEnabled()) return 0;
  const leaseEnds = new Date(Date.now() - AD_PREPARE_LEASE_MS);
  const queued = await db.adVideo.findMany({
    where: { status: "QUEUED", tries: { lt: AD_MAX_TRIES }, OR: [{ claimedAt: null }, { claimedAt: { lt: leaseEnds } }] },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, tier: true, spec: true },
  });
  let done = 0;
  for (const q of queued) {
    // A PRO script needs most of a minute's budget (50 s), a story still to be written 45 s, any other 30 s.
    if (deadline - Date.now() < prepareNeedMs(q)) break;
    if (await prepareAdVideo(q.id, deadline)) done++;
  }
  return done;
}

/** What a store's plan allows, for the page. */
export async function allowances(tenantId: string): Promise<Record<VideoTier, Allowance> & { today: { used: number; max: number } }> {
  return workspaceVideos(tenantId);
}
