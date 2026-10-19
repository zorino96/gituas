// Turns the news desk's rows into the two things a read tool returns: `data` for the MODEL (small: counts, ids, clipped titles; a
// stranger's text cut and stripped of phone numbers) and `view` blocks for the PERSON (their own desk in full, in their language).
// Pure: the tools in reads-news.ts do the reading and call these, so the rules are tested without a database.
//
// Ids: a story's `id` is the NewsItem id and is exactly what the story tools take; a Page or account `id` is what publish and schedule
// take; a catalog source `id` and a feed `id` are what the source tools take. Nothing here renames an id.

import { ago, kuDate, kuDateTime } from "@/app/app/format";
import type { AccountLists, InsightsResult } from "@/app/app/data";
import type { NewsSettingsProps } from "@/app/app/settings/news-settings";
import { NEWS_LIMITS, type Plan } from "@/lib/billing/plans";
import { planLabel } from "@/lib/billing/prices";
import type { NewsroomAccess } from "@/lib/billing/trial";
import type { Dict } from "@/lib/i18n/ckb";
import type { Lang } from "@/lib/i18n/lang";
import type { InboxGroup, InboxTab } from "@/lib/news/inbox";
import type { MPost } from "@/lib/merchant/types";
import type { YouTubeBlock } from "@/lib/merchant/youtube-insights";
import type { Problem } from "@/lib/news/rules";
import { categoryLabel, regionLabel } from "@/lib/news/taxonomy";
import { VOICE_NAMES } from "@/lib/voice/voices";
import { stripInvisible } from "../guard";
import type { ViewBlock } from "../types";
import { newsWords, type NewsWords } from "./reads-news-words";
import { baghdadIso, clip, compact, modelText, VIEW_TEXT_MAX, type Live } from "./reads-shared";
import { words } from "./reads-words";

// ---------------------------------------------------------------------------------------------------------------------
// Long text for the model

/**
 * The longest piece of one string the model reads: wrapForModel cuts every string of a result to 300 characters, so a text longer than
 * that is handed over in parts (join them with a space), each one safely under the cut.
 */
export const PART_MAX = 280;

