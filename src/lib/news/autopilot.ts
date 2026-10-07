// The newsroom autopilot: after every background ingest and classify it picks the fresh
// stories a desk asked for, writes them in the desk's voice and, on the plans that allow it,
// makes the card and posts it to Facebook and Instagram. Nobody is signed in here.
//
// What keeps it safe, in one place:
// - it only ever posts to Facebook and Instagram (AUTO_TARGETS), and only to connected pages;
// - it posts by itself only on a plan that allows it, otherwise it only drafts;
// - a story is stamped as tried before anything is written, so it is handled once;
// - a story an editor dismissed, in any of its articles, is never touched;
// - an event the desk already wrote about in the last two days is drafted but not posted;
// - quotas, the daily maximum and the gap between posts are checked again before every story;
// - the posting slot is taken in the database before the card is made, so two runs cannot both post;
// - a post is only started with time enough to finish and be recorded;
// - one failing story is logged and the next one still runs. runAutopilot never throws.
import type { Prisma } from "@/generated/prisma/client";
import { loadConnections } from "@/app/app/data";
import { AiUnavailable } from "@/lib/ai/provider";
import { assertWithin, countUsage, LimitReached, usageOf } from "@/lib/billing/limits";
import { canAutoPublish, NEWS_LIMITS } from "@/lib/billing/plans";
import { newsroomAccess } from "@/lib/billing/trial";
import { renderAndStoreCard } from "@/lib/cards/server-render";
import { db } from "@/lib/db";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { publishForWorkspace } from "@/lib/merchant/publish-core";
import { AUTO_TARGETS, autoTargetsFor, type AutoMode, type AutoTarget } from "./autopilot-settings";
import { RETRY_DEADLINE_MS } from "./draft";
import { loadActiveFocus } from "./focus";
import { isLate, prepareQueuedVideos, prepareVideo, queueVideoIfWanted } from "./video";
import { matchesChoice, normalizeChoice } from "./taxonomy";
import { sameStoryTooClose } from "./voice";
import { writeDraft } from "./write";

/** Stories handled in one run, at most. */
export const AUTO_MAX_PER_TICK = 3;
/** A story older than this is no longer news for the autopilot. */
export const AUTO_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** A run called without a deadline gives itself this long: the background tick's own limit. */
const DEFAULT_RUN_MS = 58_000;
/** No new story is started with less than this left. */
const MIN_STORY_MS = 12_000;
/**
 * The post is only sent with this much left. A post cut off half-way is out on the page but
 * not in our records, which is the one thing that must not happen: Instagram is given 30 s at
 * most (IG_PUBLISH_MS), Facebook needs no more, and the rest is for writing down what went out.
 */
const POST_MIN_MS = 35_000;
/** The longest the Instagram part of an automatic post may take. */
const IG_PUBLISH_MS = 30_000;
/** How long Instagram may take to process an auto-video reel, at most. */
const IG_VIDEO_MS = 45_000;
/** The card is only rendered with this much left; redrafting in publish mode stops this early too. */
const RENDER_MIN_MS = POST_MIN_MS + 5_000;
/**
 * A story that will also be posted needs this much: the draft, the card and the post. With
 * less, it is not started at all and waits, untouched, for the next run.
 */
const POST_STORY_MS = RENDER_MIN_MS + 8_000;
/** In draft mode, redrafting stops this long before the deadline. */
const WRITE_RESERVE_MS = 3_000;

/** An item in one of these states closes its whole story: it was written, posted, or thrown out by an editor. */
const CLOSING_STATUSES = ["DRAFTED", "PUBLISHED", "DISMISSED"];
/** How far back, and through how many of the desk's own drafts, a new draft is checked for the same event. */
const SAME_EVENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const SAME_EVENT_DRAFTS = 30;

// ─── Which stories ──────────────────────────────────────────────────────────

export interface CandidateItem {
  id: string;
  clusterKey: string;
  category: string | null;
  subcategory: string | null;
  status: string;
  publishedAt: Date;
  autoTriedAt: Date | null;
}

/**
 * The stories the autopilot should handle, oldest first. A story qualifies when it is NEW,
 * classified, in the desk's chosen categories (an unclassified story never passes here),
 * published within the last six hours and never tried.
 *
 * One story per cluster: a cluster is closed when it is in `taken` (it already has a drafted,
 * published, dismissed or tried item), or when an item in `items` shows the same. A story an
 * editor dismissed stays closed whichever of its articles arrives later. Of the items left in
 * an open cluster only the oldest is returned, so two runs looking at the same cluster reach
 * for the same item and the second one finds it claimed.
 */
