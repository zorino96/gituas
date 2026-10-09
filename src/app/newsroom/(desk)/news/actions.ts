"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { assertWithin, countUsage, LimitReached, limitMessage } from "@/lib/billing/limits";
import { canAutoPublish, NEWS_LIMITS, promptFilterFor, videoQuotaFor } from "@/lib/billing/plans";
import { del, put } from "@vercel/blob";
import { cleanDailyMax, isVideoMode, ownClips, prepareVideo, VIDEO_STYLES } from "@/lib/news/video";
import { CLIP_LIBRARY_MAX, cleanClipLabel, type LibraryClip } from "@/lib/news/clips";
import { isOwnPhoto, PHOTO_LIBRARY_MAX, photoForStory } from "@/lib/news/photos";
import { cleanSpeed, isPawanVoice, speak } from "@/lib/voice/tts";
import { AiUnavailable, type Strength } from "@/lib/ai/provider";
import { autoTargetsFor, parseAutopilot } from "@/lib/news/autopilot-settings";
import { catalogEntry } from "@/lib/news/catalog";
import { classifyPending } from "@/lib/news/classify";
import { cleanFocusPrompt, isFilterMode, judgeFocus, resetFocus } from "@/lib/news/focus";
import { ingest } from "@/lib/news/ingest";
import { checkDraft, LIMITS } from "@/lib/news/rules";
import { fetchFeed } from "@/lib/news/sources/rss";
import { normalizeChoice } from "@/lib/news/taxonomy";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";
import { cleanVoiceNote } from "@/lib/news/voice";
import { writeDraft } from "@/lib/news/write";
import { can } from "@/lib/newsroom/roles";
import { isFrameText } from "@/lib/cards/brand";
import { dict, getLang } from "@/lib/i18n";
import { currentWorkspace, loadConnections, type Workspace } from "@/app/app/data";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const VOICE_SAMPLE = "ئەمە دەنگی هەواڵنووسە. هەواڵەکانی ئەمڕۆ بەم دەنگە دەخوێنرێنەوە.";

export interface DraftView {
  draftId: string;
  headline: string;
  body: string;
  category: string;
  cardKind: CardKind;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
  model: string;
}

async function newsWorkspace(): Promise<Workspace | null> {
  const ws = await currentWorkspace();
  return ws && ws.kind === "NEWS" ? ws : null;
}

/** The workspace when it is a news desk, and the messages in the user's language. */
async function desk() {
  const [ws, t] = await Promise.all([newsWorkspace(), getLang().then(dict)]);
  return { ws, t, m: { ...t.nr.news.actions, notAllowed: t.nr.team.roles.notAllowed } };
}

/** A path must sit under this workspace's own folder and never contain a `..` segment. */
function isOwnPath(path: string, tenantId: string): boolean {
  return path.startsWith(`merchant/${tenantId}/`) && !path.includes("..");
}

function view(d: {
  id: string;
  headline: string;
  body: string;
  category: string;
  cardKind: string;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
  model: string;
}): DraftView {
  return {
    draftId: d.id,
    headline: d.headline,
    body: d.body,
    category: d.category,
    cardKind: (CARD_KINDS.includes(d.cardKind as CardKind) ? d.cardKind : "STANDARD") as CardKind,
    stat: d.stat,
    quote: d.quote,
    speaker: d.speaker,
    photoPath: d.photoPath,
    model: d.model,
  };
}

export async function refreshNewsAction(): Promise<Result<{ added: number; failed: string[] }>> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  try {
    const r = await ingest(ws.id, { force: true });
    after(() => classifyPending(ws.id));
    revalidatePath("/newsroom/news");
    return { ok: true, added: r.added, failed: r.failed };
  } catch {
    return { ok: false, error: m.refreshFailed };
  }
}

/**
 * Write (or rewrite) the draft for an item. `strong` is the editor's "improve".
 * writeDraft does the writing: the desk's own voice, the source-copy retries and the
 * cross-desk check, all kept inside Vercel's 60s action budget.
 */
