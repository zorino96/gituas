"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { db } from "@/lib/db";
import { assertWithin, countUsage, LimitReached, limitMessage } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { AiUnavailable, type Strength } from "@/lib/ai/provider";
import { catalogEntry } from "@/lib/news/catalog";
import { classifyPending } from "@/lib/news/classify";
import { ingest } from "@/lib/news/ingest";
import { checkDraft, LIMITS } from "@/lib/news/rules";
import { fetchFeed } from "@/lib/news/sources/rss";
import { normalizeChoice } from "@/lib/news/taxonomy";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";
import { cleanVoiceNote } from "@/lib/news/voice";
import { writeDraft } from "@/lib/news/write";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { currentWorkspace, type Workspace } from "@/app/app/data";

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

const NOT_NEWS = { ok: false as const, error: "ئەم بەشە تەنها بۆ پەیجی هەواڵە." };

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
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  try {
    const r = await ingest(ws.id, { force: true });
    after(() => classifyPending(ws.id));
    revalidatePath("/newsroom/news");
    return { ok: true, added: r.added, failed: r.failed };
  } catch {
    return { ok: false, error: "نوێکردنەوە سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە." };
  }
}

/**
 * Write (or rewrite) the draft for an item. `strong` is the editor's "improve".
 * writeDraft does the writing: the desk's own voice, the source-copy retries and the
 * cross-desk check, all kept inside Vercel's 60s action budget.
 */
export async function draftNewsAction(itemId: string, strength: Strength): Promise<Result<{ draft: DraftView }>> {
  const actionStart = Date.now();
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "draft")) return { ok: false, error: NOT_ALLOWED };
  if (strength !== "fast" && strength !== "strong") return { ok: false, error: "جۆری داواکراو دروست نییە." };
  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId: ws.id } });
  if (!item) return { ok: false, error: "هەواڵەکە نەدۆزرایەوە." };
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
    if (e instanceof LimitReached) return { ok: false, error: limitMessage(e) };
    if (e instanceof AiUnavailable) return { ok: false, error: "نووسینی خۆکار ئێستا بەردەست نییە. دەتوانیت خۆت بینووسیت." };
    return { ok: false, error: "ئامادەکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە." };
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
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "draft")) return { ok: false, error: NOT_ALLOWED };
  const item = await db.newsItem.findFirst({ where: { id: itemId, tenantId: ws.id } });
  if (!item) return { ok: false, error: "هەواڵەکە نەدۆزرایەوە." };
  if (!CARD_KINDS.includes(f.cardKind)) return { ok: false, error: "جۆری کارت دروست نییە." };
  if (f.photoPath && !isOwnPath(f.photoPath, ws.id)) return { ok: false, error: "وێنەکە ناناسرێتەوە." };
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
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "draft")) return { ok: false, error: NOT_ALLOWED };
  const draft = await db.newsDraft.findFirst({ where: { itemId, tenantId: ws.id }, include: { item: true } });
  if (!draft) return { ok: false, error: "سەرەتا دەقەکە پاشەکەوت بکە." };
  const problems = checkDraft(draft, draft.item);
  if (problems.length) return { ok: false, error: problems[0].message };
  if (!isOwnPath(card.pathname, ws.id) || !/^https:\/\//.test(card.url)) return { ok: false, error: "کارتەکە ناناسرێتەوە." };
  await db.newsDraft.update({ where: { id: draft.id }, data: { cardUrl: card.url, cardPath: card.pathname } });
  return { ok: true, draftId: draft.id };
}