export function autopilotCandidates<T extends CandidateItem>(
  items: readonly T[],
  chosen: readonly string[],
  now: number,
  taken: ReadonlySet<string> = new Set(),
): T[] {
  const closed = new Set(taken);
  for (const it of items) {
    if (CLOSING_STATUSES.includes(it.status) || it.autoTriedAt) closed.add(it.clusterKey);
  }
  const oldestFirst = [...items].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.id.localeCompare(b.id));
  const out: T[] = [];
  for (const it of oldestFirst) {
    if (it.status !== "NEW" || it.autoTriedAt) continue;
    if (!matchesChoice(it.category, it.subcategory, chosen)) continue;
    if (now - it.publishedAt.getTime() > AUTO_MAX_AGE_MS) continue;
    if (closed.has(it.clusterKey)) continue;
    closed.add(it.clusterKey);
    out.push(it);
  }
  return out;
}

// ─── How many ───────────────────────────────────────────────────────────────

export interface BudgetInput {
  /** What the desk saved: OFF, DRAFT or PUBLISH. Anything else reads as OFF. */
  mode: string;
  plan: string | null | undefined;
  /** This month's counts and the plan's quotas. */
  draftsUsed: number;
  draftLimit: number;
  publishesUsed: number;
  publishLimit: number;
  /** Drafts the autopilot wrote today (UTC day). */
  autoDraftsToday: number;
  /** Posts the autopilot's drafts went out with today (UTC day). */
  autoPostsToday: number;
  autoDailyMax: number;
  lastAutoAt: Date | null;
  autoMinGapMin: number;
  now: number;
}

export type BudgetStop = "off" | "draft-quota" | "publish-quota" | "daily-max" | "min-gap";

export interface Budget {
  /** The mode that applies: PUBLISH becomes DRAFT on a plan that may not post by itself. */
  mode: AutoMode;
  draft: number;
  publish: number;
  /** Why both numbers are 0, or null when there is something to do. */
  stop: BudgetStop | null;
}

const whole = (n: number) => (Number.isFinite(n) ? Math.floor(n) : 0);
const left = (limit: number, used: number) => Math.max(0, whole(limit) - Math.max(0, whole(used)));
/** The desk's minimum gap between two automatic posts, in milliseconds. */
const gapMsOf = (minutes: number) => Math.max(0, whole(minutes)) * 60_000;

/**
 * How many stories to draft and how many to post now, at most AUTO_MAX_PER_TICK.
 *
 * Draft mode drafts within the month's draft quota and the daily maximum. Publish mode drafts
 * only what it can also post, so a story it has no room for waits for the next run instead of
 * piling up as an unposted draft: nothing is done when the publish quota or the daily maximum
 * is used up, or when the last automatic post is more recent than the minimum gap. With a gap
 * set, a run posts one story, because a run is shorter than the shortest gap.
 */
export function autoBudget(b: BudgetInput): Budget {
  const mode: AutoMode = b.mode === "PUBLISH" ? (canAutoPublish(b.plan) ? "PUBLISH" : "DRAFT") : b.mode === "DRAFT" ? "DRAFT" : "OFF";
  const none = (stop: BudgetStop): Budget => ({ mode, draft: 0, publish: 0, stop });
  if (mode === "OFF") return none("off");

  const draftsLeft = left(b.draftLimit, b.draftsUsed);
  if (draftsLeft === 0) return none("draft-quota");
  const draftsToday = left(b.autoDailyMax, b.autoDraftsToday);
  if (draftsToday === 0) return none("daily-max");
  const draft = Math.min(AUTO_MAX_PER_TICK, draftsLeft, draftsToday);
  if (mode === "DRAFT") return { mode, draft, publish: 0, stop: null };

  const publishesLeft = left(b.publishLimit, b.publishesUsed);
  if (publishesLeft === 0) return none("publish-quota");
  const postsToday = left(b.autoDailyMax, b.autoPostsToday);
  if (postsToday === 0) return none("daily-max");
  const gapMs = gapMsOf(b.autoMinGapMin);
  if (gapMs > 0 && b.lastAutoAt && b.now - b.lastAutoAt.getTime() < gapMs) return none("min-gap");
  const publish = Math.min(draft, publishesLeft, postsToday, gapMs > 0 ? 1 : AUTO_MAX_PER_TICK);
  return { mode, draft: publish, publish, stop: null };
}