export async function draftNewsAction(itemId: string, strength: Strength): Promise<Result<{ draft: DraftView }>> {
  const actionStart = Date.now();
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "draft")) return { ok: false, error: m.notAllowed };
  if (strength !== "fast" && strength !== "strong") return { ok: false, error: m.badStrength };
  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId: ws.id } });
  if (!item) return { ok: false, error: m.notFound };
  const metric = strength === "strong" ? "improve" : "draft";
  try {
    await assertWithin(ws.id, metric);
    const settings = await db.newsSettings.findUnique({ where: { tenantId: ws.id }, select: { voiceNote: true } });
    const { draft, model } = await writeDraft(ws.id, item, strength, { startedAt: actionStart, voiceNote: settings?.voiceNote });
    // A stale card must never go out with new text.
    const data = { ...draft, model, tenantId: ws.id, cardUrl: null, cardPath: null };
    let saved = await db.newsDraft.upsert({ where: { itemId }, create: { itemId, ...data }, update: data });
    // No photo yet: the desk's library photo that fits the story, if any. A person's own photo is kept.
    if (!saved.photoPath) {
      const photo = await photoForStory(ws.id, item);
      if (photo) saved = await db.newsDraft.update({ where: { id: saved.id }, data: { photoPath: photo } });
    }
    // One count per action, whatever the number of attempts writeDraft needed.
    await countUsage(ws.id, metric);
    if (item.status === "NEW") await db.newsItem.update({ where: { id: itemId }, data: { status: "DRAFTED" } });
    return { ok: true, draft: view(saved) };
  } catch (e) {
    if (e instanceof LimitReached) return { ok: false, error: limitMessage(e, m) };
    if (e instanceof AiUnavailable) return { ok: false, error: m.aiDown };
    return { ok: false, error: m.draftFailed };
  }
}

export interface DraftFields {
  headline: string;
  body: string;
  cardKind: CardKind;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
}

/** Save the editor's text. Creates the draft when the editor wrote it by hand. */
export async function saveNewsDraftAction(itemId: string, f: DraftFields): Promise<Result<{ draftId: string }>> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "draft")) return { ok: false, error: m.notAllowed };
  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId: ws.id } });
  if (!item) return { ok: false, error: m.notFound };
  if (!CARD_KINDS.includes(f.cardKind)) return { ok: false, error: m.badKind };
  if (f.photoPath && !isOwnPath(f.photoPath, ws.id)) return { ok: false, error: m.badPhoto };
  const clip = (s: string | null, max: number) => (s ? [...s.trim()].slice(0, max).join("") || null : null);
  const data = {
    headline: [...f.headline.trim()].slice(0, LIMITS.headline + 40).join(""),
    body: [...f.body.trim()].slice(0, LIMITS.body + 200).join(""),
    cardKind: f.cardKind,
    stat: clip(f.stat, 30),
    quote: clip(f.quote, 200),
    speaker: clip(f.speaker, 60),
    photoPath: f.photoPath,
    // A stale card must never go out with new text.
    cardUrl: null,
    cardPath: null,
  };
  const saved = await db.newsDraft.upsert({
    where: { itemId },
    create: { itemId, tenantId: ws.id, category: "گشتی", model: "manual", ...data },
    update: data,
  });
  if (item.status === "NEW") await db.newsItem.update({ where: { id: itemId }, data: { status: "DRAFTED" } });
  return { ok: true, draftId: saved.id };
}

/** Accept the rendered card, after checking the rules again on the server. */
export async function attachCardAction(itemId: string, card: { url: string; pathname: string }): Promise<Result<{ draftId: string }>> {
  const { ws, t, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "draft")) return { ok: false, error: m.notAllowed };
  const draft = await db.newsDraft.findFirst({ where: { itemId, tenantId: ws.id }, include: { item: true } });
  if (!draft) return { ok: false, error: m.saveFirst };
  const problems = checkDraft(draft, draft.item, t.nr.news);
  if (problems.length) return { ok: false, error: problems[0].message };
  if (!isOwnPath(card.pathname, ws.id) || !/^https:\/\//.test(card.url)) return { ok: false, error: m.badCard };
  await db.newsDraft.update({ where: { id: draft.id }, data: { cardUrl: card.url, cardPath: card.pathname } });
  return { ok: true, draftId: draft.id };
}

