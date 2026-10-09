"use server";

import { revalidatePath } from "next/cache";

import { auth, MAX_FAILURES, WINDOW_MS } from "@/auth";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import type { Prisma } from "@/generated/prisma/client";
import { newsroomFrozenError } from "@/lib/billing/limits";
import { completeJson } from "@/lib/ai/provider";
import { dict, getLang, type Dict } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { baseFor, currentWorkspace } from "./data";
import {
  deleteIgComment,
  replyToComment,
  sendInstagramDM,
  setCommentHidden,
} from "@/lib/publishers/instagram-engage";
import {
  deletePageComment,
  hidePageComment,
  replyToPageComment,
  sendMessengerMessage,
} from "@/lib/publishers/facebook-engage";
import { fetchTikTokPostStatus, getTikTokPostContext } from "@/lib/publishers/tiktok";
import { normalizePhone } from "@/lib/merchant/phone";
import { publishForWorkspace, type PublishInput, type PublishOutcome } from "@/lib/merchant/publish-core";
import type { Platform } from "@/lib/merchant/types";
import { pauseThread } from "@/lib/shop/pause";
import { withAccounts } from "@/lib/oauth/account-scope";
import { scrubYouTubeLinks } from "@/lib/publishers/youtube-upkeep";

export type Result = { ok: true } | { ok: false; error: string };

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject = {}) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

/** The signed-in workspace (or null) and the dictionary in the user's language. */
async function session() {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  return { ws, t };
}

function cleanText(text: string, max: number, m: Dict["actions"]["inbox"]): { ok: true; text: string } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: m.emptyText };
  if ([...t].length > max) return { ok: false, error: m.textTooLong(max) };
  return { ok: true, text: t };
}

/** Run an engage call as the account the person is looking at (several Pages / Instagram accounts). */
function asAccount<T>(platform: Platform, accountId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return withAccounts(platform === "IG" ? { META_INSTAGRAM: accountId } : { META_FACEBOOK: accountId }, fn);
}

// ---------- comments -------------------------------------------------------

export async function replyToCommentAction(platform: Platform, commentId: string, text: string, accountId?: string): Promise<Result> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const body = cleanText(text, platform === "IG" ? 2200 : 8000, t.actions.inbox);
  if (!body.ok) return body;
  const r = await asAccount(platform, accountId, () => (platform === "IG" ? replyToComment(ws.id, commentId, body.text) : replyToPageComment(ws.id, commentId, body.text)));
  if (!r.ok) return { ok: false, error: r.error ?? t.actions.inbox.sendFailed };
  await pauseThread(ws.id, platform === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", commentId);
  await audit(ws.id, "app.comment_reply", `Replied to ${platform} comment ${commentId}.`, { platform, commentId });
  return { ok: true };
}

export async function setCommentHiddenAction(platform: Platform, commentId: string, hidden: boolean, accountId?: string): Promise<Result> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const r = await asAccount(platform, accountId, () => (platform === "IG" ? setCommentHidden(ws.id, commentId, hidden) : hidePageComment(ws.id, commentId, hidden)));
  if (!r.ok) return { ok: false, error: r.error ?? t.actions.inbox.failed };
  await audit(ws.id, hidden ? "app.comment_hide" : "app.comment_unhide", `${hidden ? "Hid" : "Unhid"} ${platform} comment ${commentId}.`, { platform, commentId });
  return { ok: true };
}

export async function deleteCommentAction(platform: Platform, commentId: string, accountId?: string): Promise<Result> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const r = await asAccount(platform, accountId, () => (platform === "IG" ? deleteIgComment(ws.id, commentId) : deletePageComment(ws.id, commentId)));
  if (!r.ok) return { ok: false, error: r.error ?? t.actions.inbox.deleteFailed };
  await audit(ws.id, "app.comment_delete", `Deleted ${platform} comment ${commentId}.`, { platform, commentId });
  return { ok: true };
}

// ---------- messages -------------------------------------------------------

export async function sendMessageAction(platform: Platform, recipientId: string, text: string, accountId?: string): Promise<Result> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const body = cleanText(text, 1000, t.actions.inbox);
  if (!body.ok) return body;
  const r = await asAccount(platform, accountId, () => (platform === "IG" ? sendInstagramDM(ws.id, recipientId, body.text) : sendMessengerMessage(ws.id, recipientId, body.text)));
  if (!r.ok) return { ok: false, error: r.error ?? t.actions.inbox.sendFailed };
  await pauseThread(ws.id, platform === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", recipientId);
  await audit(ws.id, "app.dm_send", `Sent a ${platform} message to ${recipientId}.`, { platform, recipientId });
  return { ok: true };
}

// ---------- AI -------------------------------------------------------------

