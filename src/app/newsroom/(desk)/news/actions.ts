"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { assertWithin, countUsage, LimitReached, limitMessage } from "@/lib/billing/limits";
import { canAutoPublish, NEWS_LIMITS, promptFilterFor } from "@/lib/billing/plans";
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
import { dict, getLang } from "@/lib/i18n";
import { currentWorkspace, loadConnections, type Workspace } from "@/app/app/data";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

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
    const saved = await db.newsDraft.upsert({ where: { itemId }, create: { itemId, ...data }, update: data });
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
}): Promise<Result> {
  const { ws, m } = await desk();
  if (!ws) return { ok: false, error: m.notNews };
  if (!can(ws.role, "configure")) return { ok: false, error: m.notAllowed };
  if (![kit.primary, kit.accent, kit.text].every((c) => HEX.test(c))) return { ok: false, error: m.badColors };
  if (kit.headingFont !== "kufi" && kit.headingFont !== "sans") return { ok: false, error: m.badFont };
  if (kit.logoPath && !isOwnPath(kit.logoPath, ws.id)) return { ok: false, error: m.badLogo };
  const data = { logoPath: kit.logoPath, primary: kit.primary, accent: kit.accent, text: kit.text, headingFont: kit.headingFont };
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
export async function saveAutopilotAction(input: { mode: string; targets: string[]; dailyMax: number; minGapMin: number }): Promise<Result> {
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
  const data = { autoMode: choice.mode, autoTargets: targets, autoDailyMax: choice.dailyMax, autoMinGapMin: choice.minGapMin };
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