export async function dismissNewsAction(itemId: string): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "draft")) return { ok: false, error: m.notAllowed };
  await db.newsItem.updateMany({ where: { id: itemId, tenantId: ws.id }, data: { status: "DISMISSED" } });
  revalidatePath("/newsroom/news");
  return { ok: true };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function saveKeywordsAction(raw: string): Promise<Result<{ keywords: string[] }>> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const keywords = [...new Set(raw.split(/[,،\n]/).map((k) => k.trim()).filter((k) => k.length >= 2 && k.length <= 40 && !k.includes("|")))].slice(
    0,
    20,
  );
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords }, update: { keywords, lastFetchedAt: null } });
  return { ok: true, keywords };
}

async function underSourceLimit(tenantId: string): Promise<boolean> {
  const [tenant, count] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }),
    // Only switched-on sources use a slot, so switching one off frees it.
    db.newsSource.count({ where: { tenantId, enabled: true } }),
  ]);
  return count < NEWS_LIMITS[tenant?.plan ?? "MANUAL"].sources;
}

export async function toggleCatalogSourceAction(catalogId: string, enabled: boolean): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const entry = catalogEntry(catalogId);
  if (!entry) return { ok: false, error: m.sourceUnavailable };
  const existing = await db.newsSource.findUnique({ where: { tenantId_catalogId: { tenantId: ws.id, catalogId } } });
  if (enabled && !existing?.enabled && !(await underSourceLimit(ws.id))) return { ok: false, error: m.sourceLimit };
  await db.newsSource.upsert({
    where: { tenantId_catalogId: { tenantId: ws.id, catalogId } },
    create: { tenantId: ws.id, catalogId, name: entry.name, enabled },
    update: { enabled },
  });
  return { ok: true };
}

/** Add the page's own feed; it must answer with at least one story. */
export async function addRssSourceAction(url: string, name: string): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const u = url.trim();
  const n = name.trim().slice(0, 60);
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, error: m.badLink };
  if (!n) return { ok: false, error: m.needName };
  if (!(await underSourceLimit(ws.id))) return { ok: false, error: m.sourceLimit };
  try {
    const items = await fetchFeed(u, n);
    if (!items.length) return { ok: false, error: m.emptyFeed };
  } catch {
    return { ok: false, error: m.notRss };
  }
  try {
    await db.newsSource.create({ data: { tenantId: ws.id, rssUrl: u, name: n } });
  } catch {
    return { ok: false, error: m.duplicate };
  }
  return { ok: true };
}

export async function removeSourceAction(id: string): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  await db.newsSource.deleteMany({ where: { id, tenantId: ws.id, rssUrl: { not: null } } });
  return { ok: true };
}

const HEX = /^#[0-9a-f]{6}$/i;

export async function saveBrandKitAction(kit: {
  logoPath: string | null;
  primary: string;
  accent: string;
  text: string;
  headingFont: "kufi" | "sans";
  framePath?: string | null;
  frameText?: string;
}): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  if (![kit.primary, kit.accent, kit.text].every((c) => HEX.test(c))) return { ok: false, error: m.badColors };
  if (kit.headingFont !== "kufi" && kit.headingFont !== "sans") return { ok: false, error: m.badFont };
  if (kit.logoPath && !isOwnPath(kit.logoPath, ws.id)) return { ok: false, error: m.badLogo };
  const framePath = kit.framePath ?? null;
  if (framePath && (!isOwnPath(framePath, ws.id) || !/\.png$/i.test(framePath))) return { ok: false, error: m.badLogo };
  const data = {
    logoPath: kit.logoPath,
    primary: kit.primary,
    accent: kit.accent,
    text: kit.text,
    headingFont: kit.headingFont,
    framePath,
    frameText: isFrameText(kit.frameText) ? kit.frameText : "bottom",
  };
  await db.brandKit.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, ...data }, update: data });
  return { ok: true };
}