/** Short Kurdish/Arabic text through the shared AI chain (kurd.gg, then DeepSeek, then Gemini). */
async function aiText(prompt: string): Promise<string> {
  const { data } = await completeJson<{ text: string }>(
    {
      system: 'You write short social media texts for pages in Iraqi Kurdistan. Follow the rules in the request exactly. Reply with JSON only: {"text": "<the text>"}',
      user: prompt,
      strength: "fast",
      thinking: false,
    },
    (d) => (typeof (d as { text?: unknown })?.text === "string" ? (d as { text: string }) : null),
  );
  return data.text.trim();
}

export async function draftReplyAction(
  incoming: string,
  kind: "comment" | "dm",
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  if (!incoming.trim()) return { ok: false, error: t.actions.inbox.nothingToReply };
  if (ws.kind === "NEWS") {
    const frozen = await newsroomFrozenError(ws.id, t.nr.news.actions);
    if (frozen) return { ok: false, error: frozen };
  }
  const where = kind === "dm" ? "private message" : "public comment";
  // A newsroom answers readers, not customers: no sales talk, no new facts, no sides.
  const prompt =
    ws.kind === "NEWS"
      ? `You are replying on behalf of a news page in Iraqi Kurdistan to a reader's ${where}.
Rules:
- Reply in exactly the language and script the reader used: Sorani Kurdish, Badini Kurdish, Arabic, or Kurdish in Latin letters.
- Short, polite and neutral: one or two sentences.
- Never add facts, figures, names or claims that are not in the reader's message, and never take a political side or argue.
- If the reader sends a tip or reports something, thank them and say the newsroom will look into it.
- No hashtags, no more than one emoji.
- Output only the reply text.

Reader: """${incoming.slice(0, 1000)}"""`
      : `You are replying for a small shop in Iraqi Kurdistan to a customer's ${where}.
Rules:
- Reply in exactly the language and script the customer used: Sorani Kurdish, Badini Kurdish, Arabic, or Kurdish in Latin letters.
- Short and warm: one or two sentences.
- Never state a price, size, delivery fee, or any number that is not already in the customer's message. If they ask for one, say you will send the details privately.
- No hashtags, no more than one emoji.
- Output only the reply text.

Customer: """${incoming.slice(0, 1000)}"""`;
  try {
    const reply = await aiText(prompt);
    if (!reply) return { ok: false, error: t.actions.inbox.aiNoReply };
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t.actions.common.aiDown };
  }
}

export async function suggestCaptionAction(
  notes: string,
): Promise<{ ok: true; caption: string } | { ok: false; error: string }> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "draft")) return { ok: false, error: t.nr.team.roles.notAllowed };
  if (ws.kind === "NEWS") {
    const frozen = await newsroomFrozenError(ws.id, t.nr.news.actions);
    if (frozen) return { ok: false, error: frozen };
  }
  try {
    const caption = await aiText(
      `Write a social media caption in Sorani Kurdish (Arabic script) for a small shop in Iraqi Kurdistan.
${notes.trim() ? `What the merchant wrote about the post: """${notes.slice(0, 800)}"""` : "The merchant gave no notes; write a short, general, inviting caption."}
Rules:
- 2 to 4 short lines. A curiosity hook first.
- Never invent a price, size, quantity or delivery fee. Only repeat numbers the merchant wrote.
- End with a call to message the shop.
- No hashtags (they are added separately). At most two emoji.
- Output only the caption.`,
    );
    if (!caption) return { ok: false, error: t.actions.publish.aiNoCaption };
    return { ok: true, caption };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t.actions.common.aiDown };
  }
}

// ---------- settings -------------------------------------------------------

/**
 * Change the password, or add one to an account made with Google or GitHub.
 * When there is a current password it must be given, and wrong ones count
 * toward the same guessing limit as the sign-in form.
 */
export async function changePasswordAction(current: string, next: string): Promise<Result> {
  const [signedIn, t] = await Promise.all([auth(), getLang().then(dict)]);
  const m = t.actions.settings;
  if (!signedIn?.user?.id) return { ok: false, error: t.nr.shell.newDesk.signInAgain };
  const user = await db.user.findUnique({ where: { id: signedIn.user.id }, select: { id: true, email: true, passwordHash: true } });
  if (!user?.email) return { ok: false, error: m.noEmail };

  const problem = passwordProblem(next);
  if (problem === "too-short") return { ok: false, error: m.passwordShort };
  if (problem === "too-long") return { ok: false, error: m.passwordLong };

  if (user.passwordHash) {
    const failures = await db.loginAttempt.count({ where: { email: user.email, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } } });
    if (failures >= MAX_FAILURES) return { ok: false, error: m.tooManyTries };
    if (!(await verifyPassword(current, user.passwordHash))) {
      await db.loginAttempt.create({ data: { email: user.email } });
      return { ok: false, error: m.wrongPassword };
    }
  }

  // Signs out every other device; the browser that made the change signs
  // straight back in with the new password.
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await db.loginAttempt.deleteMany({ where: { email: user.email } });
  const ws = await currentWorkspace();
  if (ws) await audit(ws.id, "app.password_change", user.passwordHash ? "Changed the account password." : "Added a password to the account.");
  return { ok: true };
}