/** A text in parts of at most `max` characters, cut at spaces where it can, never in the middle of an emoji. */
export function textParts(text: string | null | undefined, max = PART_MAX): string[] {
  let rest = stripInvisible(text ?? "").replace(/\s+/g, " ").trim();
  const out: string[] = [];
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) {
      cut = max;
      const unit = rest.charCodeAt(cut - 1);
      if (unit >= 0xd800 && unit <= 0xdbff) cut -= 1;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Words from the dictionaries

const tn = (t: Dict) => t.nr.news;
const langName = (t: Dict, lang: string | null): string => (lang ? ((t.nr.news.langs as Record<string, string>)[lang] ?? "") : "");
const topicCode = (category: string | null, sub: string | null): string | undefined => (category ? (sub ? `${category}/${sub}` : category) : undefined);

/** A topic code from the desk's choice ("politics" or "politics/elections") in the person's language. */
function topicName(code: string, t: Dict): string {
  const [category, sub] = code.split("/");
  return categoryLabel(category, sub ?? null, tn(t)) ?? code;
}

function voiceName(voice: string, lang: Lang, t: Dict): string {
  if (voice === "custom") return t.settings.news.cloneVoiceName;
  const names = (VOICE_NAMES as Record<string, { ku: string; en: string }>)[voice];
  return names ? (lang === "en" ? names.en : names.ku) : voice;
}

const platformName = (t: Dict, p: string): string => (t.platform as Record<string, string>)[p] ?? p;
const isHttps = (u: string | null | undefined): u is string => !!u && u.startsWith("https://");

/** Numbers in the person's digits, written "a / b". */
const ratio = (t: Dict, a: number, b: number): string => `${t.fmt.num(a)} / ${t.fmt.num(b)}`;

// ---------------------------------------------------------------------------------------------------------------------
// Stories

export type StoryState = "new" | "drafted" | "card_ready" | "published" | "dismissed";

/** Where a story stands: nothing yet, a draft, a draft with its card, published, or dismissed. */
export function storyState(i: { status: string; draft: { cardPath: string | null } | null }): StoryState {
  if (i.status === "DISMISSED") return "dismissed";
  if (i.status === "PUBLISHED") return "published";
  if (i.draft) return i.draft.cardPath ? "card_ready" : "drafted";
  return "new";
}

const stateLabel = (s: StoryState, nw: NewsWords): string => ({ new: nw.stateNew, drafted: nw.stateDrafted, card_ready: nw.stateCard, published: nw.statePublished, dismissed: nw.stateDismissed })[s];

/** One story of the inbox for the model. `id` is the story id every story tool takes. The title is a stranger's text. */
export function storyForModel(g: InboxGroup): Record<string, unknown> {
  const s = g.lead;
  return compact({
    id: s.id,
    title: modelText(s.title, 120),
    source: modelText(s.sourceName, 60),
    at: baghdadIso(s.publishedAt),
    lang: s.lang ?? undefined,
    topic: topicCode(s.category, s.subcategory),
    region: s.region ?? undefined,
    sources: g.count > 1 ? g.count : undefined,
    state: storyState(s),
    auto: s.draft?.auto || undefined,
  });
}

/** The inbox list the person reads: title, source, how many sources, age, language, topic, region; where it stands as the badge. */
export function storiesView(groups: InboxGroup[], total: number, tab: InboxTab, lang: Lang, t: Dict, base: string): ViewBlock[] {
  const nw = newsWords(lang);
  if (!groups.length) return [{ kind: "note", text: tn(t).list.empty }];
  return [
    {
      kind: "list",
      title: tn(t).list.tabs[tab],
      items: groups.map((g) => {
        const s = g.lead;
        return {
          title: clip(s.title, 160),
          sub: [
            s.sourceName,
            g.count > 1 ? tn(t).list.sourceCount(g.count) : "",
            ago(s.publishedAt.toISOString(), t),
            langName(t, s.lang),
            categoryLabel(s.category, s.subcategory, tn(t)) ?? "",
            regionLabel(s.region, tn(t)) ?? "",
          ]
            .filter(Boolean)
            .join(" · "),
          badge: [stateLabel(storyState(s), nw), s.draft?.auto ? tn(t).list.auto : ""].filter(Boolean).join(" · "),
          href: `${base}/news/${s.id}`,
        };
      }),
      more: total > groups.length ? total - groups.length : undefined,
      href: `${base}/news`,
    },
  ];
}

export interface StoryRow {
  id: string;
  title: string;
  snippet: string;
  sourceName: string;
  url: string;
  lang: string | null;
  publishedAt: Date;
  status: string;
  category: string | null;
  subcategory: string | null;
  region: string | null;
  imageUrl: string | null;
}

export interface DraftRow {
  id: string;
  headline: string;
  body: string;
  cardKind: string;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  photoPath: string | null;
  cardPath: string | null;
  auto: boolean;
  publishedAt: Date | null;
  results: unknown;
}

export interface StoryVideoRow {
  id: string;
  status: string;
  style: string;
  videoUrl: string | null;
  createdAt: Date;
}

/** Where a draft went, from NewsDraft.results (a platform, whether it worked, the account, the platform's error). */
export interface PostedTo {
  target: string;
  ok: boolean;
  account?: string;
  error?: string;
}

export function postedTo(results: unknown): PostedTo[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap((r): PostedTo[] => {
    const x = r as { target?: unknown; ok?: unknown; accountName?: unknown; error?: unknown } | null;
    if (!x || typeof x.target !== "string") return [];
    const out: PostedTo = { target: x.target, ok: x.ok === true };
    if (typeof x.accountName === "string" && x.accountName) out.account = clip(x.accountName, 60);
    if (x.ok !== true && typeof x.error === "string" && x.error) out.error = clip(x.error, 160);
    return [out];
  });
}

const ready = (v: Pick<StoryVideoRow, "status" | "videoUrl">): boolean => isHttps(v.videoUrl) && ["RENDERED", "POSTING", "POSTED"].includes(v.status);

/**
 * One story in full for the model. The source's words are a stranger's (phone numbers taken out, in parts); the draft is the desk's own
 * text and is given exactly as it is, in parts, so an edit can start from it. The source address is not handed over.
 */
export function storyDetailForModel(s: StoryRow, draft: DraftRow | null, video: StoryVideoRow | null, problems: Problem[], sources: number): Record<string, unknown> {
  const posted = draft ? postedTo(draft.results) : [];
  const cardReady = !!draft?.cardPath;
  return {
    ...compact({
      id: s.id,
      title: modelText(s.title, 200),
      source: modelText(s.sourceName, 60),
      at: baghdadIso(s.publishedAt),
      lang: s.lang ?? undefined,
      topic: topicCode(s.category, s.subcategory),
      region: s.region ?? undefined,
      state: storyState({ status: s.status, draft }),
      reportedBySources: sources > 1 ? sources : undefined,
      hasSourcePicture: s.imageUrl ? true : undefined,
    }),
    sourceText: textParts(modelText(s.snippet, 600)),
    draft: draft
      ? compact({
          id: draft.id,
          headline: clip(stripInvisible(draft.headline), 300),
          body: textParts(draft.body),
          cardKind: draft.cardKind,
          stat: draft.stat ? clip(stripInvisible(draft.stat), 60) : undefined,
          quote: draft.quote ? clip(stripInvisible(draft.quote), 250) : undefined,
          speaker: draft.speaker ? clip(stripInvisible(draft.speaker), 80) : undefined,
          hasPhoto: !!draft.photoPath,
          cardReady,
          writtenByAutopilot: draft.auto || undefined,
          publishedAt: baghdadIso(draft.publishedAt),
          problems: problems.length ? problems.map((p) => ({ code: p.code, message: p.message })) : undefined,
          readyToPublish: cardReady && problems.length === 0,
          postedTo: posted.length ? posted : undefined,
        })
      : null,
    video: video ? compact({ status: video.status, style: video.style, ready: ready(video) }) : undefined,
  };
}

/** The story for the person: where it stands, the source text, the draft with its rule problems, where it was posted, its video. */
export function storyView(
  s: StoryRow,
  draft: DraftRow | null,
  video: StoryVideoRow | null,
  problems: Problem[],
  lang: Lang,
  t: Dict,
  base: string,
): ViewBlock[] {
  const nw = newsWords(lang);
  const w = words(lang);
  const e = tn(t).editor;
  const state = storyState({ status: s.status, draft });
  const facts: { label: string; value: string }[] = [
    { label: e.sourceSec, value: s.sourceName },
    { label: w.date, value: kuDateTime(s.publishedAt.toISOString(), t) },
    { label: nw.language, value: langName(t, s.lang) },
    { label: tn(t).filters.topic, value: categoryLabel(s.category, s.subcategory, tn(t)) ?? "" },
    { label: tn(t).filters.region, value: regionLabel(s.region, tn(t)) ?? "" },
    { label: w.status, value: stateLabel(state, nw) },
  ].filter((x) => x.value);
  const blocks: ViewBlock[] = [{ kind: "stats", title: clip(s.title, 160), items: facts, href: `${base}/news/${s.id}` }];
  blocks.push({
    kind: "list",
    title: nw.sourceText,
    items: [{ title: clip(s.snippet, VIEW_TEXT_MAX) || t.common.noText, sub: s.sourceName, href: isHttps(s.url) ? s.url : undefined }],
  });
  if (!draft) {
    blocks.push({ kind: "note", text: nw.noDraft });
    return blocks;
  }
  const rows: { label: string; value: string }[] = [
    { label: e.headline, value: draft.headline },
    { label: e.body, value: clip(draft.body, 900) },
    { label: e.kindAria, value: (e.kinds as Record<string, string>)[draft.cardKind] ?? draft.cardKind },
    ...(draft.stat ? [{ label: e.stat, value: draft.stat }] : []),
    ...(draft.quote ? [{ label: e.quote, value: draft.quote }] : []),
    ...(draft.speaker ? [{ label: e.speaker, value: draft.speaker }] : []),
    { label: nw.photoRow, value: draft.photoPath ? nw.yes : nw.no },
    { label: nw.cardRow, value: draft.cardPath ? nw.cardMade : nw.cardMissing },
  ];
  blocks.push({ kind: "stats", title: [nw.draftTitle, draft.auto ? tn(t).list.auto : ""].filter(Boolean).join(" · "), items: rows });
  for (const p of problems) blocks.push({ kind: "note", tone: "warn", text: p.message });
  const posted = postedTo(draft.results);
  if (posted.length) {
    blocks.push({
      kind: "list",
      title: nw.whereTitle,
      items: posted.map((p) => ({ title: [platformName(t, p.target), p.account].filter(Boolean).join(" · "), sub: p.error, badge: p.ok ? nw.posted : w.failed })),
    });
  }
  if (video) {
    blocks.push({
      kind: "list",
      title: nw.videoRow,
      items: [{ title: nw.videoStatus[video.status] ?? video.status, sub: kuDateTime(video.createdAt.toISOString(), t), href: ready(video) ? (video.videoUrl as string) : undefined }],
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------------
// Videos

export interface NewsVideoRow {
  id: string;
  itemId: string;
  draftId: string;
  status: string;
  autoPost: boolean;
  videoUrl: string | null;
  createdAt: Date;
}

/** A video for the model; `story` is the story id (the NewsItem id) it belongs to. The headline is the draft's. */
export function newsVideoForModel(v: NewsVideoRow, headline: string | undefined): Record<string, unknown> {
  return compact({
    id: v.id,
    story: v.itemId,
    headline: headline ? clip(stripInvisible(headline), 120) : undefined,
    status: v.status,
    ready: ready(v),
    autoPost: v.autoPost,
    at: baghdadIso(v.createdAt),
  });
}

export function newsVideosView(rows: NewsVideoRow[], headlines: Map<string, string>, month: { used: number; quota: number }, lang: Lang, t: Dict, base: string): ViewBlock[] {
  const nw = newsWords(lang);
  const e = tn(t).editor;
  const blocks: ViewBlock[] = [];
  if (month.quota > 0) blocks.push({ kind: "stats", items: [{ label: t.billing.features.label.videos, value: ratio(t, month.used, month.quota) }], href: `${base}/video-setup` });
  if (!rows.length) {
    blocks.push({ kind: "note", text: e.listEmpty });
    return blocks;
  }
  blocks.push({
    kind: "list",
    title: e.listTitle,
    items: rows.map((v) => ({
      title: clip(headlines.get(v.draftId) ?? "", 120) || "—",
      sub: [kuDateTime(v.createdAt.toISOString(), t), v.autoPost && v.status === "POSTED" ? e.listAuto : ""].filter(Boolean).join(" · "),
      badge: nw.videoStatus[v.status] ?? v.status,
      href: ready(v) ? (v.videoUrl as string) : undefined,
    })),
    href: `${base}/videos`,
  });
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------------
// The desk and its plan

export interface DeskStateInput {
  now: number;
  name: string;
  plan: string;
  access: NewsroomAccess;
  paidUntil: Date | null;
  /** Stories in each tab of the inbox. */
  counts: Record<InboxTab, number>;
  publishedToday: number;
  scheduled: number;
  scheduledFailed: number;
  lastFetchedAt: Date | null;
  refreshSec: number;
  accounts: AccountLists;
  autopilot: string;
  filter: string;
  sourcesOn: number;
}

/** How the desk's access stands, for the model. */
function accessForModel(a: NewsroomAccess, paidUntil: Date | null): Record<string, unknown> {
  return compact({
    mayWrite: a.active,
    status: a.reason,
    trialDaysLeft: a.reason === "trial" ? (a.daysLeft ?? undefined) : undefined,
    paidUntil: a.reason === "paid" && paidUntil ? baghdadIso(paidUntil)?.slice(0, 10) : undefined,
  });
}

export function deskStateForModel(i: DeskStateInput): Record<string, unknown> {
  const names = (list: { name: string }[]) => list.map((a) => clip(a.name, 60));
  return compact({
    now: baghdadIso(i.now),
    desk: modelText(i.name, 60),
    plan: i.plan,
    access: accessForModel(i.access, i.paidUntil),
    stories: { new: i.counts.new, draftsReady: i.counts.ready, published: i.counts.done, publishedToday: i.publishedToday },
    scheduledPosts: i.scheduled,
    failedScheduledPostsLast14Days: i.scheduledFailed || undefined,
    lastRefresh: baghdadIso(i.lastFetchedAt),
    refreshEverySec: i.refreshSec,
    sourcesOn: i.sourcesOn,
    autopilot: i.autopilot,
    newsFilter: i.filter,
    connected: {
      facebook: names(i.accounts.META_FACEBOOK),
      instagram: names(i.accounts.META_INSTAGRAM),
      tiktok: names(i.accounts.TIKTOK),
      youtube: names(i.accounts.YOUTUBE),
    },
  });
}

/** The plan and what its access is right now, as one line for the person. */
function planLine(plan: string, a: NewsroomAccess, paidUntil: Date | null, lang: Lang, t: Dict): string {
  const nw = newsWords(lang);
  const detail =
    a.reason === "trial" ? t.billing.trialLeft(a.daysLeft ?? 0) : a.reason === "paid" && paidUntil ? t.billing.activeUntil(kuDate(paidUntil.toISOString(), t)) : a.reason === "frozen" ? nw.frozenShort : nw.openPlan;
  return `${planLabel(plan, lang)} · ${detail}`;
}

export function deskStateView(i: DeskStateInput, lang: Lang, t: Dict, base: string): ViewBlock[] {
  const nw = newsWords(lang);
  const w = words(lang);
  const fmt = t.billing.features;
  const account = (list: { name: string }[]) => (list.length ? list.map((a) => a.name).join(t.fmt.listSep) : w.notConnected);
  const items = [
    { label: t.billing.current, value: planLine(i.plan, i.access, i.paidUntil, lang, t) },
    { label: nw.newStories, value: t.fmt.num(i.counts.new) },
    { label: nw.readyStories, value: t.fmt.num(i.counts.ready) },
    { label: nw.publishedToday, value: t.fmt.num(i.publishedToday) },
    { label: nw.scheduledPosts, value: t.fmt.num(i.scheduled) },
    ...(i.scheduledFailed ? [{ label: nw.failedPosts, value: t.fmt.num(i.scheduledFailed) }] : []),
    { label: nw.lastRefresh, value: i.lastFetchedAt ? ago(i.lastFetchedAt.toISOString(), t, i.now) : nw.neverRefreshed },
    { label: fmt.label.refresh, value: fmt.refresh(i.refreshSec) },
    { label: platformName(t, "FB"), value: account(i.accounts.META_FACEBOOK) },
    { label: platformName(t, "IG"), value: account(i.accounts.META_INSTAGRAM) },
    { label: platformName(t, "TT"), value: account(i.accounts.TIKTOK) },
    { label: platformName(t, "YT"), value: account(i.accounts.YOUTUBE) },
    { label: t.nr.shell.nav.items.autopilot, value: (t.settings.news.autoMode as Record<string, string>)[i.autopilot] ?? i.autopilot },
    { label: t.settings.news.filterSec, value: (t.settings.news.filterMode as Record<string, string>)[i.filter] ?? i.filter },
  ];
  return [{ kind: "stats", title: i.name || nw.deskTitle, items, href: `${base}/news` }];
}

export interface UsageInput {
  plan: string;
  access: NewsroomAccess;
  paidUntil: Date | null;
  used: { draft: number; improve: number; publish: number; video: number };
  sources: { on: number };
  frames: { month: number; day: number; capMonth: number; capDay: number };
  focus: { month: number; day: number; capMonth: number; capDay: number };
  voice: { month: number; day: number; capMonth: number; capDay: number };
  /** Assistant chats left; null when it cannot be told. */
  chat: { day: number; month: number } | null;
  /** What the assistant may still change and post today (the day's fences, counted by the confirm step). */
  fences: { changes: number; posts: number };
}

const limitsOf = (plan: string) => NEWS_LIMITS[plan as Plan] ?? NEWS_LIMITS.MANUAL;

export function usageForModel(i: UsageInput): Record<string, unknown> {
  const lim = limitsOf(i.plan);
  const left = (c: { month: number; day: number; capMonth: number; capDay: number }) => ({
    todayLeft: Math.max(0, c.capDay - c.day),
    monthLeft: Math.max(0, c.capMonth - c.month),
  });
  return compact({
    plan: i.plan,
    access: accessForModel(i.access, i.paidUntil),
    thisMonth: {
      drafts: { used: i.used.draft, limit: lim.draft },
      improvements: { used: i.used.improve, limit: lim.improve },
      publishes: { used: i.used.publish, limit: lim.publish },
      videos: { used: i.used.video, limit: lim.video },
    },
    sources: { on: i.sources.on, limit: lim.sources },
    refreshEverySec: lim.refreshSec,
    mayPublishAutomatically: lim.autoPublish,
    newsByPrompt: lim.promptFilter,
    aiFrames: left(i.frames),
    newsPromptChanges: left(i.focus),
    voicePreviews: left(i.voice),
    assistantChatsLeft: i.chat ?? undefined,
    assistantMayStillToday: { changes: i.fences.changes, posts: i.fences.posts },
  });
}

export function usageView(i: UsageInput, lang: Lang, t: Dict, base: string): ViewBlock[] {
  const nw = newsWords(lang);
  const lim = limitsOf(i.plan);
  const label = t.billing.features.label;
  const counter = (c: { month: number; day: number; capMonth: number; capDay: number }) => `${ratio(t, c.day, c.capDay)} · ${ratio(t, c.month, c.capMonth)}`;
  const items = [
    { label: label.drafts, value: ratio(t, i.used.draft, lim.draft) },
    { label: label.improves, value: ratio(t, i.used.improve, lim.improve) },
    { label: label.publishes, value: ratio(t, i.used.publish, lim.publish) },
    ...(lim.video > 0 ? [{ label: label.videos, value: ratio(t, i.used.video, lim.video) }] : []),
    { label: label.sources, value: ratio(t, i.sources.on, lim.sources) },
    { label: label.refresh, value: t.billing.features.refresh(lim.refreshSec) },
    { label: nw.framesAi, value: counter(i.frames) },
    { label: nw.focusChanges, value: counter(i.focus) },
    { label: nw.voicePreviews, value: counter(i.voice) },
    ...(i.chat ? [{ label: nw.chatTurns, value: `${t.fmt.num(i.chat.day)} · ${t.fmt.num(i.chat.month)}` }] : []),
    { label: nw.changesLeft, value: t.fmt.num(i.fences.changes) },
    { label: nw.postsLeft, value: t.fmt.num(i.fences.posts) },
  ];
  return [{ kind: "stats", title: `${t.billing.current}: ${planLine(i.plan, i.access, i.paidUntil, lang, t)}`, items, href: `${base}/billing` }];
}

// ---------------------------------------------------------------------------------------------------------------------
// Insights

/** What the desk itself did over the period, from its own tables. */
export interface DeskCounts {
  received: number;
  drafted: number;
  byAutopilot: number;
  published: number;
  videos: number;
  /** Failed posts by platform ("FB": 2). */
  failed: Record<string, number>;
}

export interface DeskInsightsRead {
  connections: { FB: boolean; IG: boolean; YT: boolean };
  account: Live<InsightsResult>;
  youtube: Live<YouTubeBlock | null>;
  posts: Live<MPost[]>;
}

const IG_KEYS = ["followers", "reach_7d", "reach_28d", "posts"] as const;
const YT_KEYS = ["subscribers", "views", "videos"] as const;

/** The posts with the most comments (the captions are written by the public, so they are a stranger's text). */
function topPostsOf(r: DeskInsightsRead): MPost[] {
  return r.posts.ok
    ? [...r.posts.value]
        .filter((p) => p.commentCount > 0)
        .sort((a, b) => b.commentCount - a.commentCount || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .slice(0, 5)
    : [];
}

/** What was asked for but did not come back (a connected account whose platform failed or ran out of time). */
export function insightsMissing(r: DeskInsightsRead): string[] {
  const meta = r.connections.FB || r.connections.IG;
  const yt = r.youtube.ok ? r.youtube.value : null;
  return [
    ...(meta && !r.account.ok ? ["facebook_and_instagram_numbers"] : []),
    ...(meta && !r.posts.ok ? ["top_posts"] : []),
    ...(r.connections.YT && (!r.youtube.ok || yt?.error) ? ["youtube_numbers"] : []),
  ];
}

export function insightsForModel(days: number, own: DeskCounts, r: DeskInsightsRead): Record<string, unknown> {
  const yt = r.youtube.ok ? r.youtube.value : null;
  const missing = insightsMissing(r);
  const failed = Object.entries(own.failed).filter(([, n]) => n > 0);
  return compact({
    days,
    desk: compact({
      storiesReceived: own.received,
      draftsWritten: own.drafted,
      writtenByAutopilot: own.byAutopilot,
      storiesPublished: own.published,
      videosMade: own.videos,
      failedPostsByPlatform: failed.length ? Object.fromEntries(failed) : undefined,
    }),
    facebookFollowers: r.account.ok ? r.account.value.fbFollowers : undefined,
    instagram: r.account.ok && r.account.value.igMetrics.length ? Object.fromEntries(r.account.value.igMetrics.map((m) => [m.name, m.value])) : undefined,
    youtube:
      yt && !yt.error
        ? {
            ...Object.fromEntries(yt.tiles.filter((x) => (YT_KEYS as readonly string[]).includes(x.key)).map((x) => [x.key, x.value])),
            topVideos: yt.top.map((v) => ({ title: clip(v.title, 80), views: v.views })),
          }
        : undefined,
    topPostsByComments: topPostsOf(r).map((p) => ({ platform: p.platform, caption: modelText(p.caption, 60), comments: p.commentCount, at: baghdadIso(p.createdAt) })),
    notAvailable: missing.length ? missing : undefined,
  });
}

export function insightsView(days: number, own: DeskCounts, r: DeskInsightsRead, lang: Lang, t: Dict, base: string): ViewBlock[] {
  const nw = newsWords(lang);
  const w = words(lang);
  const period = w.days(days);
  const igMetric = (name: string) => (r.account.ok ? r.account.value.igMetrics.find((m) => m.name === name)?.value : undefined);
  const yt = r.youtube.ok ? r.youtube.value : null;
  const failedTotal = Object.values(own.failed).reduce((a, b) => a + b, 0);
  const tiles = [
    { label: `${nw.storiesReceived} · ${period}`, value: t.fmt.num(own.received) },
    { label: `${nw.draftsMade} · ${period}`, value: t.fmt.num(own.drafted) },
    { label: `${nw.madeByAuto} · ${period}`, value: t.fmt.num(own.byAutopilot) },
    { label: `${nw.storiesPublished} · ${period}`, value: t.fmt.num(own.published) },
    { label: `${nw.videosMade} · ${period}`, value: t.fmt.num(own.videos) },
    ...(failedTotal ? [{ label: `${nw.failedPostsLabel} · ${period}`, value: t.fmt.num(failedTotal) }] : []),
    ...(r.account.ok && r.account.value.fbFollowers !== undefined ? [{ label: t.insights.fbFollowers, value: t.fmt.num(r.account.value.fbFollowers) }] : []),
    ...IG_KEYS.flatMap((k) => (igMetric(k) !== undefined ? [{ label: t.insights.ig[k], value: t.fmt.num(igMetric(k) as number) }] : [])),
    ...(yt && !yt.error ? yt.tiles.map((x) => ({ label: (t.insights.yt as Record<string, string>)[x.key] ?? x.label, value: t.fmt.num(x.value) })) : []),
  ];
  const view: ViewBlock[] = [{ kind: "stats", title: t.insights.title, items: tiles, href: `${base}/insights` }];
  const top = topPostsOf(r);
  if (top.length) {
    view.push({
      kind: "list",
      title: t.insights.topSec,
      items: top.map((p) => ({
        title: clip(p.caption, 120) || t.common.noText,
        sub: `${platformName(t, p.platform)} · ${t.fmt.num(p.commentCount)} ${w.commentsOnPost}`,
        href: isHttps(p.permalink) ? p.permalink : undefined,
      })),
    });
  }
  if (insightsMissing(r).length) view.push({ kind: "note", tone: "warn", text: t.insights.notes });
  return view;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings

export const SETTINGS_AREAS = ["sources", "filter", "autopilot", "video", "brand", "accounts", "library"] as const;
export type SettingsArea = (typeof SETTINGS_AREAS)[number];

/** Everything the settings areas draw on besides loadNewsProps. */
export interface SettingsExtra {
  plan: string;
  /** The accounts of every platform (the autopilot's lists have Facebook and Instagram only). */
  accounts: AccountLists;
  /** Sources switched on (catalog and own feeds): the number the plan's cap is counted against. */
  sourcesOn: number;
}

interface Part {
  data: Record<string, unknown>;
  view: ViewBlock[];
}

const LIST_CAP = 25;

function sourcesPart(p: NewsSettingsProps, x: SettingsExtra, detail: boolean, nw: NewsWords, w: ReturnType<typeof words>, t: Dict, base: string): Part {
  const on = p.catalog.filter((c) => c.enabled);
  const cap = limitsOf(x.plan).sources;
  const failing = [...on.filter((c) => c.lastError).map((c) => c.id), ...p.feeds.filter((f) => f.lastError).map((f) => f.id)];
  const data = compact({
    keywords: p.keywords.slice(0, 40).map((k) => clip(k, 40)),
    topicsKept: p.categories.length ? p.categories : "all",
    keywordFilter: p.keywordFilter,
    sourcesOn: x.sourcesOn,
    sourceLimit: cap,
    // A catalog source is switched by its `id`; the model never needs the long descriptions.
    sources: detail ? p.catalog.map((c) => ({ id: c.id, name: c.name, on: c.enabled })) : on.map((c) => c.id),
    ownFeeds: p.feeds.map((f) => ({ id: f.id, name: clip(f.name, 60) })),
    notWorking: failing.length ? failing : undefined,
  });
  const stats: ViewBlock = {
    kind: "stats",
    title: nw.areas.sources,
    items: [
      { label: t.settings.news.keywordsSec, value: p.keywords.length ? p.keywords.join(t.fmt.listSep) : w.notSet },
      { label: t.settings.news.topicsSec, value: p.categories.length ? p.categories.map((c) => topicName(c, t)).join(t.fmt.listSep) : tn(t).filters.allTopics },
      { label: t.billing.features.label.sources, value: ratio(t, x.sourcesOn, cap) },
      { label: nw.ownFeeds, value: t.fmt.num(p.feeds.length) },
      { label: nw.keywordFilterRow, value: p.keywordFilter ? nw.yes : nw.no },
    ],
    href: `${base}/sources`,
  };
  const view: ViewBlock[] = [stats];
  if (detail && (on.length || p.feeds.length)) {
    view.push({
      kind: "list",
      title: t.settings.news.sourcesSec,
      items: [
        ...on.map((c) => ({ title: c.name, sub: c.lastError ? clip(c.lastError, 120) : undefined, badge: c.lastError ? w.failed : w.on })),
        ...p.feeds.map((f) => ({ title: f.name, sub: [f.url, f.lastError ? clip(f.lastError, 120) : ""].filter(Boolean).join(" · "), badge: f.lastError ? w.failed : w.on })),
      ],
    });
  }
  return { data, view };
}

function filterPart(p: NewsSettingsProps, nw: NewsWords, w: ReturnType<typeof words>, t: Dict, base: string): Part {
  const f = p.filter;
  const s = t.settings.news;
  const level = f.level === "full" ? nw.levelFull : f.level === "focus" ? nw.levelFocus : nw.levelNone;
  const data = compact({
    planAllows: f.level,
    mode: f.mode,
    focus: f.focus ? clip(f.focus, 300) : undefined,
    exclude: f.exclude ? clip(f.exclude, 300) : undefined,
    broad: f.broad,
  });
  const view: ViewBlock[] = [
    {
      kind: "stats",
      title: nw.areas.filter,
      items: [
        { label: nw.planAllows, value: level },
        { label: s.filterSec, value: (s.filterMode as Record<string, string>)[f.mode] ?? f.mode },
        { label: s.focusLabel, value: f.focus ? clip(f.focus, 300) : w.notSet },
        { label: s.excludeLabel, value: f.exclude ? clip(f.exclude, 300) : w.notSet },
        ...(f.level === "full" ? [{ label: nw.matchingRow, value: f.broad ? s.focusBroad : s.focusStrict }] : []),
      ],
      href: `${base}/sources`,
    },
  ];
  return { data, view };
}

const quiet = (a: NewsSettingsProps["autopilot"]): { from: number; to: number } | null => (a.quietFrom !== null && a.quietTo !== null ? { from: a.quietFrom, to: a.quietTo } : null);

function autopilotPart(p: NewsSettingsProps, nw: NewsWords, t: Dict, base: string): Part {
  const a = p.autopilot;
  const q = quiet(a);
  const data = compact({
    mode: a.mode,
    postsTo: a.targets,
    mayPostByItself: a.canPublish,
    mostPostsPerDay: a.dailyMax,
    minutesBetweenPosts: a.minGapMin,
    quietHoursBaghdad: q ?? undefined,
    connected: a.connected,
    // "FB:<id>" / "IG:<id>": the Pages the autopilot posts to when a platform has several; empty means the first one.
    accounts: a.accounts.length ? a.accounts : undefined,
  });
  const nameOf = (target: string) => platformName(t, target);
  const view: ViewBlock[] = [
    {
      kind: "stats",
      title: nw.areas.autopilot,
      items: [
        { label: nw.modeRow, value: (t.settings.news.autoMode as Record<string, string>)[a.mode] ?? a.mode },
        { label: nw.targetsRow, value: a.targets.length ? a.targets.map(nameOf).join(t.fmt.listSep) : nw.none },
        { label: t.settings.news.autoDailyMax, value: t.fmt.num(a.dailyMax) },
        { label: t.settings.news.autoMinGap, value: t.fmt.num(a.minGapMin) },
        { label: t.settings.news.autoQuiet, value: q ? `${t.fmt.digits(`${String(q.from).padStart(2, "0")}:00`)} - ${t.fmt.digits(`${String(q.to).padStart(2, "0")}:00`)}` : nw.quietNone },
      ],
      href: `${base}/autopilot`,
    },
  ];
  if (!a.canPublish) view.push({ kind: "note", text: t.settings.news.autoPlanOnly });
  return { data, view };
}

function videoPart(p: NewsSettingsProps, lang: Lang, nw: NewsWords, t: Dict, base: string): Part {
  const v = p.video;
  const data = compact({
    monthlyVideosOnPlan: v.quota,
    madeThisMonth: v.used,
    mode: v.mode,
    style: v.style,
    topics: v.topics.length ? v.topics : "all",
    mostVideosPerDay: v.dailyMax,
    voice: v.voice,
    speed: v.speed,
    prompt: v.prompt ? clip(v.prompt, 300) : undefined,
    promptAllowedOnPlan: v.full,
    ownVoiceSaved: v.clone.saved,
    footageClips: v.clips.length,
  });
  const view: ViewBlock[] = [
    {
      kind: "stats",
      title: nw.areas.video,
      items: [
        ...(v.quota > 0 ? [{ label: t.billing.features.label.videos, value: ratio(t, v.used, v.quota) }] : []),
        { label: nw.modeRow, value: (t.settings.news.videoMode as Record<string, string>)[v.mode] ?? v.mode },
        { label: nw.styleRow, value: (t.settings.news.videoStyle as Record<string, string>)[v.style] ?? v.style },
        { label: t.settings.news.topicsSec, value: v.topics.length ? v.topics.map((c) => topicName(c, t)).join(t.fmt.listSep) : tn(t).filters.allTopics },
        { label: t.settings.news.videoDailyMax, value: t.fmt.num(v.dailyMax) },
        { label: t.settings.news.videoVoice, value: `${voiceName(v.voice, lang, t)} · ${t.settings.news.videoSpeed(t.fmt.num(v.speed))}` },
        ...(v.prompt ? [{ label: t.settings.news.videoPrompt, value: clip(v.prompt, 300) }] : []),
        { label: t.settings.news.cloneTitle, value: v.clone.saved ? nw.yes : nw.no },
        { label: t.settings.news.clipsSec, value: t.fmt.num(v.clips.length) },
      ],
      href: `${base}/video-setup`,
    },
  ];
  if (v.quota <= 0) view.push({ kind: "note", text: t.settings.news.videoPlanOnly });
  return { data, view };
}

function brandPart(p: NewsSettingsProps, nw: NewsWords, w: ReturnType<typeof words>, t: Dict, base: string): Part {
  const k = p.kit;
  const data = compact({
    colours: { primary: k.primary, accent: k.accent, text: k.text },
    headlineFont: k.headingFont,
    hasLogo: !!k.logoPath,
    hasMainFrame: !!k.framePath,
    headlinePosition: k.frameText,
    logoCorner: k.logoCorner,
    sectionFrames: p.sectionFrames.map((f) => ({ section: f.section, headlinePosition: f.frameText, note: f.note ? clip(f.note, 120) : undefined, hasReference: !!f.referencePath })),
    designPrompt: p.designPrompt ? clip(p.designPrompt, 300) : undefined,
    writingStyleNote: p.voiceNote ? clip(p.voiceNote, 300) : undefined,
    sourcePictures: p.sourceImages,
    aiPictures: p.aiPictures,
    photoCardsOnly: p.photoCardsOnly,
    aiFrameDesignAvailable: p.aiFrames,
  });
  const s = t.settings.news;
  const corner = k.logoCorner === "right" ? s.bdLogoRight : k.logoCorner === "left" ? s.bdLogoLeft : s.bdLogoOff;
  const view: ViewBlock[] = [
    {
      kind: "stats",
      title: nw.areas.brand,
      items: [
        { label: nw.colours, value: [k.primary, k.accent, k.text].join(t.fmt.listSep) },
        { label: s.bdFont, value: k.headingFont === "sans" ? s.fontSans : s.fontKufi },
        { label: s.logo, value: k.logoPath ? nw.yes : nw.no },
        { label: s.frameSec, value: k.framePath ? nw.yes : nw.no },
        { label: s.frameTextLabel, value: (s.frameText as Record<string, string>)[k.frameText] ?? k.frameText },
        { label: s.bdFrameLogo, value: corner },
        { label: s.frames.sec, value: t.fmt.num(p.sectionFrames.length) },
        ...(p.designPrompt ? [{ label: s.frames.promptLabel, value: clip(p.designPrompt, 300) }] : []),
        ...(p.voiceNote ? [{ label: s.voiceSec, value: clip(p.voiceNote, 300) }] : []),
        { label: s.bdSourceImg, value: p.sourceImages ? w.on : w.off },
        { label: s.bdAiPic, value: p.aiPictures ? w.on : w.off },
        { label: nw.photoCardsOnlyRow, value: p.photoCardsOnly ? w.on : w.off },
        { label: nw.aiFramesRow, value: p.aiFrames ? nw.yes : nw.no },
      ],
      href: `${base}/brand`,
    },
  ];
  return { data, view };
}

function accountsPart(p: NewsSettingsProps, x: SettingsExtra, nw: NewsWords, w: ReturnType<typeof words>, t: Dict, base: string): Part {
  const l = x.accounts;
  const ref = (list: { id: string; name: string }[]) => list.map((a) => ({ id: a.id, name: clip(a.name, 60) }));
  const data = compact({
    facebook: ref(l.META_FACEBOOK),
    instagram: ref(l.META_INSTAGRAM),
    tiktok: ref(l.TIKTOK),
    youtube: ref(l.YOUTUBE),
    autopilotAccounts: p.autopilot.accounts.length ? p.autopilot.accounts : undefined,
  });
  const names = (list: { name: string }[]) => (list.length ? list.map((a) => a.name).join(t.fmt.listSep) : w.notConnected);
  const view: ViewBlock[] = [
    {
      kind: "stats",
      title: nw.areas.accounts,
      items: [
        { label: platformName(t, "FB"), value: names(l.META_FACEBOOK) },
        { label: platformName(t, "IG"), value: names(l.META_INSTAGRAM) },
        { label: platformName(t, "TT"), value: names(l.TIKTOK) },
        { label: platformName(t, "YT"), value: names(l.YOUTUBE) },
      ],
      href: `${base}/settings`,
    },
  ];
  return { data, view };
}

function libraryPart(p: NewsSettingsProps, detail: boolean, t: Dict, base: string): Part {
  const s = t.settings.news;
  const photos = p.photos;
  const clips = p.video.clips;
  const data = compact({
    photos: { count: photos.length, items: detail ? photos.slice(0, LIST_CAP).map((x) => ({ id: x.id, label: clip(x.label, 80), general: x.general })) : undefined },
    clips: { count: clips.length, items: detail ? clips.slice(0, LIST_CAP).map((x) => ({ id: x.id, label: clip(x.label, 80), general: x.general })) : undefined },
  });
  const view: ViewBlock[] = [];
  view.push(
    photos.length
      ? { kind: "list", title: s.photosSec, items: photos.slice(0, LIST_CAP).map((x) => ({ title: clip(x.label, 120), badge: x.general ? s.clipGeneralBadge : undefined })), more: photos.length > LIST_CAP ? photos.length - LIST_CAP : undefined, href: `${base}/brand` }
      : { kind: "note", text: s.photosEmpty },
  );
  view.push(
    clips.length
      ? { kind: "list", title: s.clipsSec, items: clips.slice(0, LIST_CAP).map((x) => ({ title: clip(x.label, 120), badge: x.general ? s.clipGeneralBadge : undefined })), more: clips.length > LIST_CAP ? clips.length - LIST_CAP : undefined, href: `${base}/video-setup` }
      : { kind: "note", text: s.clipsEmpty },
  );
  return { data, view };
}

/** The settings of one area (full) or of all of them (short: lists reduced to counts and ids). */
export function settingsFor(p: NewsSettingsProps, x: SettingsExtra, area: SettingsArea | "all", lang: Lang, t: Dict, base: string): { data: Record<string, unknown>; view: ViewBlock[] } {
  const nw = newsWords(lang);
  const w = words(lang);
  const detail = area !== "all";
  const parts: Record<SettingsArea, () => Part> = {
    sources: () => sourcesPart(p, x, detail, nw, w, t, base),
    filter: () => filterPart(p, nw, w, t, base),
    autopilot: () => autopilotPart(p, nw, t, base),
    video: () => videoPart(p, lang, nw, t, base),
    brand: () => brandPart(p, nw, w, t, base),
    accounts: () => accountsPart(p, x, nw, w, t, base),
    library: () => libraryPart(p, detail, t, base),
  };
  const chosen = area === "all" ? SETTINGS_AREAS : [area];
  const data: Record<string, unknown> = { area };
  const view: ViewBlock[] = [];
  for (const a of chosen) {
    const part = parts[a]();
    data[a] = part.data;
    view.push(...part.view);
  }
  return { data, view };
}

