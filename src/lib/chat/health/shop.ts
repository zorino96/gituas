// The finders of a shop for the "check everything" tool (see types.ts). Each one reads ONE area with a few cheap queries,
// always scoped by the workspace, and returns what is wrong there. Counts and our own labels only: no buyer's name, message, comment,
// order note, phone number or address is ever selected. The only buyer data read is the platform id of a chat or comment (to count
// one buyer once and to see whether the owner already answered); it is compared in memory and never returned.
//
// Where each signal comes from (all from our own database; nothing here calls Facebook or Instagram):
//   connections   OAuthCredential (Meta tokens and their expiry) + Store (fbPageId, igUserId, pausedReason "token")
//   posts         AuditLog "app.publish_failed" (written for every failed target by publishForWorkspace, which also runs scheduled posts and the
//                 autopilot), read together with the later "app.publish" rows: one failed attempt counts once, and not at all once it was posted again
//   scheduled     ScheduledPost PENDING and overdue, and FAILED with no result (those left no audit row)
//   outbox        OutboxJob (stuck PENDING, FAILED answers) + buyers whose latest flagged message is "needs_you" and not yet answered
//   inbox         buyers and comments flagged for the owner, older than a day, not yet answered
//                 (answered = a ThreadPause made by an answer from the app or the phone, or a later answer to the same buyer that was SENT)
//   orders        Order still NEW
//   products      Product (active, without photos) and ProductVariant (in stock, price 0)
//   settings      Tenant.whatsappNumber, Store.automationEnabled, Store.plan / planPaidUntil
//   rules         ShopRule PAUSED_AUTO, RuleRun FAILED, the RULES_DRY_RUN switch
//   chat_actions  ChatRun FAILED (a timed-out run, which may have gone through, is told apart from a plain failure)

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rulesDryRun, rulesEnabled } from "@/lib/shop/rules/enabled";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { num } from "@/lib/i18n/num";
import { say as chatSay } from "../text";
import { A, ago, be, DAY, E, endingSoon, found, HOUR, hv, K, metaAccounts, MIN, N, say, there, words, type Def, type Finder, type Finding, type HealthCtx } from "./types";

// Accounts are connected and reconnected inside the chat (the Accounts button, show_accounts), never in Settings.
const RECONNECT = words("لە دوگمەی «ئەکاونتەکان»ی چات «پەیوەست بکە» دابگرە.", "اضغط «اربط» في زر «الحسابات» في المحادثة.", "Press Connect in the Accounts button of the chat.");
const CONNECT_BUTTON = "the Connect button that show_accounts puts in the chat (never send the person to Settings for it)";

// ---------------------------------------------------------------------------------------------------------------------
// Connections

const noPage: Def = {
  area: "connections",
  severity: "high",
  text: say(
    () => "هیچ پەیجێکی فەیسبووک یان ئەکاونتی ئینستاگرام پەیوەست نەکراوە، بۆیە هیچ پۆستێک بڵاو ناکرێتەوە و هیچ وەڵامێک ناچێت.",
    () => "لا توجد صفحة فيسبوك أو حساب إنستغرام مربوط، لذلك لا يُنشر شيء ولا تُرسل ردود.",
    () => "No Facebook Page or Instagram account is connected, so nothing is posted and no replies go out.",
  ),
  todo: words("لە دوگمەی «ئەکاونتەکان»ی چات پەیجەکەت پەیوەست بکە.", "اربط صفحتك من زر «الحسابات» في المحادثة.", "Connect your Page with the Accounts button of the chat."),
  fix: `Nothing is connected, so nothing can be posted and no automatic reply works. The person must connect a Facebook Page or Instagram account with ${CONNECT_BUTTON}; you cannot do that for them.`,
};
const fbExpired: Def = {
  area: "connections",
  severity: "high",
  text: say(
    (n) => `پەیوەندیی ${K(n, N.fbPage)} بەسەرچووە، بۆیە پۆست و وەڵام لەوێ ناچن.`,
    (n) => `انتهى ربط ${A(n, N.fbPage, true)}، لذلك لا تُنشر المنشورات ولا تُرسل الردود هناك.`,
    (n) => `The connection of ${E(n, N.fbPage)} has ended, so posts and replies there are not going out.`,
  ),
  todo: RECONNECT,
  fix: `A Facebook Page connection has expired or is gone. Meta tokens cannot be refreshed: the person must reconnect the Page with ${CONNECT_BUTTON}; you cannot do that for them. Until then posts and automatic replies on Facebook do not work.`,
};
const igExpired: Def = {
  area: "connections",
  severity: "high",
  text: say(
    (n) => `پەیوەندیی ${K(n, N.igAccount)} بەسەرچووە، بۆیە پۆست و وەڵام لەوێ ناچن.`,
    (n) => `انتهى ربط ${A(n, N.igAccount, true)}، لذلك لا تُنشر المنشورات ولا تُرسل الردود هناك.`,
    (n) => `The connection of ${E(n, N.igAccount)} has ended, so posts and replies there are not going out.`,
  ),
  todo: RECONNECT,
  fix: `An Instagram connection has expired or is gone. The person must reconnect it with ${CONNECT_BUTTON}; you cannot do that for them. Until then posts and automatic replies on Instagram do not work.`,
};
const paused: Def = {
  area: "connections",
  severity: "high",
  text: say(
    (n) => `وەڵامی خۆکار لە ${K(n, N.shop)} وەستاوە، چونکە فەیسبووک یان ئینستاگرام پەیوەندییەکەی قبوڵ ناکات.`,
    (n) => `توقفت الردود التلقائية في ${A(n, N.shop, true)} لأن فيسبوك أو إنستغرام لم يعد يقبل الربط.`,
    (n) => `Automatic replies are paused in ${E(n, N.shop)} because Facebook or Instagram no longer accepts the connection.`,
  ),
  todo: RECONNECT,
  fix: `Replies are paused (the shop's pausedReason is token): Meta rejected the access. The person must reconnect with ${CONNECT_BUTTON}; you cannot do that for them.`,
};
const expiring: Def = {
  area: "connections",
  severity: "medium",
  text: say(
    (n) => `پەیوەندیی ${K(n, N.fbPage)} لە ماوەی هەفتەیەکدا بەسەر دەچێت.`,
    (n) => `سينتهي ربط ${A(n, N.fbPage, true)} خلال أسبوع.`,
    (n) => `The connection of ${E(n, N.fbPage)} ends within a week.`,
  ),
  todo: words("پێش ئەوەی تەواو ببێت دووبارە پەیوەستی بکەرەوە.", "أعد الربط قبل أن ينتهي.", "Reconnect it before it ends."),
  fix: `A Facebook Page connection ends within 7 days. The person must reconnect it with ${CONNECT_BUTTON} before then; you cannot do that for them.`,
};