export async function saveWhatsAppAction(raw: string): Promise<{ ok: true; digits: string | null } | { ok: false; error: string }> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed };
  if (ws.kind !== "MERCHANT") return { ok: false, error: t.actions.settings.whatsappShopOnly };
  if (!raw.trim()) {
    await db.tenant.update({ where: { id: ws.id }, data: { whatsappNumber: null } });
    revalidatePath(baseFor(ws.kind), "layout");
    return { ok: true, digits: null };
  }
  const n = normalizePhone(raw);
  if (!n.ok) return { ok: false, error: t.actions.settings.badWhatsapp };
  await db.tenant.update({ where: { id: ws.id }, data: { whatsappNumber: n.digits } });
  await audit(ws.id, "app.whatsapp_set", "Set the WhatsApp number.", {});
  revalidatePath(baseFor(ws.kind), "layout");
  return { ok: true, digits: n.digits };
}

const DISCONNECTABLE = ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"] as const;

/**
 * Disconnect one account. Its token goes at once. A Facebook Page or Instagram account also
 * leaves the shop store it fed; for YouTube the links to videos uploaded through Gituas go
 * too (YouTube API Services Developer Policies III.D.2, III.E.4).
 */
export async function disconnectAccountAction(provider: (typeof DISCONNECTABLE)[number], accountId: string): Promise<Result> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed };
  if (!(DISCONNECTABLE as readonly string[]).includes(provider) || typeof accountId !== "string" || !accountId || accountId.startsWith("act_")) {
    return { ok: false, error: t.common.error };
  }
  const gone = await db.oAuthCredential.deleteMany({ where: { tenantId: ws.id, provider, providerAccountId: accountId } });
  if (gone.count) {
    if (provider === "YOUTUBE") await scrubYouTubeLinks();
    if (provider === "META_FACEBOOK") await db.store.updateMany({ where: { tenantId: ws.id, fbPageId: accountId }, data: { fbPageId: null } });
    if (provider === "META_INSTAGRAM") await db.store.updateMany({ where: { tenantId: ws.id, igUserId: accountId }, data: { igUserId: null, igUsername: null } });
    if (provider === "META_FACEBOOK" || provider === "META_INSTAGRAM") {
      const key = `${provider === "META_FACEBOOK" ? "FB" : "IG"}:${accountId}`;
      const ns = await db.newsSettings.findUnique({ where: { tenantId: ws.id }, select: { autoAccounts: true } });
      if (ns?.autoAccounts.includes(key)) await db.newsSettings.update({ where: { tenantId: ws.id }, data: { autoAccounts: ns.autoAccounts.filter((x) => x !== key) } });
    }
    await audit(ws.id, "integrations.disconnected", `Disconnected ${provider} ${accountId}.`, { provider, accountId });
  }
  revalidatePath(baseFor(ws.kind), "layout");
  return { ok: true };
}

// ---------- publishing -----------------------------------------------------

export interface TikTokContext {
  nickname?: string;
  avatarUrl?: string;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec?: number;
}

/** The TikTok creator's posting options; `accountId` picks which connected TikTok when there are several. */
export async function tiktokContextAction(accountId?: string): Promise<{ ok: true; ctx: TikTokContext } | { ok: false; error: string }> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  const info = await withAccounts({ TIKTOK: accountId }, () => getTikTokPostContext(ws.id));
  if ("error" in info) return { ok: false, error: info.error };
  return {
    ok: true,
    ctx: {
      nickname: info.creator_nickname ?? info.creator_username,
      avatarUrl: info.creator_avatar_url,
      privacyOptions: info.privacy_level_options ?? [],
      commentDisabled: !!info.comment_disabled,
      duetDisabled: !!info.duet_disabled,
      stitchDisabled: !!info.stitch_disabled,
      maxDurationSec: info.max_video_post_duration_sec,
    },
  };
}

// No `export type { … }` re-exports in this file: every export of a "use server" module becomes a
// server reference, and a type has no value at run time (ReferenceError on /app/publish). Import
// PublishInput and PublishOutcome from @/lib/merchant/publish-core instead.

/**
 * Publish one post to every selected platform. The signed-in part lives here;
 * the publishing itself is publishForWorkspace, which the scheduled-post cron
 * route also calls, without a session.
 */
export async function publishAction(input: PublishInput): Promise<{ ok: true; results: PublishOutcome[] } | { ok: false; error: string }> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "publish")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const r = await publishForWorkspace(ws, input, t);
  if (!Array.isArray(r)) return { ok: false, error: r.error };
  return { ok: true, results: r };
}

export async function tiktokStatusAction(publishId: string, accountId?: string): Promise<{ ok: true; status: string; failReason?: string } | { ok: false; error: string }> {
  const { ws, t } = await session();
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  // The status is asked with the token of the account that posted.
  const s = await withAccounts({ TIKTOK: accountId }, () => fetchTikTokPostStatus(ws.id, publishId));
  if ("error" in s) return { ok: false, error: s.error };
  return { ok: true, status: s.status, failReason: s.failReason };
}