/** The outlet's own writing style, added to every draft's instructions. Empty clears it. */
export async function saveVoiceNoteAction(raw: string): Promise<Result<{ voiceNote: string }>> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const voiceNote = cleanVoiceNote(typeof raw === "string" ? raw : "");
  await db.newsSettings.upsert({
    where: { tenantId: ws.id },
    create: { tenantId: ws.id, keywords: [], voiceNote },
    update: { voiceNote },
    select: { tenantId: true },
  });
  return { ok: true, voiceNote: voiceNote ?? "" };
}

/**
 * The autopilot's settings. Nothing the form sends is trusted: the mode, the platforms and both
 * numbers are checked again here. Posting by itself is refused on a plan that does not include
 * it, and only connected Facebook and Instagram pages are ever saved as its targets.
 */
export async function saveAutopilotAction(input: {
  mode: string;
  targets: string[];
  dailyMax: number;
  minGapMin: number;
  quietFrom?: number | null;
  quietTo?: number | null;
}): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const choice = parseAutopilot(input);
  if (!choice) return { ok: false, error: m.badAutopilot };
  const conns = await loadConnections(ws.id);
  const targets = autoTargetsFor(choice.targets, { FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected });
  if (choice.mode === "PUBLISH") {
    const tenant = await db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } });
    if (!canAutoPublish(tenant?.plan)) return { ok: false, error: m.autoPlan };
    if (!targets.length) return { ok: false, error: m.autoTargets };
  }
  const data = {
    autoMode: choice.mode,
    autoTargets: targets,
    autoDailyMax: choice.dailyMax,
    autoMinGapMin: choice.minGapMin,
    autoQuietFrom: choice.quiet?.from ?? null,
    autoQuietTo: choice.quiet?.to ?? null,
  };
  await db.newsSettings.upsert({
    where: { tenantId: ws.id },
    create: { tenantId: ws.id, keywords: [], ...data },
    update: data,
    select: { tenantId: true },
  });
  return { ok: true };
}

/** Which categories the desk keeps. An empty list keeps everything. */
export async function saveCategoriesAction(list: string[]): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const categories = normalizeChoice(Array.isArray(list) ? list.slice(0, 60).map(String) : []);
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords: [], categories }, update: { categories } });
  return { ok: true };
}

/** RSS stories must also match the keywords (off: categories alone decide). */
export async function setKeywordFilterAction(on: boolean): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  await db.newsSettings.upsert({
    where: { tenantId: ws.id },
    create: { tenantId: ws.id, keywords: [], keywordFilter: !!on },
    update: { keywordFilter: !!on },
  });
  return { ok: true };
}

/** Which autopilot stories become videos, how many, and in which voice. Only plans with a video quota. */
export async function saveVideoSettingsAction(input: {
  mode: string;
  style?: string;
  topics: string[];
  dailyMax: number;
  voice: string;
  speed: number;
  prompt: string;
}): Promise<Result> {
  const { ws, m, t } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const tenant = await db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } });
  if (videoQuotaFor(tenant?.plan) < 1) return { ok: false, error: t.settings.news.videoPlanOnly };
  const data = {
    videoMode: isVideoMode(input?.mode) ? input.mode : "OFF",
    videoStyle: (VIDEO_STYLES as readonly string[]).includes(input?.style ?? "") ? input.style! : "TEMPLATE",
    videoTopics: normalizeChoice(Array.isArray(input?.topics) ? input.topics.slice(0, 60).map(String) : []),
    videoDailyMax: cleanDailyMax(input?.dailyMax),
    videoVoice: isPawanVoice(input?.voice) ? input.voice : "male",
    videoSpeed: cleanSpeed(input?.speed),
    // The prompt is ENTERPRISE's; on other plans what was saved stays as it is.
    ...(tenant?.plan === "ENTERPRISE" ? { videoPrompt: cleanFocusPrompt(input?.prompt) } : {}),
  };
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords: [], ...data }, update: data });
  return { ok: true };
}