export async function dismissNewsAction(itemId: string): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "draft")) return { ok: false, error: NOT_ALLOWED };
  await db.newsItem.updateMany({ where: { id: itemId, tenantId: ws.id }, data: { status: "DISMISSED" } });
  revalidatePath("/newsroom/news");
  return { ok: true };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export async function saveKeywordsAction(raw: string): Promise<Result<{ keywords: string[] }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
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
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  const entry = catalogEntry(catalogId);
  if (!entry) return { ok: false, error: "ئەم سەرچاوەیە بەردەست نییە." };
  const existing = await db.newsSource.findUnique({ where: { tenantId_catalogId: { tenantId: ws.id, catalogId } } });
  if (enabled && !existing?.enabled && !(await underSourceLimit(ws.id))) return { ok: false, error: "سنووری ژمارەی سەرچاوەکانی پاکێجەکەت پڕ بووە." };
  await db.newsSource.upsert({
    where: { tenantId_catalogId: { tenantId: ws.id, catalogId } },
    create: { tenantId: ws.id, catalogId, name: entry.name, enabled },
    update: { enabled },
  });
  return { ok: true };
}

/** Add the page's own feed; it must answer with at least one story. */
export async function addRssSourceAction(url: string, name: string): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  const u = url.trim();
  const n = name.trim().slice(0, 60);
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return { ok: false, error: "لینکەکە دروست نییە." };
  if (!n) return { ok: false, error: "ناوی سەرچاوەکە بنووسە." };
  if (!(await underSourceLimit(ws.id))) return { ok: false, error: "سنووری ژمارەی سەرچاوەکانی پاکێجەکەت پڕ بووە." };
  try {
    const items = await fetchFeed(u, n);
    if (!items.length) return { ok: false, error: "ئەم لینکە هیچ هەواڵێکی تێدا نییە." };
  } catch {
    return { ok: false, error: "ئەم لینکە RSS نییە یان وەڵام ناداتەوە." };
  }
  try {
    await db.newsSource.create({ data: { tenantId: ws.id, rssUrl: u, name: n } });
  } catch {
    return { ok: false, error: "ئەم سەرچاوەیە پێشتر زیاد کراوە." };
  }
  return { ok: true };
}

export async function removeSourceAction(id: string): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
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
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  if (![kit.primary, kit.accent, kit.text].every((c) => HEX.test(c))) return { ok: false, error: "ڕەنگەکان دروست نین." };
  if (kit.headingFont !== "kufi" && kit.headingFont !== "sans") return { ok: false, error: "فۆنتەکە دروست نییە." };
  if (kit.logoPath && !isOwnPath(kit.logoPath, ws.id)) return { ok: false, error: "لۆگۆکە ناناسرێتەوە." };
  const data = { logoPath: kit.logoPath, primary: kit.primary, accent: kit.accent, text: kit.text, headingFont: kit.headingFont };
  await db.brandKit.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, ...data }, update: data });
  return { ok: true };
}

/** The outlet's own writing style, added to every draft's instructions. Empty clears it. */
export async function saveVoiceNoteAction(raw: string): Promise<Result<{ voiceNote: string }>> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  const voiceNote = cleanVoiceNote(typeof raw === "string" ? raw : "");
  await db.newsSettings.upsert({
    where: { tenantId: ws.id },
    create: { tenantId: ws.id, keywords: [], voiceNote },
    update: { voiceNote },
    select: { tenantId: true },
  });
  return { ok: true, voiceNote: voiceNote ?? "" };
}

/** Which categories the desk keeps. An empty list keeps everything. */
export async function saveCategoriesAction(list: string[]): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  const categories = normalizeChoice(Array.isArray(list) ? list.slice(0, 60).map(String) : []);
  await db.newsSettings.upsert({ where: { tenantId: ws.id }, create: { tenantId: ws.id, keywords: [], categories }, update: { categories } });
  return { ok: true };
}

/** RSS stories must also match the keywords (off: categories alone decide). */
export async function setKeywordFilterAction(on: boolean): Promise<Result> {
  const ws = await newsWorkspace();
  if (!ws) return NOT_NEWS;
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  await db.newsSettings.upsert({
    where: { tenantId: ws.id },
    create: { tenantId: ws.id, keywords: [], keywordFilter: !!on },
    update: { keywordFilter: !!on },
  });
  return { ok: true };
}
