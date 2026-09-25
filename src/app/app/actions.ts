"use server";

import { revalidatePath } from "next/cache";

import { auth, MAX_FAILURES, WINDOW_MS } from "@/auth";
import { db } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import type { Prisma } from "@/generated/prisma/client";
import { getGemini } from "@/lib/gemini";
import { currentWorkspace } from "./data";
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
import { publishToFacebookPage } from "@/lib/publishers/facebook";
import { publishToInstagram } from "@/lib/publishers/instagram";
import { fetchTikTokPostStatus, getTikTokPostContext, publishToTikTok } from "@/lib/publishers/tiktok";
import { normalizePhone } from "@/lib/merchant/phone";
import { captionProblems, type Target } from "@/lib/merchant/caption";
import { tiktokProblems } from "@/lib/merchant/tiktok-rules";
import type { Platform } from "@/lib/merchant/types";

export type Result = { ok: true } | { ok: false; error: string };

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://gituas.vercel.app";

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject = {}) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

function cleanText(text: string, max: number): { ok: true; text: string } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: "دەقەکە بەتاڵە." };
  if ([...t].length > max) return { ok: false, error: `دەقەکە لە ${max} پیت درێژترە.` };
  return { ok: true, text: t };
}

// ---------- comments -------------------------------------------------------

export async function replyToCommentAction(platform: Platform, commentId: string, text: string): Promise<Result> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const t = cleanText(text, platform === "IG" ? 2200 : 8000);
  if (!t.ok) return t;
  const r = platform === "IG" ? await replyToComment(ws.id, commentId, t.text) : await replyToPageComment(ws.id, commentId, t.text);
  if (!r.ok) return { ok: false, error: r.error ?? "ناردن سەرکەوتوو نەبوو." };
  await audit(ws.id, "app.comment_reply", `Replied to ${platform} comment ${commentId}.`, { platform, commentId });
  return { ok: true };
}

export async function setCommentHiddenAction(platform: Platform, commentId: string, hidden: boolean): Promise<Result> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const r = platform === "IG" ? await setCommentHidden(ws.id, commentId, hidden) : await hidePageComment(ws.id, commentId, hidden);
  if (!r.ok) return { ok: false, error: r.error ?? "نەکرا." };
  await audit(ws.id, hidden ? "app.comment_hide" : "app.comment_unhide", `${hidden ? "Hid" : "Unhid"} ${platform} comment ${commentId}.`, { platform, commentId });
  return { ok: true };
}

export async function deleteCommentAction(platform: Platform, commentId: string): Promise<Result> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const r = platform === "IG" ? await deleteIgComment(ws.id, commentId) : await deletePageComment(ws.id, commentId);
  if (!r.ok) return { ok: false, error: r.error ?? "سڕینەوە نەکرا." };
  await audit(ws.id, "app.comment_delete", `Deleted ${platform} comment ${commentId}.`, { platform, commentId });
  return { ok: true };
}

// ---------- messages -------------------------------------------------------

export async function sendMessageAction(platform: Platform, recipientId: string, text: string): Promise<Result> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const t = cleanText(text, 1000);
  if (!t.ok) return t;
  const r = platform === "IG" ? await sendInstagramDM(ws.id, recipientId, t.text) : await sendMessengerMessage(ws.id, recipientId, t.text);
  if (!r.ok) return { ok: false, error: r.error ?? "ناردن سەرکەوتوو نەبوو." };
  await audit(ws.id, "app.dm_send", `Sent a ${platform} message to ${recipientId}.`, { platform, recipientId });
  return { ok: true };
}

// ---------- AI -------------------------------------------------------------

async function gemini(prompt: string, maxOutputTokens = 400): Promise<string> {
  const res = await getGemini().models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens },
  });
  return res.text?.trim() ?? "";
}

export async function draftReplyAction(
  incoming: string,
  kind: "comment" | "dm",
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (!incoming.trim()) return { ok: false, error: "هیچ دەقێک نییە بۆ وەڵامدانەوە." };
  try {
    const reply = await gemini(
      `You are replying for a small shop in Iraqi Kurdistan to a customer's ${kind === "dm" ? "private message" : "public comment"}.
Rules:
- Reply in exactly the language and script the customer used: Sorani Kurdish, Badini Kurdish, Arabic, or Kurdish in Latin letters.
- Short and warm: one or two sentences.
- Never state a price, size, delivery fee, or any number that is not already in the customer's message. If they ask for one, say you will send the details privately.
- No hashtags, no more than one emoji.
- Output only the reply text.

Customer: """${incoming.slice(0, 1000)}"""`,
    );
    if (!reply) return { ok: false, error: "AI هیچ وەڵامێکی نەدایەوە." };
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI کار ناکات." };
  }
}