/** Add one uploaded clip to the desk's footage library (automatic highlights). */
export async function addNewsClipAction(input: { url: string; label: string; general: boolean }): Promise<Result<{ clip: LibraryClip }>> {
  const { ws, m, t } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const tenant = await db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } });
  if (videoQuotaFor(tenant?.plan) < 1) return { ok: false, error: t.settings.news.videoPlanOnly };
  const own = ownClips(ws.id, [input?.url]);
  if (!own?.length) return { ok: false, error: m.notAllowed };
  const label = cleanClipLabel(input?.label);
  if (!label) return { ok: false, error: t.settings.news.clipBadLabel };
  if ((await db.newsClip.count({ where: { tenantId: ws.id } })) >= CLIP_LIBRARY_MAX) return { ok: false, error: t.settings.news.clipsFull(CLIP_LIBRARY_MAX) };
  const url = own[0];
  const clip = await db.newsClip.create({
    data: { tenantId: ws.id, url, pathname: new URL(url).pathname.slice(1), label, general: !!input?.general },
    select: { id: true, url: true, label: true, general: true },
  });
  return { ok: true, clip };
}

/** Remove a clip from the library, and its file. Videos already made from it keep their own copy. */
export async function deleteNewsClipAction(id: string): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const clip = await db.newsClip.findFirst({ where: { id: String(id), tenantId: ws.id }, select: { id: true, url: true } });
  if (!clip) return { ok: true };
  await db.newsClip.delete({ where: { id: clip.id } });
  await del(clip.url).catch(() => {});
  return { ok: true };
}

/** Add one uploaded photo to the desk's photo library (card backgrounds). */
export async function addNewsPhotoAction(input: { pathname: string; url: string; label: string; general: boolean }): Promise<Result<{ photo: LibraryPhoto }>> {
  const { ws, m, t } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  if (!isOwnPhoto(ws.id, input?.pathname) || typeof input?.url !== "string" || !input.url.startsWith("https://")) return { ok: false, error: m.badPhoto };
  const label = cleanClipLabel(input?.label);
  if (!label) return { ok: false, error: t.settings.news.clipBadLabel };
  if ((await db.newsPhoto.count({ where: { tenantId: ws.id } })) >= PHOTO_LIBRARY_MAX) return { ok: false, error: t.settings.news.photosFull(PHOTO_LIBRARY_MAX) };
  const photo = await db.newsPhoto.create({
    data: { tenantId: ws.id, url: input.url, pathname: input.pathname, label, general: !!input?.general },
    select: { id: true, pathname: true, label: true, general: true },
  });
  return { ok: true, photo };
}

/** Remove a photo from the library. Cards already made keep it; its file stays for them. */
export async function deleteNewsPhotoAction(id: string): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  await db.newsPhoto.deleteMany({ where: { id: String(id), tenantId: ws.id } });
  return { ok: true };
}

export interface LibraryPhoto {
  id: string;
  pathname: string;
  label: string;
  general: boolean;
}

export interface VideoView {
  id: string;
  status: string;
  style: string;
  videoUrl: string | null;
}

/**
 * A person makes a video of one draft: a HIGHLIGHT from their own uploaded clips, or the brand
 * TEMPLATE when there are none. It is rendered like the automatic ones but never posted by itself.
 */