export const connectionsFinder: Finder = {
  area: "connections",
  async run(c) {
    const [creds, stores] = await Promise.all([
      db.oAuthCredential.findMany({
        where: { tenantId: c.tenantId, provider: { in: ["META_FACEBOOK", "META_INSTAGRAM"] } },
        select: { provider: true, providerAccountId: true, expiresAt: true },
        orderBy: { updatedAt: "desc" },
        take: 60,
      }),
      db.store.findMany({ where: { tenantId: c.tenantId }, select: { fbPageId: true, igUserId: true, pausedReason: true }, orderBy: { createdAt: "asc" }, take: 15 }),
    ]);
    const accounts = metaAccounts(creds, c.now);
    const live = (provider: string, id: string | null): boolean => !!id && accounts.get(`${provider}:${id}`)?.live === true;
    // No link to a screen: the connection is made with the Accounts button of the chat (the todo and the fix say so).
    const out: Finding[] = [];

    if (!stores.length || stores.every((s) => !s.fbPageId && !s.igUserId)) {
      if (![...accounts.values()].some((a) => a.live)) out.push(found(c, noPage, 0));
      return out;
    }
    const fbBad = stores.filter((s) => s.fbPageId && !live("META_FACEBOOK", s.fbPageId)).length;
    const igBad = stores.filter((s) => s.igUserId && !live("META_INSTAGRAM", s.igUserId)).length;
    if (fbBad) out.push(found(c, fbExpired, fbBad));
    if (igBad) out.push(found(c, igExpired, igBad));
    const tokenPaused = stores.filter((s) => s.pausedReason === "token").length;
    if (tokenPaused && !fbBad && !igBad) out.push(found(c, paused, tokenPaused));
    const mine = new Set(stores.map((s) => s.fbPageId).filter((id): id is string => !!id));
    const soon = endingSoon([...accounts.values()].filter((a) => mine.has(a.id)), c.now, 7 * DAY).length;
    if (soon) out.push(found(c, expiring, soon));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Posts that failed, scheduled posts that are late (shared with the news desk)

const postFixTail = "Check the connections finding first (an expired connection is the usual cause). Offer to post it again: post_now or schedule_post for a shop, publish_story or schedule_story for a news desk (each needs a card). The reason of each failure is not read here.";
const postsDay: Def = {
  area: "posts",
  severity: "high",
  text: say(
    (n) => `${K(n, N.post)} لە ٢٤ کاتژمێری ڕابردوودا بڵاو نەکرایەوە.`,
    (n) => `تعذّر نشر ${A(n, N.post, true)} خلال آخر ٢٤ ساعة.`,
    (n) => `${E(n, N.post)} could not be published in the last 24 hours.`,
  ),
  todo: words("هۆکارەکە بزانە و دووبارە هەوڵ بدەرەوە.", "اعرف السبب ثم حاول مرة أخرى.", "Check the reason and try again."),
  fix: `Posts failed in the last 24 hours (audit log app.publish_failed): the number counts failed attempts, not platforms, and leaves out any that was posted again. ${postFixTail}`,
};
const postsWeek: Def = {
  area: "posts",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.post)} لە ٧ ڕۆژی ڕابردوودا بڵاو نەکرایەوە.`,
    (n) => `تعذّر نشر ${A(n, N.post, true)} خلال آخر ٧ أيام.`,
    (n) => `${E(n, N.post)} could not be published in the last 7 days.`,
  ),
  todo: words("بزانە پۆستەکان گەیشتوون یان نا و ئەگەر نا دووبارە بڵاویان بکەرەوە.", "تأكد هل وصلت المنشورات، وإن لم تصل فانشرها من جديد.", "Check whether they went out, and post again if not."),
  fix: `Posts failed in the last 7 days, none in the last 24 hours (audit log app.publish_failed): the number counts failed attempts, not platforms, and leaves out any that was posted again. ${postFixTail}`,
};

/** What Instagram says while it is still preparing a video: stored as a failed post, but the post goes out by itself in minutes. */
const IG_PROCESSING = [ckb, ar, en].map((d) => d.actions.publish.igProcessing);

const metaOf = (metadata: unknown): Record<string, unknown> => (metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {});

/** A failed-post row that is not a lost post: Instagram still preparing a video, or the autopilot leaving a draft for a person ("out of time"). */
export function notALostPost(metadata: unknown): boolean {
  const m = metaOf(metadata);
  const error = typeof m.error === "string" ? m.error : "";
  return error === "out of time" || (m.target === "IG" && IG_PROCESSING.includes(error));
}

/** The rows of one failed attempt are written within seconds of each other (one per target, then the autopilot's own note). */
const SAME_ATTEMPT_MS = 2 * MIN;
/** A failure that was posted again to the same target (and account) within this long is fixed. */
const POSTED_AGAIN_MS = 30 * MIN;
/** The audit rows read for the posts: failed ones and the successful ones that follow them. */
const POST_ROWS = 100;

export interface PostRow {
  /** "app.publish" is a successful target; anything else is a failure. */
  action?: string;
  createdAt: Date;
  metadata: unknown;
}

/**
 * The failed ATTEMPTS that are still lost, as the time each began. The audit log has one row per failed target (and, on a news desk,
 * one more from the autopilot), so rows are grouped: failures within two minutes of the first one are one attempt. A failed target that
 * was posted again within half an hour (a later "app.publish" row for the same target, and the same account when it is named) is no
 * longer lost, and an attempt with nothing lost left is dropped. The autopilot's own note carries no target: it only counts when no
 * target row stands beside it (the card or the post was refused before anything was sent).
 */
export function lostAttempts(rows: readonly PostRow[]): Date[] {
  const posted = rows
    .filter((r) => r.action === "app.publish")
    .map((r) => {
      const m = metaOf(r.metadata);
      return { at: r.createdAt.getTime(), target: typeof m.target === "string" ? m.target : null, account: typeof m.accountId === "string" ? m.accountId : null };
    });
  const failed = rows.filter((r) => r.action !== "app.publish" && !notALostPost(r.metadata)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const attempts: { start: number; targeted: boolean; lost: boolean; bare: boolean }[] = [];
  for (const r of failed) {
    const t = r.createdAt.getTime();
    const m = metaOf(r.metadata);
    const target = typeof m.target === "string" ? m.target : null;
    const account = typeof m.accountId === "string" ? m.accountId : null;
    const again = target !== null && posted.some((p) => p.target === target && p.at > t && p.at - t <= POSTED_AGAIN_MS && (account === null || p.account === account));
    let a = attempts[attempts.length - 1];
    if (!a || t - a.start > SAME_ATTEMPT_MS) {
      a = { start: t, targeted: false, lost: false, bare: false };
      attempts.push(a);
    }
    if (target === null) a.bare = true;
    else {
      a.targeted = true;
      if (!again) a.lost = true;
    }
  }
  return attempts.filter((a) => a.lost || (a.bare && !a.targeted)).map((a) => new Date(a.start));
}

/** Failed posts. `actions` are the audit actions that mean "a post failed" (the successful "app.publish" rows are read beside them). */
export const postsFinder = (actions: readonly string[]): Finder => ({
  area: "posts",
  async run(c) {
    // ONE read: the rows are sorted and grouped here (not counted in the query): a "not a lost post" row has to be left out, a JSON NOT
    // filter would also drop rows that have no error at all, and whether a failure was posted again needs the successful rows too.
    const rows = await db.auditLog.findMany({
      where: { tenantId: c.tenantId, action: { in: [...actions, "app.publish"] }, createdAt: { gt: ago(c, 7 * DAY) } },
      orderBy: { createdAt: "desc" },
      take: POST_ROWS,
      select: { action: true, createdAt: true, metadata: true },
    });
    const lost = lostAttempts(rows);
    const week = lost.length;
    const day = lost.filter((t) => t.getTime() > ago(c, DAY).getTime()).length;
    const href = `${c.base}/publish`;
    if (day > 0) return [found(c, postsDay, day, href)];
    if (week > 0) return [found(c, postsWeek, week, href)];
    return [];
  },
});

const scheduledLate: Def = {
  area: "scheduled",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.scheduled)} زیاتر لە ١٥ خولەک درەنگ کەوتووە.`,
    (n) => `تأخر نشر ${A(n, N.scheduled, true)} أكثر من ١٥ دقيقة.`,
    (n) => `${E(n, N.scheduled)} ${be(n)} more than 15 minutes late.`,
  ),
  todo: words("ئێستا بڵاوی بکەرەوە یان کاتێکی نوێی بۆ دیاری بکە.", "انشره الآن أو حدّد له موعداً جديداً.", "Post it now or give it a new time."),
  fix: "Scheduled posts are overdue (status PENDING, time more than 15 minutes ago): the scheduler may be stuck. Call list_scheduled_posts, then offer to post it now (post_now for a shop, publish_story for a news desk) or cancel_scheduled_post and schedule it again (each needs a card).",
};

