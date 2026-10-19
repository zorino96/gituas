// The news desk's story tools: fetch stories, write and improve a draft, edit it, make its card, publish or schedule it, dismiss
// stories, make a video. Each one wraps the same server action the desk's own screens use; the card looks at the live state and refuses
// what cannot work, and the run calls the action. Both start with the desk check and the frozen check (defineNews).
//
// What is deliberately not here: no tool carries `textFields` for a story's text. The loop's cleaning removes numbers of ten digits or
// more, domains and handles, which would destroy a story's figures and the names of its sources; the draft text is limited by the
// desk's own rules (checkDraft) and the card shows it in full instead.

import { z } from "zod";

import { publishAction } from "@/app/app/actions";
import { schedulePublishAction } from "@/app/app/publish/schedule-actions";
import { dismissNewsAction, draftNewsAction, makeVideoAction, refreshNewsAction, saveNewsDraftAction, type DraftFields } from "@/app/newsroom/(desk)/news/actions";
import { claimSlot, refundSlot, slotsUsed, type SlotMetric } from "@/lib/ai/slots";
import { refreshSecFor, videoQuotaFor, type Metric } from "@/lib/billing/plans";
import type { CardLine, ToolCtx, WriteTool } from "@/lib/chat/types";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { isJpegPath, isOwnPathname, type Target } from "@/lib/merchant/caption";
import type { PublishInput, PublishOutcome } from "@/lib/merchant/publish-core";
import { baghdadLocalToUtc, scheduleProblem } from "@/lib/merchant/schedule";
import { captionFor, checkDraft, LIMITS } from "@/lib/news/rules";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";
import { ownClips } from "@/lib/news/video";
import { planOf } from "./news-common";
import { attachmentsOf, clip, refuse } from "./writes-common";
import {
  accountRef,
  attId,
  byPlatform,
  defineNews,
  nameOf,
  NOT_CONNECTED,
  optionsOf,
  pagesOf,
  platformLabel,
  platforms,
  quotaOf,
  renderOrigin,
  resolveRefs,
  storyId,
  storyOf,
  type Pages,
  type Platform,
} from "./writes-news-common";
import { NW } from "./writes-news-words";
import { NEW } from "./writes-words";

const line = (label: string, value: string): CardLine => ({ label, value });

/** The fence on refreshing: a forced refresh skips the plan's refresh interval, so a model that loops on it would hammer the feeds. */
const REFRESH_SLOTS: SlotMetric = { month: "news_chat_refresh", day: "news_chat_refresh_day" };
const REFRESH_CAPS = { month: 360, day: 12 } as const;

/** The most stories one dismissal card may name. */
const MAX_DISMISS = 10;

/** What the rules of the desk say about a draft, worded for the model (English). */
const rulesOf = (draft: { headline: string; body: string }, item: { title: string; snippet: string }): string[] =>
  checkDraft(draft, item, dict("en").nr.news).map((p) => p.message);

// ---------------------------------------------------------------------------------------------------------------------

const refreshNews = defineNews({
  name: "refresh_news",
  description:
    "Fetch the newest stories from the desk's sources right now instead of waiting for the next automatic refresh. It takes no arguments. " +
    "Use it only when the person asks for fresh news; the desk also refreshes by itself. A few times a day at most.",
  schema: z.object({}),
  permission: "draft",
  risk: "low",
  label: (lang) => NW.label.refresh[lang],
  async card(ctx) {
    const [sources, plan, used] = await Promise.all([
      db.newsSource.count({ where: { tenantId: ctx.tenantId, enabled: true } }),
      planOf(ctx.tenantId),
      slotsUsed(ctx.tenantId, REFRESH_SLOTS),
    ]);
    if (used.day >= REFRESH_CAPS.day) return refuse(`The desk has already refreshed by hand ${REFRESH_CAPS.day} times today. The automatic refresh keeps going; try again tomorrow.`);
    const every = refreshSecFor(plan);
    return {
      title: NW.title.refresh[ctx.lang],
      lines: [line(NW.f.sources[ctx.lang], String(sources)), line(NW.f.autoRefresh[ctx.lang], dict(ctx.lang).billing.features.refresh(every))],
    };
  },
  async execute(ctx) {
    const slot = await claimSlot(ctx.tenantId, REFRESH_SLOTS, REFRESH_CAPS);
    if (!slot.ok) return { ok: false, text: NW.refreshTooOften[ctx.lang] };
    const r = await refreshNewsAction();
    if (!r.ok) {
      await refundSlot(ctx.tenantId, REFRESH_SLOTS, slot).catch(() => undefined);
      return { ok: false, text: r.error };
    }
    const lines = [NW.done.refreshed[ctx.lang](r.added)];
    if (r.failed.length) lines.push(NW.done.refreshFailed[ctx.lang](r.failed.slice(0, 5).join(", ")));
    return { ok: true, text: lines.join("\n"), data: { added: r.added } };
  },
});