export async function makeVideoAction(draftId: string, clips: string[]): Promise<Result<{ video: VideoView }>> {
  const { ws, m, t } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "publish")) return { ok: false, error: m.notAllowed };
  const [tenant, settings, draft] = await Promise.all([
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    db.newsSettings.findUnique({ where: { tenantId: ws.id }, select: { videoVoice: true, videoSpeed: true } }),
    db.newsDraft.findFirst({ where: { id: draftId, tenantId: ws.id }, select: { id: true, itemId: true } }),
  ]);
  if (videoQuotaFor(tenant?.plan) < 1) return { ok: false, error: t.settings.news.videoPlanOnly };
  if (!draft) return { ok: false, error: m.notFound };
  const own = ownClips(ws.id, clips);
  if (!own) return { ok: false, error: t.common.error };
  try {
    await assertWithin(ws.id, "video");
  } catch (e) {
    if (e instanceof LimitReached) return { ok: false, error: limitMessage(e, t.nr.news.actions) };
    throw e;
  }
  const job = await db.newsVideo.create({
    data: {
      tenantId: ws.id,
      itemId: draft.itemId,
      draftId: draft.id,
      style: own.length ? "HIGHLIGHT" : "TEMPLATE",
      clips: own,
      voice: isPawanVoice(settings?.videoVoice) ? settings!.videoVoice : "male",
      speed: cleanSpeed(settings?.videoSpeed),
      autoPost: false,
    },
    select: { id: true, status: true, style: true, videoUrl: true },
  });
  await countUsage(ws.id, "video");
  // Script and voice right after the answer; the render worker picks it up within a few minutes.
  after(() => prepareVideo(job.id).then(() => undefined));
  return { ok: true, video: job };
}

/** The newest video of a draft, to follow its progress. */
export async function videoStatusAction(draftId: string): Promise<Result<{ video: VideoView | null }>> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  const video = await db.newsVideo.findFirst({
    where: { tenantId: ws.id, draftId },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, style: true, videoUrl: true },
  });
  return { ok: true, video };
}

/** A few seconds of one Pawan voice at a speed, so the desk can hear it before choosing. */
export async function previewVoiceAction(voice: string, speed: number): Promise<Result<{ url: string }>> {
  const { ws, m, t } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const tenant = await db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } });
  if (videoQuotaFor(tenant?.plan) < 1) return { ok: false, error: t.settings.news.videoPlanOnly };
  if (!isPawanVoice(voice)) return { ok: false, error: t.common.error };
  const s = cleanSpeed(speed);
  try {
    const audio = await speak({ text: VOICE_SAMPLE, lang: "ckb", voice, speed: s });
    const blob = await put(`merchant/${ws.id}/voice-preview/${voice}-${s}.mp3`, audio.audio, {
      access: "public",
      contentType: audio.mime,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { ok: true, url: blob.url };
  } catch {
    return { ok: false, error: t.settings.news.videoVoiceFailed };
  }
}

/** Keywords or a prompt decide which stories the desk gets. The prompt is for plans that include it. */
export async function saveNewsFilterAction(input: { mode: string; focus: string; exclude: string; broad: boolean }): Promise<Result> {
  const { ws, m, t } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  const tenant = await db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } });
  const level = promptFilterFor(tenant?.plan);
  const mode = isFilterMode(input?.mode) ? input.mode : "KEYWORDS";
  if (mode === "PROMPT" && level === "none") return { ok: false, error: t.settings.news.filterPlanOnly };
  const data = {
    filterMode: mode,
    focusPrompt: cleanFocusPrompt(input?.focus),
    // Only ENTERPRISE has these; on AUTO what was saved before stays as it is.
    ...(level === "full" ? { excludePrompt: cleanFocusPrompt(input?.exclude), focusBroad: !!input?.broad } : {}),
  };
  if (mode === "PROMPT" && !data.focusPrompt && !(level === "full" && data.excludePrompt)) {
    return { ok: false, error: t.settings.news.filterEmpty };
  }
  const before = await db.newsSettings.findUnique({ where: { tenantId: ws.id } });
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords: [], ...data }, update: data });
  const changed =
    before?.filterMode !== data.filterMode ||
    before?.focusPrompt !== data.focusPrompt ||
    (level === "full" && (before?.excludePrompt !== data.excludePrompt || before?.focusBroad !== data.focusBroad));
  if (changed) {
    // New prompts: the recent stories are judged again, right after this response.
    await resetFocus(ws.id);
    after(() => judgeFocus(ws.id));
  }
  revalidatePath("/newsroom/news");
  return { ok: true };
}