const scheduledFailed: Def = {
  area: "scheduled",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.scheduled)} لە ٧ ڕۆژی ڕابردوودا سەرنەکەوت و بڵاو نەکرایەوە.`,
    (n) => `تعذّر نشر ${A(n, N.scheduled, true)} خلال آخر ٧ أيام.`,
    (n) => `${E(n, N.scheduled)} failed to go out in the last 7 days.`,
  ),
  todo: words("پەیجەکە بپشکنە، پاشان ئێستا بڵاوی بکەرەوە یان دووبارە خشتەی بکە.", "افحص الصفحة ثم انشره الآن أو جدوله من جديد.", "Check the Page, then post it now or schedule it again."),
  fix: "Scheduled posts ended FAILED with no result per platform (so the posts finder has no audit row for them): the scheduler gave up or was cut off before it finished, so the post may or may not have gone out. Call list_scheduled_posts; tell the person to check the Page first, then offer to post it again (post_now or schedule_post for a shop, publish_story or schedule_story for a news desk; each needs a card).",
};

export const scheduledFinder: Finder = {
  area: "scheduled",
  async run(c) {
    // A failed run that kept a result already left an "app.publish_failed" row per platform (the posts finder counts it): only those without one are new here.
    const [late, failed] = await Promise.all([
      db.scheduledPost.count({ where: { tenantId: c.tenantId, status: "PENDING", runAt: { lt: ago(c, 15 * MIN) } } }),
      db.scheduledPost.count({ where: { tenantId: c.tenantId, status: "FAILED", result: { equals: Prisma.DbNull }, updatedAt: { gt: ago(c, 7 * DAY) } } }),
    ]);
    const out: Finding[] = [];
    if (late > 0) out.push(found(c, scheduledLate, late, `${c.base}/publish`));
    if (failed > 0) out.push(found(c, scheduledFailed, failed, `${c.base}/publish`));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Replies going out, comments and messages waiting

const outStuck: Def = {
  area: "outbox",
  severity: "high",
  text: say(
    (n) => `${K(n, N.reply)} لە ڕیزی ناردندا گیری خواردووە و نەگەیشتووەتە کڕیاران.`,
    (n) => `علق ${A(n, N.reply)} في طابور الإرسال.`,
    (n) => `${E(n, N.reply)} ${be(n)} stuck in the sending queue and not reaching buyers.`,
  ),
  todo: words("کەمێک چاوەڕێ بکە و دووبارە بپشکنە؛ ئەگەر مایەوە پەیوەندیی پەیجەکە بپشکنە.", "انتظر قليلاً وافحص من جديد، وإن بقيت فراجع ربط الصفحة.", "Wait a little and check again; if they stay, check the Page connection."),
  fix: "Replies are PENDING in the sending queue and were due more than 30 minutes ago: the queue is not running or the connection blocks it. Check the connections finding first. There is no chat tool to retry them.",
};
const outFailed: Def = {
  area: "outbox",
  severity: "high",
  text: say(
    (n) => `${K(n, N.reply)} بۆ کڕیاران لە ٧ ڕۆژی ڕابردوودا نەنێردرا.`,
    (n) => `تعذّر إرسال ${A(n, N.reply, true)} إلى المشترين خلال آخر ٧ أيام.`,
    (n) => `${E(n, N.reply)} to buyers could not be sent in the last 7 days.`,
  ),
  todo: words("نامەی ئەو کڕیارانە بخوێنەوە و بە دەستی وەڵامیان بدەرەوە.", "اقرأ رسائل هؤلاء المشترين وأجب عنها بنفسك.", "Read those buyers' messages and answer them yourself."),
  fix: "Replies could not be sent (sending queue FAILED for good, last 7 days; a reply whose message is already marked needs_you is counted in the needs_you finding instead). A comment whose public reply failed may well have received the private reply already, so do not claim that nothing reached the buyer: check list_comments or list_conversations before answering again, then offer reply_to_comment or send_message (each needs a card). Never answer a buyer without the person's card.",
};
const outNeedsYou: Def = {
  area: "outbox",
  severity: "high",
  text: say(
    (n) => `${K(n, N.message)} نیشانە کراوە «پێویستی بە تۆیە» و هێشتا وەڵام نەدراوەتەوە.`,
    (n) => `توجد ${A(n, N.message)} بحالة «تحتاج إليك» بلا رد حتى الآن.`,
    (n) => `${E(n, N.message)} ${be(n)} marked "needs you" and still waiting for an answer.`,
  ),
  todo: words("نامەکان ببینە و خۆت وەڵامیان بدەرەوە.", "افتح الرسائل وأجب عنها بنفسك.", "Open them and answer yourself."),
  fix: "Buyers (or comments) whose newest message is marked needs_you (a reply could not be sent, or a rule or the assistant asked the owner to answer) and who were not answered since: one count per buyer, and a buyer the owner already answered by hand (in the app, in the chat or on WhatsApp) is left out. Call list_conversations or list_comments and offer reply_to_comment or send_message (each needs a card).",
};

/** Reasons that mean "a person has to answer" (the owner's inbox list); spam and abuse need no answer. needs_you has its own finding. */
const WAITING = ["negotiation", "complaint", "other", "low_confidence", "no_product", "private_window", "unclear", "ai_limit", "no_action"];
const OPEN_REASONS = ["needs_you", ...WAITING];
/** The kinds of job that answer a buyer. */
const ANSWER_KINDS = ["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"] as const;
/** The most flagged messages read for the last week. */
const OPEN_ROWS = 200;

/** One chat (a buyer) or one comment that still waits for the owner. */
interface OpenItem {
  /** "needs_you" or one of WAITING. */
  reason: string;
  /** When the newest flagged message of that buyer (or that comment) came in. */
  at: Date;
  comment: boolean;
}

const isComment = (channelType: string): boolean => channelType === "COMMENT" || channelType === "MENTION";

/**
 * Who still waits for the owner: the messages the assistant flagged for a person in the last week, counted per BUYER (a chat) or per
 * comment (each comment is a thread of its own), by the buyer's newest flagged message (the Messages screen reads a chat by its latest
 * message too). Left out once the owner answered, by the two things the app really records: a ThreadPause newer than the message (made
 * by an answer from the app, the chat or the phone), or a later message of the same buyer whose answer was SENT. Three reads at most,
 * the second and third at once.
 */
async function loadOpen(c: HealthCtx): Promise<OpenItem[]> {
  const rows = await db.conversationMessage.findMany({
    where: { store: { tenantId: c.tenantId }, direction: "INBOUND", outcome: "FLAGGED", outcomeReason: { in: OPEN_REASONS }, createdAt: { gt: ago(c, 7 * DAY) } },
    orderBy: { createdAt: "desc" },
    take: OPEN_ROWS,
    select: { platform: true, channelType: true, authorId: true, externalThreadId: true, externalMessageId: true, parentCommentId: true, outcomeReason: true, createdAt: true },
  });
  interface Unit {
    item: OpenItem;
    platform: string;
    /** The keys a ThreadPause can be stored under: a comment's id (and its parent's), or the buyer's id. */
    pauseKeys: string[];
    /** The buyer's id on their messages (what a SENT answer is matched by). */
    author: string | null;
  }
  const units = new Map<string, Unit>();
  rows.forEach((r, i) => {
    const comment = isComment(r.channelType);
    const buyer = comment ? null : (r.authorId ?? r.externalThreadId);
    // Newest first: the first row of a buyer is the one that counts. A row with no id at all cannot be matched with anything and counts alone.
    const id = comment ? `c:${r.platform}:${r.externalMessageId ?? i}` : buyer ? `d:${r.platform}:${buyer}` : `r:${i}`;
    if (units.has(id)) return;
    const pauseKeys = comment ? [r.externalMessageId, r.parentCommentId].filter((k): k is string => !!k) : buyer ? [buyer] : [];
    units.set(id, { item: { reason: r.outcomeReason ?? "", at: r.createdAt, comment }, platform: r.platform, pauseKeys, author: comment ? null : r.authorId });
  });
  const list = [...units.values()];
  if (!list.length) return [];

  const keys = [...new Set(list.flatMap((u) => u.pauseKeys))];
  const authors = [...new Set(list.map((u) => u.author).filter((a): a is string => !!a))];
  const since = new Date(Math.min(...list.filter((u) => u.author).map((u) => u.item.at.getTime())));
  const [pauses, sent] = await Promise.all([
    keys.length ? db.threadPause.findMany({ where: { tenantId: c.tenantId, threadKey: { in: keys } }, select: { platform: true, threadKey: true, createdAt: true }, take: 500 }) : [],
    authors.length
      ? db.outboxJob.findMany({
          where: { store: { tenantId: c.tenantId }, status: "SENT", kind: { in: [...ANSWER_KINDS] }, message: { direction: "INBOUND", authorId: { in: authors }, createdAt: { gt: since } } },
          select: { message: { select: { platform: true, authorId: true, createdAt: true } } },
          take: 500,
        })
      : [],
  ]);
  const pausedAt = new Map(pauses.map((x) => [`${x.platform}:${x.threadKey}`, x.createdAt.getTime()]));
  const answeredAt = new Map<string, number>();
  for (const j of sent) {
    const k = `${j.message.platform}:${j.message.authorId}`;
    answeredAt.set(k, Math.max(answeredAt.get(k) ?? 0, j.message.createdAt.getTime()));
  }
  return list
    .filter((u) => {
      const at = u.item.at.getTime();
      if (u.pauseKeys.some((k) => (pausedAt.get(`${u.platform}:${k}`) ?? 0) > at)) return false;
      return !(u.author && (answeredAt.get(`${u.platform}:${u.author}`) ?? 0) > at);
    })
    .map((u) => u.item);
}

/** The outbox finder and the inbox finder both need it: it is read once per check (they share the check's context object). */
const openCache = new WeakMap<HealthCtx, Promise<OpenItem[]>>();
function openForOwner(c: HealthCtx): Promise<OpenItem[]> {
  let p = openCache.get(c);
  if (!p) {
    p = loadOpen(c);
    openCache.set(c, p);
  }
  return p;
}

export const outboxFinder: Finder = {
  area: "outbox",
  async run(c) {
    const store = { tenantId: c.tenantId };
    const [stuck, failed, open] = await Promise.all([
      db.outboxJob.count({ where: { store, status: "PENDING", nextAttemptAt: { lt: ago(c, 30 * MIN) } } }),
      // A reply that failed for good and flagged its message "needs you" is told once, as that (below), not twice.
      db.outboxJob.count({
        where: {
          store,
          status: "FAILED",
          kind: { in: [...ANSWER_KINDS] },
          updatedAt: { gt: ago(c, 7 * DAY) },
          message: { OR: [{ outcomeReason: null }, { outcomeReason: { not: "needs_you" } }] },
        },
      }),
      openForOwner(c),
    ]);
    const hourAgo = ago(c, HOUR).getTime();
    const needs = open.filter((i) => i.reason === "needs_you" && i.at.getTime() < hourAgo).length;
    const out: Finding[] = [];
    if (stuck) out.push(found(c, outStuck, stuck, `${c.base}/messages`));
    if (failed) out.push(found(c, outFailed, failed, `${c.base}/messages`));
    if (needs) out.push(found(c, outNeedsYou, needs, `${c.base}/messages`));
    return out;
  },
};

const waitComments: Def = {
  area: "inbox",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.comment)} زیاتر لە ڕۆژێکە چاوەڕێی وەڵامی تۆیە.`,
    (n) => `${there(n)} ${A(n, N.comment)} بانتظار ردك منذ أكثر من يوم.`,
    (n) => `${E(n, N.comment)} ${hv(n)} waited more than a day for your answer.`,
  ),
  todo: words("کۆمێنتەکان بکەرەوە و وەڵامیان بدەرەوە.", "افتح التعليقات وأجب عنها.", "Open the comments and answer them."),
  fix: "Comments flagged for the owner have waited over 24 hours (last 7 days) and were not answered. Call list_comments and offer reply_to_comment (needs a card); the owner decides every answer.",
};
const waitMessages: Def = {
  area: "inbox",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.message)} زیاتر لە ڕۆژێکە چاوەڕێی وەڵامی تۆیە.`,
    (n) => `توجد ${A(n, N.message)} بانتظار ردك منذ أكثر من يوم.`,
    (n) => `${E(n, N.message)} ${hv(n)} waited more than a day for your answer.`,
  ),
  todo: words("نامەکان بکەرەوە و وەڵامیان بدەرەوە.", "افتح الرسائل وأجب عنها.", "Open the messages and answer them."),
  fix: "Buyers whose newest message was flagged for the owner have waited over 24 hours (last 7 days) and were not answered; one count per buyer. Call list_conversations and offer send_message (needs a card). A private message may already be outside Meta's 24-hour window: say so, do not promise it will arrive.",
};

export const inboxFinder: Finder = {
  area: "inbox",
  async run(c) {
    const dayAgo = ago(c, DAY).getTime();
    const waiting = (await openForOwner(c)).filter((i) => i.reason !== "needs_you" && i.at.getTime() < dayAgo);
    const comments = waiting.filter((i) => i.comment).length;
    const messages = waiting.length - comments;
    const out: Finding[] = [];
    if (comments) out.push(found(c, waitComments, comments, `${c.base}/comments`));
    if (messages) out.push(found(c, waitMessages, messages, `${c.base}/messages`));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Orders and products

const ordersWaiting: Def = {
  area: "orders",
  severity: "high",
  text: say(
    (n) => `${K(n, N.order)} زیاتر لە ٢٤ کاتژمێرە چاوەڕێی پشتڕاستکردنەوەیە.`,
    (n) => `${there(n)} ${A(n, N.order)} بلا تأكيد منذ أكثر من ٢٤ ساعة.`,
    (n) => `${E(n, N.order)} ${hv(n)} waited more than 24 hours without being confirmed.`,
  ),
  todo: words("داواکارییەکان بکەرەوە و پشتڕاستیان بکەرەوە یان هەڵیان وەشێنەوە.", "افتح الطلبات وأكّدها أو ألغها.", "Open the orders and confirm or cancel them."),
  fix: "New orders have had the status NEW for over 24 hours (last 60 days). Call list_orders (status NEW) and offer set_order_status (needs a card). The buyer is waiting.",
};

export const ordersFinder: Finder = {
  area: "orders",
  async run(c) {
    const n = await db.order.count({ where: { tenantId: c.tenantId, status: "NEW", createdAt: { gt: ago(c, 60 * DAY), lt: ago(c, DAY) } } });
    return n > 0 ? [found(c, ordersWaiting, n, "/app/orders")] : [];
  },
};

const noPhoto: Def = {
  area: "products",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.product)} وێنەی نییە.`,
    (n) => `${there(n)} ${A(n, N.product)} بلا صورة.`,
    (n) => `${E(n, N.product)} ${hv(n)} no photo.`,
  ),
  todo: words("وێنە بۆ هەر یەکێکیان زیاد بکە.", "أضف صورة لكل منها.", "Add a photo to each of them."),
  fix: "Active products with no photo, so their posts and replies look bare. Call list_products to name them. Photos are added on the Products screen (/app/products).",
};
const noPrice: Def = {
  area: "products",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.product)} نرخی نییە.`,
    (n) => `${there(n)} ${A(n, N.product)} بلا سعر.`,
    (n) => `${E(n, N.product)} ${hv(n)} no price.`,
  ),
  todo: words("نرخ بۆ هەر یەکێکیان دابنێ.", "حدّد سعراً لكل منها.", "Set a price for each of them."),
  fix: "Active products with no price (price 0, or no price line at all): buyers cannot be quoted. Call list_products to name them and offer update_product to set the price (needs a card; ask the person for the price).",
};

export const productsFinder: Finder = {
  area: "products",
  async run(c) {
    const base = { active: true, store: { tenantId: c.tenantId } };
    const [photos, price] = await Promise.all([
      db.product.count({ where: { ...base, photos: { isEmpty: true } } }),
      db.product.count({ where: { ...base, OR: [{ variants: { none: {} } }, { variants: { some: { inStock: true, amountMinor: { lte: 0 } } } }] } }),
    ]);
    const out: Finding[] = [];
    if (price) out.push(found(c, noPrice, price, "/app/products"));
    if (photos) out.push(found(c, noPhoto, photos, "/app/products"));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Settings

const noWhatsapp: Def = {
  area: "settings",
  severity: "info",
  text: say(
    () => "ژمارەی واتسئەپ دانەنراوە، بۆیە کڕیاران ناتوانن لە واتسئەپ پەیوەندیت پێوە بکەن.",
    () => "لم يُحدَّد رقم واتساب، لذلك لا يستطيع المشترون مراسلتك على واتساب.",
    () => "No WhatsApp number is set, so buyers cannot message you on WhatsApp.",
  ),
  todo: words("ژمارەکەت دابنێ (دەتوانیت ژمارەکەم پێ بڵێیت).", "حدّد رقمك (يمكنك أن تعطيني الرقم).", "Set your number (you can tell me the number)."),
  fix: "The workspace has no WhatsApp number. Offer set_whatsapp_number (needs a card and the number from the person; never invent one).",
};
const repliesOff: Def = {
  area: "settings",
  severity: "info",
  text: say(
    (n) => `وەڵامی خۆکار لە ${K(n, N.shop)} کوژاوەتەوە.`,
    (n) => `الردود التلقائية متوقفة في ${A(n, N.shop, true)}.`,
    (n) => `Automatic replies are switched off in ${E(n, N.shop)}.`,
  ),
  todo: words("ئەگەر دەتەوێت کڕیاران خۆکارانە وەڵام بدرێنەوە، بیکەرەوە.", "شغّلها إن أردت أن يُجاب المشترون تلقائياً.", "Switch them on if you want buyers answered automatically."),
  fix: "Automatic replies are off (automationEnabled is false). Do not switch them on by yourself: it is a standing change, so ask first; set_auto_replies does it (needs a card).",
};
const planEnded: Def = {
  area: "settings",
  severity: "medium",
  text: say(
    (n) => `پلانی پارەدراوی ${K(n, N.shop)} تەواو بووە و ئێستا وەک پلانی بەخۆڕایی کار دەکات.`,
    (n) => `انتهت الخطة المدفوعة في ${A(n, N.shop, true)} وتعمل الآن كخطة مجانية.`,
    (n) => `The paid plan has ended in ${E(n, N.shop)}, which now ${n === 1 ? "works" : "work"} on the Free plan.`,
  ),
  todo: words("پلانەکە نوێ بکەرەوە.", "جدّد الخطة.", "Renew the plan."),
  fix: "A paid shop plan ran out (planPaidUntil is in the past; the daily sweep has moved the shop to Free, which keeps the date), so the shop works on the Free limits. Renewing is on the Billing screen (/app/billing); the person must pay there.",
};
const planEnding: Def = {
  area: "settings",
  severity: "info",
  text: say(
    (n) => `پلانی پارەدراوی ${K(n, N.shop)} لە ماوەی ٣ ڕۆژدا تەواو دەبێت.`,
    (n) => `ستنتهي الخطة المدفوعة في ${A(n, N.shop, true)} خلال ٣ أيام.`,
    (n) => `The paid plan ends within 3 days in ${E(n, N.shop)}.`,
  ),
  todo: words("پێش تەواوبوون نوێی بکەرەوە.", "جدّدها قبل أن تنتهي.", "Renew it before it ends."),
  fix: "A paid shop plan ends within 3 days. Renewing is on the Billing screen (/app/billing); the person must pay there.",
};

export const settingsFinder: Finder = {
  area: "settings",
  async run(c) {
    const [tenant, stores] = await Promise.all([
      db.tenant.findUnique({ where: { id: c.tenantId }, select: { whatsappNumber: true, unlimited: true } }),
      db.store.findMany({ where: { tenantId: c.tenantId }, select: { automationEnabled: true, plan: true, planPaidUntil: true }, orderBy: { createdAt: "asc" }, take: 15 }),
    ]);
    const out: Finding[] = [];
    if (tenant && !tenant.whatsappNumber?.trim()) out.push(found(c, noWhatsapp, 0, "/app/settings"));
    const off = stores.filter((s) => !s.automationEnabled).length;
    if (off) out.push(found(c, repliesOff, off, "/app/automation"));
    if (!tenant?.unlimited) {
      const paid = stores.filter((s) => s.plan !== "FREE" && s.plan !== "UNLIMITED" && s.planPaidUntil);
      // The daily sweep sets a lapsed shop to FREE and keeps the date: Free with a recent past date is still "the plan ended" (for a month).
      const lapsed = stores.filter((s) => s.plan === "FREE" && s.planPaidUntil && s.planPaidUntil.getTime() < c.now.getTime() && c.now.getTime() - s.planPaidUntil.getTime() <= 30 * DAY).length;
      const ended = paid.filter((s) => s.planPaidUntil!.getTime() < c.now.getTime()).length + lapsed;
      const soon = paid.filter((s) => s.planPaidUntil!.getTime() >= c.now.getTime() && s.planPaidUntil!.getTime() - c.now.getTime() <= 3 * DAY).length;
      if (ended) out.push(found(c, planEnded, ended, "/app/billing"));
      if (soon) out.push(found(c, planEnding, soon, "/app/billing"));
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Rules and the chat's own actions

const rulesPaused: Def = {
  area: "rules",
  severity: "medium",
  text: say(
    (n) => `دوای کێشە، گیتواس ${num(n)} یاسای خۆکارانە کوژاندەوە.`,
    (n) => `أوقف Gituas ${A(n, N.rule, true)} تلقائياً بعد مشاكل.`,
    (n) => `Gituas switched off ${E(n, N.rule)} by itself after problems.`,
  ),
  todo: words("یاساکان ببینە و دوای ئەوەی هۆکارەکە زانرا دووبارە بیانکەرەوە.", "راجع القواعد وأعد تشغيلها بعد معرفة السبب.", "Look at the rules and switch them back on once the cause is clear."),
  fix: "Rules with the status PAUSED_AUTO were switched off after repeated problems. Call list_rules and list_rule_runs to explain why; offer resume_rule (needs a card) only after the cause is understood.",
};
const rulesFailed: Def = {
  area: "rules",
  severity: "medium",
  text: say(
    (n) => `لە ٧ ڕۆژی ڕابردوودا ${num(n)} جار یاسایەک سەرنەکەوت.`,
    (n) => `تعذّر تنفيذ إحدى القواعد ${A(n, N.time, true)} خلال آخر ٧ أيام.`,
    (n) => `A rule failed to run ${E(n, N.time)} in the last 7 days.`,
  ),
  todo: words("تۆماری یاساکان ببینە بۆ ئەوەی بزانیت چی ڕوویدا.", "اطّلع على سجل القواعد لتعرف ما حدث.", "Look at the rules log to see what happened."),
  fix: "Rule runs with the status FAILED in the last 7 days. Call list_rule_runs to see what happened and explain it plainly.",
};
const rulesDry: Def = {
  area: "rules",
  severity: "info",
  text: say(
    () => "یاساکان لە دۆخی تاقیکردنەوەدان، بۆیە تەنها تۆمار دەکەن چی دەکەن و هیچ نانێرن.",
    () => "القواعد في وضع التجربة، لذلك تسجّل ما كانت ستفعله ولا ترسل شيئاً.",
    () => "Rules are in test mode, so they only write down what they would do and send nothing.",
  ),
  todo: words("ئەمە بۆ تاقیکردنەوەیە؛ کاتێک ئامادە بوویت ڕایبگەیەنە.", "هذا للتجربة؛ أخبرنا عندما تكون جاهزاً.", "This is for testing; tell us when you are ready for it to go live."),
  fix: "The rules run in dry-run mode (a server switch, RULES_DRY_RUN): they log what they would do and send nothing. The person cannot change this from the chat.",
};

export const rulesFinder: Finder = {
  area: "rules",
  async run(c) {
    const dry = rulesDryRun();
    const [pausedRules, failed, active] = await Promise.all([
      db.shopRule.count({ where: { tenantId: c.tenantId, status: "PAUSED_AUTO" } }),
      db.ruleRun.count({ where: { rule: { tenantId: c.tenantId }, status: "FAILED", createdAt: { gt: ago(c, 7 * DAY) } } }),
      dry ? db.shopRule.count({ where: { tenantId: c.tenantId, status: "ACTIVE" } }) : Promise.resolve(0),
    ]);
    const out: Finding[] = [];
    if (pausedRules) out.push(found(c, rulesPaused, pausedRules, "/app/automation"));
    if (failed) out.push(found(c, rulesFailed, failed, "/app/automation"));
    if (dry && active) out.push(found(c, rulesDry, active, "/app/automation"));
    return out;
  },
};

const chatFailed: Def = {
  area: "chat_actions",
  severity: "info",
  text: say(
    (n) => `${K(n, N.action)} لە چاتدا لە ٧ ڕۆژی ڕابردوودا سەرنەکەوت.`,
    (n) => `تعذّر تنفيذ ${A(n, N.action, true)} من المحادثة خلال آخر ٧ أيام.`,
    (n) => `${E(n, N.action)} started in the chat failed in the last 7 days.`,
  ),
  todo: words("ئەگەر هێشتا پێویستتە، دووبارە داوای بکەرەوە.", "اطلبه من جديد إن كنت لا تزال بحاجة إليه.", "Ask again if you still need it."),
  fix: "Chat actions with the status FAILED in the last 7 days. Tell the person plainly; do not retry anything without asking.",
};

const chatUnknown: Def = {
  area: "chat_actions",
  severity: "info",
  text: say(
    (n) => `${K(n, N.action)} لە چاتدا لە ٧ ڕۆژی ڕابردوودا زۆری خایاند و لەوانەیە ئەنجام درابێت.`,
    (n) => `استغرق ${A(n, N.action)} من المحادثة وقتاً طويلاً خلال آخر ٧ أيام وقد يكون قد نُفّذ فعلاً.`,
    (n) => `${E(n, N.action)} started in the chat took too long in the last 7 days and may still have gone through.`,
  ),
  todo: words("پێش ئەوەی دووبارە هەوڵ بدەیتەوە، فەیسبووک و ئینستاگرام و وێنەکانت بپشکنە.", "تحقق من فيسبوك وإنستغرام ومن صورك قبل أن تعيد المحاولة.", "Check Facebook, Instagram and your pictures before trying again."),
  fix: "Chat actions ran out of time in the last 7 days (status FAILED, result.unknownOutcome): the change may have been made after all. Say so plainly and do NOT repeat them or tell the person to ask again; first look at the live state (the matching list_ tool, or ask the person to look at the Page), then offer a new action only if it really did not happen.",
};

/** The error sentence a timed-out run was settled with, in each language (older runs only carry the sentence, newer ones also result.unknownOutcome). */
const UNKNOWN_OUTCOME_ERRORS = (["ckb", "ar", "en"] as const).map((l) => chatSay("unknownOutcome", l));

/** The chat's own actions that failed (shared with the news desk). A run that timed out is told apart: it may have gone through. */
export const chatActionsFinder: Finder = {
  area: "chat_actions",
  async run(c) {
    const failed = { tenantId: c.tenantId, status: "FAILED", createdAt: { gt: ago(c, 7 * DAY) } };
    // Two plain counts: a NOT on the JSON column would drop the runs that have no result at all.
    const [all, unknown] = await Promise.all([
      db.chatRun.count({ where: failed }),
      db.chatRun.count({ where: { ...failed, OR: [{ result: { path: ["unknownOutcome"], equals: true } }, { error: { in: UNKNOWN_OUTCOME_ERRORS } }] } }),
    ]);
    const plain = Math.max(0, all - unknown);
    const out: Finding[] = [];
    if (plain > 0) out.push(found(c, chatFailed, plain));
    if (unknown > 0) out.push(found(c, chatUnknown, unknown));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------

/** The finders of a shop, in the order their findings are listed within one severity. The rules finder is left out while rules are off. */
export function shopFinders(): Finder[] {
  return [
    connectionsFinder,
    postsFinder(["app.publish_failed"]),
    scheduledFinder,
    outboxFinder,
    ordersFinder,
    inboxFinder,
    productsFinder,
    settingsFinder,
    ...(rulesEnabled() ? [rulesFinder] : []),
    chatActionsFinder,
  ];
}