export async function suggestCaptionAction(
  notes: string,
): Promise<{ ok: true; caption: string } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  try {
    const caption = await gemini(
      `Write a social media caption in Sorani Kurdish (Arabic script) for a small shop in Iraqi Kurdistan.
${notes.trim() ? `What the merchant wrote about the post: """${notes.slice(0, 800)}"""` : "The merchant gave no notes; write a short, general, inviting caption."}
Rules:
- 2 to 4 short lines. A curiosity hook first.
- Never invent a price, size, quantity or delivery fee. Only repeat numbers the merchant wrote.
- End with a call to message the shop.
- No hashtags (they are added separately). At most two emoji.
- Output only the caption.`,
      500,
    );
    if (!caption) return { ok: false, error: "AI هیچ دەقێکی نەنووسی." };
    return { ok: true, caption };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI کار ناکات." };
  }
}

// ---------- settings -------------------------------------------------------

/**
 * Change the password, or add one to an account made with Google or GitHub.
 * When there is a current password it must be given, and wrong ones count
 * toward the same guessing limit as the sign-in form.
 */
export async function changePasswordAction(current: string, next: string): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "دووبارە بچۆ ژوورەوە." };
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, passwordHash: true } });
  if (!user?.email) return { ok: false, error: "ئەم هەژمارە ئیمەیڵی نییە." };

  const problem = passwordProblem(next);
  if (problem === "too-short") return { ok: false, error: "وشەی نهێنیی نوێ دەبێت لانیکەم ٨ پیت بێت." };
  if (problem === "too-long") return { ok: false, error: "وشەی نهێنیی نوێ زۆر درێژە." };

  if (user.passwordHash) {
    const failures = await db.loginAttempt.count({ where: { email: user.email, createdAt: { gte: new Date(Date.now() - WINDOW_MS) } } });
    if (failures >= MAX_FAILURES) return { ok: false, error: "زۆر جار هەڵە کرا. ١٥ خولەک چاوەڕێ بکە." };
    if (!(await verifyPassword(current, user.passwordHash))) {
      await db.loginAttempt.create({ data: { email: user.email } });
      return { ok: false, error: "وشەی نهێنیی ئێستا هەڵەیە." };
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
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (!raw.trim()) {
    await db.tenant.update({ where: { id: ws.id }, data: { whatsappNumber: null } });
    revalidatePath("/app", "layout");
    return { ok: true, digits: null };
  }
  const n = normalizePhone(raw);
  if (!n.ok) return { ok: false, error: "ژمارەکە دروست نییە. بۆ نموونە: 0750 123 4567" };
  await db.tenant.update({ where: { id: ws.id }, data: { whatsappNumber: n.digits } });
  await audit(ws.id, "app.whatsapp_set", "Set the WhatsApp number.", {});
  revalidatePath("/app", "layout");
  return { ok: true, digits: n.digits };
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

export async function tiktokContextAction(): Promise<{ ok: true; ctx: TikTokContext } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const info = await getTikTokPostContext(ws.id);
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

export interface PublishInput {
  caption: string;
  targets: Target[];
  media?: { url: string; pathname: string; type: "IMAGE" | "VIDEO"; durationSec?: number };
  tiktok?: {
    privacy: string | null;
    allowComment: boolean;
    allowDuet: boolean;
    allowStitch: boolean;
    commercial: boolean;
    yourBrand: boolean;
    branded: boolean;
  };
}

export interface PublishOutcome {
  target: Target;
  ok: boolean;
  url?: string;
  publishId?: string;
  error?: string;
}

/**
 * Publish one post to every selected platform. Each target succeeds or fails on
 * its own — a TikTok rejection never hides that Instagram went out. TikTok's
 * rules are re-checked here against a fresh creator_info call, never against
 * what the browser sent; publishToTikTok checks them a third time.
 */
export async function publishAction(input: PublishInput): Promise<{ ok: true; results: PublishOutcome[] } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const targets = [...new Set(input.targets)];
  if (!targets.length) return { ok: false, error: "لانیکەم یەک شوێن هەڵبژێرە." };

  const caption = input.caption.trim();
  if (captionProblems(caption, targets).length) return { ok: false, error: "دەقەکە بۆ یەکێک لە شوێنەکان درێژە." };
  if (!caption && !input.media) return { ok: false, error: "دەق یان وێنە/ڤیدیۆیەک زیاد بکە." };
  if ((targets.includes("IG") || targets.includes("TT")) && !input.media) {
    return { ok: false, error: "ئینستاگرام و تیکتۆک وێنە یان ڤیدیۆیان دەوێت." };
  }
  if (targets.includes("TT") && input.media?.type !== "VIDEO") return { ok: false, error: "تیکتۆک تەنیا ڤیدیۆ وەردەگرێت." };
  if (input.media) {
    const expected = `merchant/${ws.id}/`;
    if (!input.media.pathname.startsWith(expected) || !/^https:\/\//.test(input.media.url)) {
      return { ok: false, error: "فایلەکە ناناسرێتەوە. دووبارە بارکردنی بکە." };
    }
  }

  const run = async (target: Target): Promise<PublishOutcome> => {
    if (target === "FB") {
      const r = await publishToFacebookPage(ws.id, {
        message: caption,
        mediaUrl: input.media?.url,
        mediaType: input.media?.type,
      });
      return { target, ok: r.ok, url: r.permalinkUrl, error: r.error };
    }
    if (target === "IG") {
      const r = await publishToInstagram(ws.id, { caption, mediaUrl: input.media!.url, mediaType: input.media!.type });
      return { target, ok: r.ok, url: r.permalinkUrl, error: r.error };
    }
    // TikTok pulls the video from our verified domain, through the media proxy.
    const tt = input.tiktok;
    if (!tt) return { target, ok: false, error: "ڕێکخستنەکانی تیکتۆک دیاری نەکراون." };
    const info = await getTikTokPostContext(ws.id);
    if ("error" in info) return { target, ok: false, error: info.error };
    const problems = tiktokProblems(
      { privacy: tt.privacy, commercial: tt.commercial, yourBrand: tt.yourBrand, branded: tt.branded, durationSec: input.media!.durationSec },
      { privacyOptions: info.privacy_level_options ?? [], maxDurationSec: info.max_video_post_duration_sec },
    );
    if (problems.length) return { target, ok: false, error: `ڕێکخستنی تیکتۆک تەواو نییە (${problems.join(", ")}).` };
    const r = await publishToTikTok(
      ws.id,
      { title: caption, videoUrl: `${APP_ORIGIN}/m/${input.media!.pathname}`, durationSec: input.media!.durationSec },
      {
        privacyLevel: tt.privacy!,
        disableComment: !tt.allowComment,
        disableDuet: !tt.allowDuet,
        disableStitch: !tt.allowStitch,
        brandOrganicToggle: tt.commercial && tt.yourBrand,
        brandContentToggle: tt.commercial && tt.branded,
      },
    );
    return { target, ok: r.ok, publishId: r.externalId, error: r.error };
  };

  const settled = await Promise.allSettled(targets.map(run));
  const results = settled.map((s, i): PublishOutcome =>
    s.status === "fulfilled" ? s.value : { target: targets[i], ok: false, error: s.reason instanceof Error ? s.reason.message : "هەڵە" },
  );
  for (const r of results) {
    const meta: Prisma.InputJsonObject = {
      target: r.target,
      ...(r.url ? { url: r.url } : {}),
      ...(r.publishId ? { publishId: r.publishId } : {}),
      ...(r.error ? { error: r.error.slice(0, 500) } : {}),
    };
    await audit(ws.id, r.ok ? "app.publish" : "app.publish_failed", `${r.ok ? "Published" : "Failed to publish"} to ${r.target}.`, meta);
  }
  return { ok: true, results };
}

export async function tiktokStatusAction(publishId: string): Promise<{ ok: true; status: string; failReason?: string } | { ok: false; error: string }> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  const s = await fetchTikTokPostStatus(ws.id, publishId);
  if ("error" in s) return { ok: false, error: s.error };
  return { ok: true, status: s.status, failReason: s.failReason };
}