// ---------------------------------------------------------------------------------------------------------------------

/** draft_story (the fast writer) and improve_story (the strong one) differ in the strength they ask for and the monthly count they use. */
function draftTool(kind: "draft" | "improve"): WriteTool {
  const strength = kind === "improve" ? "strong" : "fast";
  const metric: Metric = kind;
  return defineNews({
    name: kind === "improve" ? "improve_story" : "draft_story",
    description:
      kind === "improve"
        ? "Rewrite a story's EXISTING draft with the stronger AI writer (better wording). story: the story's id exactly as list_stories or get_story gives it. " +
          "It REPLACES the draft's text and removes its card (make_story_card must be run again). It uses one of the desk's few monthly improvements and takes up to a minute: run it on its own."
        : "Write the draft (headline, body and card kind) of a story with the AI, from the story's facts and the desk's own voice. story: the story's id exactly as list_stories or get_story gives it. " +
          "If the story already has a draft this REPLACES it and removes its card. It uses one of the desk's monthly drafts and takes up to a minute: run it on its own.",
    schema: z.object({ story: storyId }),
    permission: "draft",
    risk: "money",
    long: true,
    label: (lang) => (kind === "improve" ? NW.label.improve[lang] : NW.label.draft[lang]),
    async card(ctx, args) {
      const item = await storyOf(ctx, args.story);
      if (item.status === "DISMISSED") return refuse("That story was dismissed; it cannot be drafted.");
      if (kind === "improve" && !item.draft) return refuse("The story has no draft to improve yet. Use draft_story first.");
      const q = await quotaOf(ctx.tenantId, metric);
      if (q.used >= q.limit) return refuse(`This month's limit of ${q.limit} ${kind === "improve" ? "improvements" : "drafts"} is used on the ${q.plan} plan.`);
      const lines = [line(NW.f.story[ctx.lang], clip(item.title, 200)), line(NW.f.source[ctx.lang], clip(item.sourceName, 60))];
      if (item.draft) lines.push(line(NW.f.replaces[ctx.lang], clip(item.draft.headline, 160)));
      if (item.status === "PUBLISHED") lines.push(line(NW.f.note[ctx.lang], NW.alreadyPublished[ctx.lang]));
      lines.push(line(kind === "improve" ? NW.f.improvesLeft[ctx.lang] : NW.f.draftsLeft[ctx.lang], `${q.limit - q.used} / ${q.limit}`));
      return { title: (kind === "improve" ? NW.title.improve : NW.title.draft)[ctx.lang], lines };
    },
    async execute(ctx, args) {
      const r = await draftNewsAction(args.story, strength);
      if (!r.ok) return { ok: false, text: r.error };
      return { ok: true, text: NW.done.drafted[ctx.lang](clip(r.draft.headline, 120)), data: { story: args.story } };
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------

const EDIT = z
  .object({
    story: storyId,
    headline: z.string().trim().min(1).max(LIMITS.headline).optional().describe(`At most ${LIMITS.headline} characters`),
    body: z.string().trim().min(1).max(LIMITS.body).optional().describe(`At most ${LIMITS.body} characters`),
    cardKind: z.enum(["STANDARD", "BREAKING", "STAT", "QUOTE"]).optional(),
    stat: z.string().trim().max(30).optional().describe("The big number of a STAT card, at most 30 characters; an empty string clears it"),
    quote: z.string().trim().max(200).optional().describe("The quotation of a QUOTE card, at most 200 characters; an empty string clears it"),
    speaker: z.string().trim().max(60).optional().describe("Who said the quote, at most 60 characters; an empty string clears it"),
  })
  .refine((o) => ["headline", "body", "cardKind", "stat", "quote", "speaker"].some((k) => (o as Record<string, unknown>)[k] !== undefined), { message: "nothing to change" });

/** A link, an e-mail address or an @handle in a text. The cleaning that strips them from replies is not applied to a story (it would also destroy its figures), so the card warns instead. */
const CONTACT = /(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_.]{2,}|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.[\p{L}\p{N}.-]+/iu;

type EditFields = Pick<DraftFields, "headline" | "body" | "cardKind" | "stat" | "quote" | "speaker">;
const EDIT_KEYS = ["headline", "body", "cardKind", "stat", "quote", "speaker"] as const;

/** The draft as it is now merged with what was asked: a field that is not mentioned stays exactly as it is, the photo included. */
async function planEdit(ctx: ToolCtx, args: z.output<typeof EDIT>) {
  const item = await storyOf(ctx, args.story);
  if (item.status === "DISMISSED") return refuse("That story was dismissed; its draft cannot be edited.");
  const d = item.draft;
  const before: EditFields = {
    headline: d?.headline ?? "",
    body: d?.body ?? "",
    cardKind: d && CARD_KINDS.includes(d.cardKind as CardKind) ? (d.cardKind as CardKind) : "STANDARD",
    stat: d?.stat ?? null,
    quote: d?.quote ?? null,
    speaker: d?.speaker ?? null,
  };
  const text = (v: string | undefined, was: string | null) => (v === undefined ? was : v.trim() || null);
  const after: EditFields = {
    headline: args.headline ?? before.headline,
    body: args.body ?? before.body,
    cardKind: args.cardKind ?? before.cardKind,
    stat: text(args.stat, before.stat),
    quote: text(args.quote, before.quote),
    speaker: text(args.speaker, before.speaker),
  };
  if (!d && (!args.headline || !args.body)) return refuse("The story has no draft yet. Give both a headline and a body to write one by hand, or use draft_story.");
  const problems = rulesOf(after, item);
  if (problems.length) return refuse(`The draft would break the desk's rules: ${problems.join(" ")} Change the wording and try again.`);
  const changed = EDIT_KEYS.filter((k) => after[k] !== before[k]);
  if (!changed.length) return refuse("Nothing would change: the draft already has these values.");
  return { item, draft: d, before, after, changed, hadCard: !!d?.cardPath };
}

const editDraft = defineNews({
  name: "edit_draft",
  description:
    `Change the text of a story's draft by hand: headline (at most ${LIMITS.headline} characters), body (at most ${LIMITS.body}), cardKind (STANDARD, BREAKING, STAT or QUOTE), stat, quote, speaker. ` +
    "Fields you leave out stay exactly as they are. story: the story's id from list_stories or get_story. The text must be the desk's own wording from the story's facts, never copied from the source, " +
    "with no figures or names that the story does not give, and no links, e-mail addresses, @handles or phone numbers. Saving removes the draft's card, so make_story_card must be run again.",
  schema: EDIT,
  permission: "draft",
  risk: "low",
  label: (lang) => NW.label.edit[lang],
  async card(ctx, args) {
    const { item, before, after, changed, hadCard, draft } = await planEdit(ctx, args);
    const t = dict(ctx.lang).nr.news.editor;
    const names: Record<(typeof EDIT_KEYS)[number], string> = { headline: t.headline, body: t.body, cardKind: NW.f.cardKind[ctx.lang], stat: t.stat, quote: t.quote, speaker: t.speaker };
    const show = (k: (typeof EDIT_KEYS)[number], v: string | null) => (k === "cardKind" ? ((t.kinds as Record<string, string>)[v ?? ""] ?? v ?? "") : (v ?? ""));
    const lines = [line(NW.f.story[ctx.lang], clip(item.title, 160))];
    for (const k of changed) {
      const now = show(k, after[k]) || NW.empty[ctx.lang];
      // The headline and the body are shown in full: they are what the post will say.
      lines.push(line(names[k], draft && !["headline", "body"].includes(k) ? NEW.was[ctx.lang](now, show(k, before[k]) || NW.empty[ctx.lang]) : now));
    }
    if (changed.some((k) => k !== "cardKind" && CONTACT.test(after[k] ?? ""))) lines.push(line(NW.f.note[ctx.lang], NW.contactWarning[ctx.lang]));
    if (!draft) lines.push(line(NW.f.note[ctx.lang], NW.newByHand[ctx.lang]));
    if (hadCard) lines.push(line(NW.f.note[ctx.lang], NW.cardRemoved[ctx.lang]));
    return { title: NW.title.edit[ctx.lang], lines };
  },
  // Read again here: the draft is merged with what it is now, not with what it was when the card was made.
  async execute(ctx, args) {
    const { item, after, draft } = await planEdit(ctx, args);
    const r = await saveNewsDraftAction(item.id, { ...after, photoPath: draft?.photoPath ?? null });
    return r.ok ? { ok: true, text: NW.done.edited[ctx.lang], data: { story: item.id } } : { ok: false, text: r.error };
  },
});

// ---------------------------------------------------------------------------------------------------------------------

/** The draft's card, checked the way the editor's own button does before it accepts a card. */
async function draftToCard(ctx: ToolCtx, id: string) {
  const item = await storyOf(ctx, id);
  if (item.status === "DISMISSED") return refuse("That story was dismissed.");
  const draft = item.draft;
  if (!draft) return refuse("The story has no draft yet. Use draft_story (or edit_draft with a headline and body) first.");
  const problems = rulesOf(draft, item);
  if (problems.length) return refuse(`The draft breaks the desk's rules, so no card can be made: ${problems.join(" ")} Use edit_draft to fix it.`);
  return { item, draft };
}

const makeStoryCard = defineNews({
  name: "make_story_card",
  description:
    "Make the picture card (a JPEG with the headline, photo and the desk's frame) of a story's draft. story: the story's id from list_stories or get_story. " +
    "A story must have a card before publish_story or schedule_story. It replaces an earlier card and takes up to 40 seconds. Run it on its own, never together with another tool.",
  schema: z.object({ story: storyId }),
  permission: "draft",
  risk: "low",
  long: true,
  label: (lang) => NW.label.card[lang],
  async card(ctx, args) {
    const { item, draft } = await draftToCard(ctx, args.story);
    const kinds = dict(ctx.lang).nr.news.editor.kinds as Record<string, string>;
    const lines = [line(NW.f.story[ctx.lang], clip(item.title, 160)), line(NW.f.headline[ctx.lang], draft.headline), line(NW.f.cardKind[ctx.lang], kinds[draft.cardKind] ?? draft.cardKind)];
    lines.push(line(NW.f.photo[ctx.lang], draft.photoPath ? NW.photoOwn[ctx.lang] : NW.photoAuto[ctx.lang]));
    if (draft.cardPath) lines.push(line(NW.f.note[ctx.lang], NW.cardReplaced[ctx.lang]));
    return { title: NW.title.card[ctx.lang], lines };
  },
  async execute(ctx, args) {
    const { draft } = await draftToCard(ctx, args.story);
    try {
      // The headless Chromium renderer is big and only this tool needs it: loaded here, not at the top of the module.
      const { renderAndStoreCard } = await import("@/lib/cards/server-render");
      const card = await renderAndStoreCard(draft.id, ctx.tenantId, renderOrigin());
      return { ok: true, text: NW.done.card[ctx.lang], media: { url: card.url, pathname: card.pathname, kind: "image", name: "story-card.jpg" }, data: { story: args.story } };
    } catch (e) {
      const changed = e instanceof Error && /changed while/i.test(e.message);
      return { ok: false, text: (changed ? NW.cardChanged : NW.cardFailed)[ctx.lang] };
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Publishing and scheduling: one plan for both, so a card never shows a post the run would not make.

interface PostArgs {
  story: string;
  targets: Platform[];
  accounts?: string[];
}

async function postPlan(ctx: ToolCtx, args: PostArgs) {
  const targets = [...new Set(args.targets)];
  const item = await storyOf(ctx, args.story);
  if (item.status === "DISMISSED") return refuse("That story was dismissed; it cannot be published.");
  const draft = item.draft;
  if (!draft) return refuse("The story has no draft yet. Use draft_story first, then make_story_card.");
  const problems = rulesOf(draft, item);
  if (problems.length) return refuse(`The draft breaks the desk's rules, so it cannot be published: ${problems.join(" ")} Use edit_draft to fix it.`);
  if (!draft.cardUrl || !draft.cardPath || !/^https:\/\//.test(draft.cardUrl) || !isOwnPathname(draft.cardPath, ctx.tenantId)) {
    return refuse("The story has no card yet (or its text changed after the card was made). Run make_story_card for it first, as its own step.");
  }
  if (targets.includes("IG") && !isJpegPath(draft.cardPath)) return refuse("Instagram takes only JPEG pictures and this card is not one. Run make_story_card again to render a new card.");

  const [pages, quota] = await Promise.all([pagesOf(ctx.tenantId), quotaOf(ctx.tenantId, "publish")]);
  if (quota.used >= quota.limit) return refuse(`This month's limit of ${quota.limit} published stories is used on the ${quota.plan} plan.`);
  for (const p of targets) if (!pages[p].length) return refuse(NOT_CONNECTED(p));
  const refs = resolveRefs(pages, args.accounts ?? [], targets, 5);
  // With several Pages on a platform nobody gets a post they did not pick: the model must name the account, and the card names it.
  for (const p of targets) {
    if (pages[p].length > 1 && !refs.some((r) => r.startsWith(`${p}:`))) {
      return refuse(`The desk has several ${platformLabel(p)} accounts, so say which one. Ask the person, then pass it in accounts: ${optionsOf(pages, p)}.`);
    }
  }
  // A story that already went to a place is not posted there again: a repeated call (after a wait that ended with an unknown outcome)
  // must not double-post.
  const results = (Array.isArray(draft.results) ? draft.results : []) as { target?: string; ok?: boolean; pending?: boolean; accountId?: string }[];
  const chosen = byPlatform(refs);
  for (const p of targets) {
    const ids = chosen[p] ?? [];
    const hit = results.find((r) => r && (r.ok === true || r.pending === true) && r.target === p && (!r.accountId || !ids.length || ids.includes(r.accountId)));
    if (hit) return refuse(`This story was already published to ${platformLabel(p)} (or is being published there). Publishing it again would post it twice; the person can do that from the Publish screen if they really want to.`);
  }
  // An Instagram post that Instagram is still processing is finished by the every-minute job: a second one would be a duplicate.
  if (targets.includes("IG") && (await db.igPending.findFirst({ where: { tenantId: ctx.tenantId, draftId: draft.id, status: { in: ["WAITING", "PUBLISHING", "UNKNOWN"] } }, select: { id: true } }))) {
    return refuse("This story's Instagram post is still being processed by Instagram and will appear by itself within minutes (or its outcome is unknown). Do not post it again; tell the person to check Instagram.");
  }
  const media: NonNullable<PublishInput["media"]> = { url: draft.cardUrl, pathname: draft.cardPath, type: "IMAGE" };
  const input: PublishInput = { caption: captionFor(draft), targets: targets as Target[], media, newsDraftId: draft.id, ...(refs.length ? { accounts: chosen } : {}) };
  return { item, draft, targets, pages, refs, quota, input };
}

/** The platform lines of a card: every platform with the account (or accounts) the post goes to. */
function platformLines(ctx: ToolCtx, plan: { targets: Platform[]; pages: Pages; refs: string[] }): CardLine[] {
  return plan.targets.map((p) => {
    const chosen = plan.refs.filter((r) => r.startsWith(`${p}:`));
    const names = chosen.length ? chosen.map((r) => nameOf(plan.pages, r)) : plan.pages[p].slice(0, 1).map((a) => a.name);
    return line(dict(ctx.lang).platform[p], names.join(" · ") || platformLabel(p));
  });
}

const POST_ARGS = {
  story: storyId,
  targets: platforms.describe("FB = Facebook, IG = Instagram. TikTok and YouTube are never posted from the chat"),
  accounts: z.array(accountRef).max(10).optional().describe("Needed only when the desk has several Pages on a platform: the account id from get_desk_settings (accounts), for example FB:123 or just 123. Ask the person which one."),
};

/** One platform's result as a sentence. */
function outcomeLine(ctx: ToolCtx, r: PublishOutcome): string {
  const where = `${dict(ctx.lang).platform[r.target]}${r.accountName ? ` · ${r.accountName}` : ""}`;
  if (r.ok) return `${where}: ${NW.done.published[ctx.lang]}`;
  if (r.pending) return `${where}: ${NW.done.processing[ctx.lang]}`;
  return `${where}: ${NW.done.postFailed[ctx.lang](clip(r.error ?? "", 140))}`;
}

const publishStory = defineNews({
  name: "publish_story",
  description:
    "Publish a story's card to Facebook and/or Instagram right now. story: the story's id from list_stories or get_story. targets: [\"FB\"], [\"IG\"] or both. " +
    "The story needs a draft that passes the desk's rules AND a card (make_story_card first, as a separate step). The post text is the draft's headline and body. " +
    "If the desk has several Pages on a platform, accounts must name the one(s) to post to. A story is not posted twice to the same place. " +
    "It is public, counts against the day's posts and the month's published stories, and takes up to a minute (Instagram is slow): run it on its own, never together with another tool.",
  schema: z.object(POST_ARGS),
  permission: "publish",
  risk: "public",
  long: true,
  countsAsPost: true,
  label: (lang) => NW.label.publish[lang],
  async card(ctx, args) {
    const plan = await postPlan(ctx, args);
    return {
      title: NW.title.publish[ctx.lang],
      lines: [
        line(NW.f.story[ctx.lang], clip(plan.item.title, 160)),
        ...platformLines(ctx, plan),
        line(NW.f.postText[ctx.lang], plan.input.caption),
        line(NW.f.media[ctx.lang], NW.theCard[ctx.lang]),
        line(NW.f.publishesLeft[ctx.lang], `${plan.quota.limit - plan.quota.used} / ${plan.quota.limit}`),
      ],
    };
  },
  async execute(ctx, args) {
    const plan = await postPlan(ctx, args);
    const r = await publishAction(plan.input);
    if (!r.ok) return { ok: false, text: r.error };
    const text = r.results.map((x) => outcomeLine(ctx, x)).join("\n");
    // A platform that is still processing (Instagram) will be published within minutes by itself: that is a post, not a failure.
    return { ok: r.results.some((x) => x.ok || x.pending), text, data: { story: args.story } };
  },
});

const scheduleStory = defineNews({
  name: "schedule_story",
  description:
    "Schedule a story's card to be published later to Facebook and/or Instagram. story, targets and accounts as in publish_story (the story needs a draft that passes the rules and a card). " +
    "when: the Baghdad time, \"YYYY-MM-DDTHH:mm\", between 10 minutes and 60 days from now. A story already scheduled is not scheduled twice; cancel the earlier one with cancel_scheduled_post first.",
  schema: z.object({ ...POST_ARGS, when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).describe("Baghdad time, YYYY-MM-DDTHH:mm") }),
  permission: "publish",
  risk: "public",
  countsAsPost: true,
  label: (lang) => NW.label.schedule[lang],
  async card(ctx, args) {
    const plan = await schedulePlan(ctx, args);
    return {
      title: NW.title.schedule[ctx.lang],
      lines: [
        line(NW.f.story[ctx.lang], clip(plan.item.title, 160)),
        ...platformLines(ctx, plan),
        line(NW.f.postText[ctx.lang], plan.input.caption),
        line(NW.f.when[ctx.lang], NW.baghdad[ctx.lang](args.when.replace("T", " "))),
        line(NW.f.publishesLeft[ctx.lang], `${plan.quota.limit - plan.quota.used} / ${plan.quota.limit}`),
      ],
    };
  },
  async execute(ctx, args) {
    const plan = await schedulePlan(ctx, args);
    const r = await schedulePublishAction(plan.input, args.when);
    if (!r.ok) return { ok: false, text: r.error };
    return { ok: true, text: NW.done.scheduled[ctx.lang](args.when.replace("T", " ")), data: { story: args.story, scheduledPost: r.id } };
  },
});

async function schedulePlan(ctx: ToolCtx, args: PostArgs & { when: string }) {
  const problem = scheduleProblem(args.targets, baghdadLocalToUtc(args.when), new Date(), dict("en").actions.publish);
  if (problem) return refuse(`${problem} (The time is Baghdad time, between 10 minutes and 60 days from now.)`);
  const plan = await postPlan(ctx, args);
  // The same draft already waiting for its time would be posted twice.
  const pending = await db.scheduledPost.findMany({ where: { tenantId: ctx.tenantId, status: "PENDING" }, orderBy: { runAt: "asc" }, take: 100, select: { id: true, runAt: true, input: true } });
  const again = pending.find((p) => (p.input as { newsDraftId?: unknown } | null)?.newsDraftId === plan.draft.id);
  if (again) return refuse(`This story is already scheduled (scheduled post ${again.id}). Cancel it with cancel_scheduled_post first if the time should change.`);
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------

const dismissStories = defineNews({
  name: "dismiss_stories",
  description:
    `Dismiss up to ${MAX_DISMISS} stories the desk does not want (they leave the inbox). stories: ids exactly as list_stories gives them. ` +
    "Nothing in the app brings a dismissed story back, so this always waits for the person's Confirm. A published story cannot be dismissed.",
  schema: z.object({ stories: z.array(storyId).min(1).max(MAX_DISMISS) }),
  permission: "draft",
  risk: "destructive",
  label: (lang) => NW.label.dismiss[lang],
  async card(ctx, args) {
    const items = await dismissable(ctx, args.stories);
    return {
      title: NW.title.dismiss[ctx.lang],
      lines: [
        ...items.map((i) => line(clip(i.sourceName, 40), clip(i.title, 140) + (i.draft ? ` (${NW.hasDraft[ctx.lang]})` : ""))),
        line(NW.f.note[ctx.lang], NW.dismissNote[ctx.lang]),
      ],
      // Confirm dismisses the stories the card showed, no others.
      pin: { stories: items.map((i) => i.id) },
    };
  },
  async execute(ctx, args) {
    const items = await dismissable(ctx, args.stories);
    let done = 0;
    for (const i of items) {
      const r = await dismissNewsAction(i.id);
      if (r.ok) done++;
    }
    return done === items.length ? { ok: true, text: NW.done.dismissed[ctx.lang](done) } : { ok: false, text: NW.stale[ctx.lang] };
  },
});

/** The stories to dismiss, from the live data: every id must be this desk's, none published; one that is dismissed already is left out. */
async function dismissable(ctx: ToolCtx, ids: readonly string[]) {
  const wanted = [...new Set(ids)];
  const rows = await db.newsItem.findMany({
    where: { id: { in: wanted }, tenantId: ctx.tenantId },
    select: { id: true, title: true, sourceName: true, status: true, draft: { select: { id: true } } },
  });
  const missing = wanted.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) return refuse(`No story with id ${missing.map((m) => `"${m}"`).join(", ")} on this desk. Use ids from list_stories.`);
  const published = rows.filter((r) => r.status === "PUBLISHED");
  if (published.length) return refuse(`A published story cannot be dismissed (${published.map((p) => p.id).join(", ")}).`);
  const open = rows.filter((r) => r.status !== "DISMISSED");
  if (!open.length) return refuse("Those stories are dismissed already.");
  return wanted.map((id) => open.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
}

// ---------------------------------------------------------------------------------------------------------------------

const makeStoryVideo = defineNews({
  name: "make_story_video",
  description:
    "Make a short vertical news video (voice and captions) of a story's draft. story: the story's id from list_stories or get_story. " +
    "clips: up to 3 attached MP4/MOV videos the desk filmed (for example [\"a1\"]); with none, the desk's design video is made. " +
    "It uses one of the plan's monthly videos, is made in the background in 5 to 10 minutes, and is NOT posted by itself: the person publishes it from the Videos screen. Only plans with a video quota can use it.",
  schema: z.object({ story: storyId, clips: z.array(attId).max(3).default([]) }),
  permission: "publish",
  risk: "money",
  label: (lang) => NW.label.video[lang],
  async card(ctx, args) {
    const plan = await videoPlan(ctx, args);
    const lines = [line(NW.f.story[ctx.lang], clip(plan.item.title, 160)), line(NW.f.headline[ctx.lang], plan.draft.headline)];
    lines.push(line(NW.f.clips[ctx.lang], plan.names.length ? plan.names.join(", ") : NW.designVideo[ctx.lang]));
    lines.push(line(NW.f.videosLeft[ctx.lang], `${plan.quota.limit - plan.quota.used} / ${plan.quota.limit}`));
    lines.push(line(NW.f.note[ctx.lang], NW.videoNote[ctx.lang]));
    return { title: NW.title.video[ctx.lang], lines };
  },
  async execute(ctx, args) {
    const plan = await videoPlan(ctx, args);
    const r = await makeVideoAction(plan.draft.id, plan.urls);
    // No job id on purpose: the chat screen follows a shop video by its job id, which a desk video is not.
    return r.ok ? { ok: true, text: NW.done.video[ctx.lang], data: { story: args.story } } : { ok: false, text: r.error };
  },
});

async function videoPlan(ctx: ToolCtx, args: { story: string; clips: string[] }) {
  const { item, draft } = await draftToCard(ctx, args.story);
  const plan = await planOf(ctx.tenantId);
  if (videoQuotaFor(plan) < 1) return refuse(`Videos are not part of the desk's ${plan} plan. Tell the person they need a plan with videos (Pro or Enterprise).`);
  const quota = await quotaOf(ctx.tenantId, "video");
  if (quota.used >= quota.limit) return refuse(`This month's limit of ${quota.limit} videos is used.`);
  const files = attachmentsOf(ctx);
  const picked = args.clips.map((id) => files.find((f) => f.id === id));
  const bad = args.clips.find((id, i) => !picked[i] || picked[i]!.kind !== "video");
  if (bad) return refuse(`"${bad}" is not a video attached in this chat. Use ids from the attachment list; never invent one.`);
  const urls = ownClips(ctx.tenantId, picked.map((f) => f!.url));
  if (!urls) return refuse("Clips must be MP4 or MOV videos the desk itself uploaded here (at most 3).");
  return { item, draft, quota, urls, names: picked.map((f) => clip(f!.name || f!.id, 40)) };
}

// ---------------------------------------------------------------------------------------------------------------------

export const STORY_TOOLS: WriteTool[] = [
  refreshNews,
  draftTool("draft"),
  draftTool("improve"),
  editDraft,
  makeStoryCard,
  publishStory,
  scheduleStory,
  dismissStories,
  makeStoryVideo,
];