/**
 * Whether a story that is already drafted (a video that finished rendering, or the card that
 * replaces a late one) may be posted now. Unlike autoBudget it does not look at today's drafts:
 * those were counted when the story was written, so a full day of drafts must not strand the
 * videos still waiting to go out. The posts of the day, the publish quota and the gap still apply.
 */
export function autoPostBudget(b: BudgetInput): boolean {
  if (b.mode !== "PUBLISH" || !canAutoPublish(b.plan)) return false;
  if (left(b.publishLimit, b.publishesUsed) === 0 || left(b.autoDailyMax, b.autoPostsToday) === 0) return false;
  const gapMs = gapMsOf(b.autoMinGapMin);
  return !(gapMs > 0 && b.lastAutoAt && b.now - b.lastAutoAt.getTime() < gapMs);
}

// ─── Small pure helpers ─────────────────────────────────────────────────────

/**
 * Where the card's render page is opened. In production it is always the newsroom's own
 * domain; the app URL from the environment, or localhost, is used only outside production.
 */
export function renderOrigin(): string {
  if (process.env.NODE_ENV === "production") return NEWSROOM_ORIGIN;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "http://localhost:3001";
}

/** An error as one short line that is safe to log: no query values, no bearer tokens, no long keys. */
export function safeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
  return raw
    .replace(/([?&][\w.-]*=)[^&\s"'<>]+/g, "$1…")
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, "$1 …")
    .replace(/[A-Za-z0-9_-]{40,}/g, "…")
    .slice(0, 300);
}

function utcDayStart(now: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ─── The run ────────────────────────────────────────────────────────────────

export interface AutopilotResult {
  drafted: number;
  published: number;
}

export interface AutopilotOptions {
  /** When the run must be finished (epoch ms): the background tick passes its own limit. */
  deadline?: number;
  /** No new story is started after this moment (epoch ms); a story already begun is finished. */
  startBy?: number;
}

interface Story extends CandidateItem {
  url: string;
  sourceName: string;
  title: string;
  snippet: string;
}

interface Run {
  tenantId: string;
  plan: keyof typeof NEWS_LIMITS;
  deadline: number;
  done: AutopilotResult;
  /** Which pages are connected; looked up once, and only when the desk posts by itself. */
  connected: { FB: boolean; IG: boolean } | null;
}

async function note(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject = {}): Promise<void> {
  try {
    await db.auditLog.create({ data: { tenantId, actor: "SYSTEM", action, reasoning, metadata } });
  } catch (e) {
    console.error("[autopilot] audit log failed:", safeError(e));
  }
}

async function noteFailure(tenantId: string, action: string, reasoning: string, e: unknown, metadata: Prisma.InputJsonObject = {}): Promise<void> {
  const error = safeError(e);
  console.error(`[autopilot] ${action}:`, error);
  await note(tenantId, action, reasoning, { ...metadata, error });
}

/** The fresh stories of this desk, with one cluster lookup: which of their clusters are already taken. */
async function pickStories(tenantId: string, chosen: readonly string[], now: number): Promise<Story[]> {
  // With a news prompt, only stories the prompt kept (an unjudged story waits for its verdict).
  const focus = await loadActiveFocus(tenantId);
  const fresh = await db.newsItem.findMany({
    where: {
      tenantId,
      status: "NEW",
      autoTriedAt: null,
      category: { not: null },
      publishedAt: { gte: new Date(now - AUTO_MAX_AGE_MS) },
      ...(focus ? { focusMatch: true } : {}),
    },
    orderBy: { publishedAt: "asc" },
    take: 200,
    select: {
      id: true,
      clusterKey: true,
      category: true,
      subcategory: true,
      status: true,
      publishedAt: true,
      autoTriedAt: true,
      url: true,
      sourceName: true,
      title: true,
      snippet: true,
    },
  });
  if (!fresh.length) return [];
  const taken = await db.newsItem.findMany({
    where: {
      tenantId,
      clusterKey: { in: [...new Set(fresh.map((i) => i.clusterKey))] },
      OR: [{ status: { in: CLOSING_STATUSES } }, { autoTriedAt: { not: null } }],
    },
    select: { clusterKey: true },
    distinct: ["clusterKey"],
  });
  return autopilotCandidates(fresh, chosen, now, new Set(taken.map((t) => t.clusterKey)));
}

/** The budget for the next story, from fresh numbers, and where it may be posted. */
async function budgetNow(run: Run): Promise<{ budget: Budget; canPostDrafted: boolean; targets: AutoTarget[]; voiceNote: string | null; gapMs: number } | null> {
  const { tenantId } = run;
  const now = Date.now();
  const dayStart = utcDayStart(now);
  const [settings, draftsUsed, publishesUsed, autoDraftsToday, autoPostsToday] = await Promise.all([
    db.newsSettings.findUnique({
      where: { tenantId },
      select: { autoMode: true, autoTargets: true, autoDailyMax: true, autoMinGapMin: true, lastAutoAt: true, voiceNote: true },
    }),
    usageOf(tenantId, "draft"),
    usageOf(tenantId, "publish"),
    db.newsDraft.count({ where: { tenantId, auto: true, createdAt: { gte: dayStart } } }),
    db.newsDraft.count({ where: { tenantId, auto: true, publishedAt: { gte: dayStart } } }),
  ]);
  if (!settings) return null;

  let mode = settings.autoMode;
  let targets: AutoTarget[] = [];
  if (mode === "PUBLISH" && canAutoPublish(run.plan)) {
    if (!run.connected) {
      const conns = await loadConnections(tenantId);
      run.connected = { FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected };
    }
    targets = autoTargetsFor(settings.autoTargets, run.connected);
    // Nowhere to post: the story is still drafted, and waits for a person.
    if (!targets.length) mode = "DRAFT";
  }
  const limits = NEWS_LIMITS[run.plan];
  const input: BudgetInput = {
    mode,
    plan: run.plan,
    draftsUsed,
    draftLimit: limits.draft,
    publishesUsed,
    publishLimit: limits.publish,
    autoDraftsToday,
    autoPostsToday,
    autoDailyMax: settings.autoDailyMax,
    lastAutoAt: settings.lastAutoAt,
    autoMinGapMin: settings.autoMinGapMin,
    now,
  };
  return {
    budget: autoBudget(input),
    canPostDrafted: autoPostBudget(input),
    targets,
    voiceNote: settings.voiceNote,
    gapMs: gapMsOf(settings.autoMinGapMin),
  };
}

/**
 * True when the desk already holds a draft, written in the last two days, that reads like this
 * one. Stories are only clustered within one language, so the same event reported in Kurdish
 * and in Arabic arrives as two stories; both are written in the desk's own language, and there
 * the second one shows.
 */
async function alreadyCovered(tenantId: string, draft: { id: string; headline: string; body: string }): Promise<boolean> {
  const recent = await db.newsDraft.findMany({
    where: { tenantId, id: { not: draft.id }, createdAt: { gte: new Date(Date.now() - SAME_EVENT_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    take: SAME_EVENT_DRAFTS,
    select: { headline: true, body: true },
  });
  return recent.some((other) => sameStoryTooClose(draft, other));
}

/**
 * Make the card and post the draft. "next" when the run may go on to the next story: the post
 * went out to at least one page, or the desk had this event already and nothing was posted.
 * A post that did not go out is logged and leaves the draft as it is, DRAFTED, for a person.
 * It never throws.
 */
async function postDraft(
  run: Run,
  story: { id: string },
  draft: { id: string; headline: string; body: string },
  targets: AutoTarget[],
  gapMs: number,
  /** The story's auto-video, posted instead of the card. */
  video?: { url: string; pathname: string },
): Promise<"next" | "stop"> {
  const { tenantId } = run;
  const meta = { itemId: story.id, draftId: draft.id, ...(video ? { video: video.pathname } : {}) };
  const failed = async (reasoning: string, e: unknown): Promise<"stop"> => {
    await noteFailure(tenantId, "news.autopilot_publish_failed", `${reasoning} The draft waits for a person.`, e, meta);
    return "stop";
  };
  try {
    // The last guard before a post: only the allow-listed platforms, whatever reached this point.
    const allowed = targets.filter((t) => (AUTO_TARGETS as readonly string[]).includes(t));
    if (!allowed.length || allowed.length !== targets.length) return await failed("The autopilot had no allowed page to post to.", "no allowed target");
    if (run.deadline - Date.now() < RENDER_MIN_MS) return await failed("This run had no time left to make the card.", "out of time");

    if (await alreadyCovered(tenantId, draft)) {
      await note(tenantId, "news.autopilot_duplicate", "The desk already wrote about this event in the last two days, so the draft was not posted. It waits for a person.", meta);
      return "next";
    }

    // Take the posting slot before anything goes out: of two runs that overlap, only one moves
    // the time of the last automatic post, and only that one posts. The slot stays taken when
    // the post then fails, so a failed attempt uses up the gap as well.
    const now = Date.now();
    const slot = await db.newsSettings.updateMany({
      where: { tenantId, OR: [{ lastAutoAt: null }, { lastAutoAt: { lt: new Date(now - gapMs) } }] },
      data: { lastAutoAt: new Date(now) },
    });
    if (slot.count !== 1) {
      await note(tenantId, "news.autopilot_slot_taken", "Another run took this desk's posting slot first, so the draft was not posted. It waits for a person.", meta);
      return "stop";
    }

    let post: { caption: string; media: { url: string; pathname: string; type: "IMAGE" | "VIDEO" }; igMs: number };
    if (video) {
      // A reel takes Instagram longer to process than a photo: give it what the run has left.
      post = {
        caption: `${draft.headline.trim()}\n\n${draft.body.trim()}`,
        media: { url: video.url, pathname: video.pathname, type: "VIDEO" },
        igMs: Math.max(IG_PUBLISH_MS, Math.min(IG_VIDEO_MS, run.deadline - Date.now() - 5_000)),
      };
    } else {
      const card = await renderAndStoreCard(draft.id, tenantId, renderOrigin());
      // The caption is the text the card was rendered from, never an earlier copy of the draft.
      post = { caption: `${card.headline.trim()}\n\n${card.body.trim()}`, media: { url: card.url, pathname: card.pathname, type: "IMAGE" }, igMs: IG_PUBLISH_MS };
    }
    if (run.deadline - Date.now() < POST_MIN_MS) return await failed("This run had no time left to post.", "out of time");

    const results = await publishForWorkspace(
      { id: tenantId, kind: "NEWS", role: "OWNER" },
      { caption: post.caption, targets: allowed, media: post.media, newsDraftId: draft.id, igDeadlineMs: post.igMs },
    );
    if (!Array.isArray(results)) return await failed("The post was refused.", results.error);
    const sent = results.filter((r) => r.ok);
    if (!sent.length) {
      return await failed("No page accepted the post.", results.map((r) => `${r.target}: ${r.error ?? "failed"}`).join(" | "));
    }

    // From here on the post is out: nothing below may report it as a failure.
    run.done.published++;
    await note(tenantId, "news.autopilot_published", `The autopilot posted a story to ${sent.map((r) => r.target).join(" and ")}.`, {
      ...meta,
      targets: sent.map((r) => r.target),
      urls: sent.flatMap((r) => (r.url ? [r.url] : [])),
      failed: results.filter((r) => !r.ok).map((r) => r.target),
    });
    try {
      // The gap counts from when the post went out, a little after the slot was taken.
      await db.newsSettings.update({ where: { tenantId }, data: { lastAutoAt: new Date() }, select: { tenantId: true } });
    } catch (e) {
      // The slot taken above already keeps the gap; with the database failing, the run ends here.
      await noteFailure(tenantId, "news.autopilot_failed", "The post went out, but its time could not be saved.", e, meta);
      return "stop";
    }
    return "next";
  } catch (e) {
    return failed("The card or the post failed.", e);
  }
}

/** One story, start to finish. "stop" ends the run: the budget is used up, or a post just failed. */
async function handleStory(run: Run, story: Story): Promise<"next" | "stop"> {
  const { tenantId } = run;

  // The budget, again for every story: quotas, the daily maximum and the gap all move while we work.
  const plan = await budgetNow(run);
  if (!plan || plan.budget.draft < 1) return "stop";
  const { budget, targets } = plan;
  if (run.deadline - Date.now() < (budget.publish > 0 ? POST_STORY_MS : MIN_STORY_MS)) return "stop";
  // The same gates the editor's own actions pass, which also stop a newsroom that froze meanwhile.
  await assertWithin(tenantId, "draft");
  if (budget.publish > 0) await assertWithin(tenantId, "publish");

  // Claim the story before anything is written. Only one run can win this, so a story is never
  // handled twice, and a story that fails below is not picked up again.
  const claim = await db.newsItem.updateMany({ where: { id: story.id, tenantId, status: "NEW", autoTriedAt: null }, data: { autoTriedAt: new Date() } });
  if (claim.count !== 1) return "next";
  // Another run may have claimed a different article of this same story a moment ago.
  const rivals = await db.newsItem.count({
    where: {
      tenantId,
      clusterKey: story.clusterKey,
      id: { not: story.id },
      OR: [{ status: { in: CLOSING_STATUSES } }, { autoTriedAt: { not: null } }],
    },
  });
  // Or an editor dismissed one since the stories were picked.
  if (rivals > 0) return "next";

  // writeDraft stops redrafting 35 s after `startedAt`; move that moment to just before our deadline when it is nearer.
  const reserve = budget.publish > 0 ? RENDER_MIN_MS : WRITE_RESERVE_MS;
  const startedAt = Math.min(Date.now(), run.deadline - reserve - RETRY_DEADLINE_MS);
  const written = await writeDraft(tenantId, story, "fast", { startedAt, voiceNote: plan.voiceNote });
  if (written.part !== null) {
    // Still too close to the source after every retry: nothing is stored, and the story stays NEW for a person.
    await note(tenantId, "news.autopilot_skipped", "The draft still copied the source, so the story was left for a person.", {
      itemId: story.id,
      part: written.part,
    });
    return "next";
  }

  // `create`, never an upsert: a draft a person wrote in the meantime is not overwritten.
  const saved = await db.newsDraft.create({
    data: { itemId: story.id, tenantId, ...written.draft, model: written.model, auto: true },
    select: { id: true, headline: true, body: true },
  });
  // Counted exactly as the editor's own draft is: one per draft, whatever the attempts.
  await countUsage(tenantId, "draft");
  await db.newsItem.updateMany({ where: { id: story.id, tenantId, status: "NEW" }, data: { status: "DRAFTED" } });
  run.done.drafted++;
  await note(tenantId, "news.autopilot_drafted", "The autopilot wrote a draft.", { itemId: story.id, draftId: saved.id, model: written.model });

  if (budget.mode !== "PUBLISH" || budget.publish < 1) return "next";
  // A story chosen for video waits for its reel (posted by advanceVideos); the card replaces it if it is late.
  const videoId = await queueVideoIfWanted(tenantId, run.plan, story, saved.id);
  if (videoId) {
    await note(tenantId, "news.autopilot_video_queued", "The story was chosen for a video; it is posted when the video is ready.", {
      itemId: story.id,
      draftId: saved.id,
      videoId,
    });
    if (run.deadline - Date.now() > 25_000) await prepareVideo(videoId);
    return "next";
  }
  // A post that fails ends the run: the next story would most likely fail the same way.
  return postDraft(run, story, saved, targets, plan.gapMs);
}

/**
 * The desk's videos: voice the queued ones, post the ones that are rendered, and give the card to
 * stories whose video failed or is late. At most one post per run (the gap rules still apply).
 * Never throws.
 */
async function advanceVideos(run: Run): Promise<void> {
  const { tenantId } = run;
  try {
    await prepareQueuedVideos(tenantId, run.deadline);
    const now = Date.now();
    // News that waited longer than the autopilot would ever pick a story is not posted any more:
    // its draft stays for a person.
    await db.newsVideo.updateMany({
      where: { tenantId, autoPost: true, status: { in: ["RENDERED", "FAILED", "QUEUED", "VOICED", "RENDERING"] }, createdAt: { lt: new Date(now - AUTO_MAX_AGE_MS) } },
      data: { status: "STALE" },
    });
    const jobs = await db.newsVideo.findMany({
      where: { tenantId, autoPost: true, status: { in: ["RENDERED", "FAILED", "QUEUED", "VOICED", "RENDERING"] } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    const job = jobs.find((j) => j.status === "RENDERED") ?? jobs.find((j) => isLate(j, now));
    if (!job) return;
    if (run.deadline - Date.now() < POST_STORY_MS) return;
    const plan = await budgetNow(run);
    // Autopilot no longer posting: the drafts stay for a person, the jobs are closed.
    if (!plan || plan.budget.mode !== "PUBLISH") {
      if (plan) await db.newsVideo.update({ where: { id: job.id }, data: { status: "CARD", error: "autopilot not posting" } });
      return;
    }
    // Already drafted, so only the day's posts, the publish quota and the gap decide (not today's drafts).
    if (!plan.canPostDrafted || !plan.targets.length) return;
    const draft = await db.newsDraft.findUnique({ where: { id: job.draftId }, select: { id: true, headline: true, body: true, publishedAt: true } });
    if (!draft || draft.publishedAt) {
      await db.newsVideo.update({ where: { id: job.id }, data: { status: draft ? "POSTED" : "CARD", error: draft ? null : "draft gone" } });
      return;
    }
    const before = run.done.published;
    const asVideo = job.status === "RENDERED" && job.videoUrl && job.videoPath ? { url: job.videoUrl, pathname: job.videoPath } : undefined;
    // Claim the job first, so two runs never post it twice.
    const claim = await db.newsVideo.updateMany({ where: { id: job.id, status: job.status }, data: { status: asVideo ? "POSTING" : "CARD" } });
    if (claim.count !== 1) return;
    await postDraft(run, { id: job.itemId }, draft, plan.targets, plan.gapMs, asVideo);
    const posted = run.done.published > before;
    if (asVideo) {
      await db.newsVideo.update({ where: { id: job.id }, data: posted ? { status: "POSTED" } : { status: "FAILED", error: "the reel could not be posted" } });
    }
  } catch (e) {
    await noteFailure(tenantId, "news.autopilot_video_failed", "The autopilot could not move a video on.", e);
  }
}

async function work(tenantId: string, deadline: number, startBy: number, done: AutopilotResult): Promise<void> {
  const settings = await db.newsSettings.findUnique({ where: { tenantId }, select: { autoMode: true, categories: true } });
  if (!settings || (settings.autoMode !== "DRAFT" && settings.autoMode !== "PUBLISH")) return;
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  // A frozen newsroom (trial over, nothing paid) does nothing at all.
  if (!tenant || tenant.kind !== "NEWS" || !newsroomAccess(tenant, new Date()).active) return;

  const chosen = normalizeChoice(settings.categories);
  // A saved choice we cannot read must not turn into "every category".
  if (settings.categories.length && !chosen.length) return;
  const stories = await pickStories(tenantId, chosen, Date.now());
  const run: Run = { tenantId, plan: tenant.plan, deadline, done, connected: null };
  // Videos first: a reel that is ready (or a card that is due instead) goes out before new stories.
  await advanceVideos(run);
  // A story waiting for its video holds the next posting slot: drafting more now would only pile
  // up videos that then wait (and age) behind the gap.
  const waiting = await db.newsVideo.count({
    where: { tenantId, autoPost: true, status: { in: ["QUEUED", "VOICED", "RENDERING", "RENDERED", "POSTING"] } },
  });
  if (waiting > 0) return;

  for (const story of stories.slice(0, AUTO_MAX_PER_TICK)) {
    if (deadline - Date.now() < MIN_STORY_MS || Date.now() > startBy) break;
    try {
      if ((await handleStory(run, story)) === "stop") break;
    } catch (e) {
      // The quota ran out or the newsroom froze: not a failure, just the end of this run.
      if (e instanceof LimitReached) break;
      await noteFailure(tenantId, "news.autopilot_failed", "The autopilot could not handle a story.", e, { itemId: story.id });
      // With the AI down, every further story would only be burnt.
      if (e instanceof AiUnavailable) break;
    }
  }
}

/**
 * Let the autopilot act for one desk: draft the fresh stories it asked for and, in publish
 * mode on a plan that allows it, post them to its connected Facebook and Instagram pages.
 * It does nothing when the mode is OFF or the newsroom is frozen. It never throws: whatever
 * goes wrong is logged, and the counts say what was done.
 */
export async function runAutopilot(tenantId: string, opts: AutopilotOptions = {}): Promise<AutopilotResult> {
  const done: AutopilotResult = { drafted: 0, published: 0 };
  try {
    await work(tenantId, opts.deadline ?? Date.now() + DEFAULT_RUN_MS, opts.startBy ?? Infinity, done);
  } catch (e) {
    await noteFailure(tenantId, "news.autopilot_failed", "The autopilot stopped before it finished.", e);
  }
  return done;
}
