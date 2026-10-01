// Publishing, without a session. The composer's server action authenticates and
// then calls publishForWorkspace; the scheduled-post cron route calls it with no
// session at all, so nothing in here may read cookies, headers or the current
// user. Everything it needs comes in through `ws` and `input`.

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertWithin, LimitReached, limitMessage, newsroomFrozenError } from "@/lib/billing/limits";
import { captionProblems, isJpegPath, isKnownTarget, isOwnBlobUrl, youtubeProblem, youtubeTitle, type Target } from "@/lib/merchant/caption";
import { tiktokProblems } from "@/lib/merchant/tiktok-rules";
import { recordNewsPublish } from "@/lib/news/publish-record";
import { checkDraft } from "@/lib/news/rules";
import type { Role } from "@/lib/newsroom/roles";
import { publishToFacebookPage } from "@/lib/publishers/facebook";
import { publishToInstagram } from "@/lib/publishers/instagram";
import { publishToYouTube } from "@/lib/publishers/youtube";
import { getTikTokPostContext, publishPhotoToTikTok, publishToTikTok } from "@/lib/publishers/tiktok";
import { tagPublishedPost } from "@/lib/shop/state";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://gituas.vercel.app";

export interface PublishInput {
  caption: string;
  targets: Target[];
  media?: { url: string; pathname: string; type: "IMAGE" | "VIDEO"; durationSec?: number };
  /** Set when the post comes from the news desk; its result is recorded on the draft. */
  newsDraftId?: string;
  /** A shop product card: the published Facebook/Instagram post is tagged with it, so price questions get its card. */
  productId?: string;
  /**
   * The longest the Instagram part may take, in milliseconds. Only the autopilot sets it, because
   * it runs inside a background tick with a hard limit; a person's own post waits as it always did.
   */
  igDeadlineMs?: number;
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
  /** The platform's id for the published post (Facebook, Instagram and YouTube). */
  externalId?: string;
  error?: string;
}

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject = {}) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

/**
 * Publish one post to every selected platform. Each target succeeds or fails on
 * its own — a TikTok rejection never hides that Instagram went out. TikTok's
 * rules are re-checked here against a fresh creator_info call, never against
 * what the browser sent; publishToTikTok checks them a third time.
 *
 * The caller has already authenticated and checked the "publish" permission.
 */
export async function publishForWorkspace(
  ws: { id: string; kind: "MERCHANT" | "NEWS"; role: Role },
  input: PublishInput,
): Promise<PublishOutcome[] | { error: string }> {
  const targets = [...new Set(input.targets)];
  if (!targets.length) return { error: "لانیکەم یەک شوێن هەڵبژێرە." };
  if (!targets.every(isKnownTarget)) return { error: "ئامانجێکی نەناسراو." };
  // A frozen newsroom may not post at all — not only drafts from the news desk.
  if (ws.kind === "NEWS") {
    const frozen = await newsroomFrozenError(ws.id);
    if (frozen) return { error: frozen };
  }
  if (input.newsDraftId) {
    try {
      await assertWithin(ws.id, "publish");
    } catch (e) {
      if (e instanceof LimitReached) return { error: limitMessage(e) };
      throw e;
    }
  }

  const typedCaption = input.caption.trim();
  if (!typedCaption && !input.media) return { error: "دەق یان وێنە/ڤیدیۆیەک زیاد بکە." };
  if ((targets.includes("IG") || targets.includes("TT")) && !input.media) {
    return { error: "ئینستاگرام و تیکتۆک وێنە یان ڤیدیۆیان دەوێت." };
  }
  const ytProblem = youtubeProblem(targets, input.media);
  if (ytProblem) return { error: ytProblem };
  if (input.media) {
    const expected = `merchant/${ws.id}/`;
    if (!input.media.pathname.startsWith(expected) || !/^https:\/\//.test(input.media.url)) {
      return { error: "فایلەکە ناناسرێتەوە. دووبارە بارکردنی بکە." };
    }
    // Our server downloads the YouTube video from this URL, so it must be one of this workspace's own Blob files.
    if (targets.includes("YT") && !isOwnBlobUrl(input.media.url, ws.id)) {
      return { error: "فایلەکە ناناسرێتەوە. دووبارە بارکردنی بکە." };
    }
    if (input.media.type === "IMAGE" && (targets.includes("IG") || targets.includes("TT")) && !isJpegPath(input.media.pathname)) {
      return { error: "ئینستاگرام و تیکتۆک تەنها وێنەی JPG وەردەگرن." };
    }
  }

  // A news post is exactly what the editor typed — no source credit is
  // appended. The draft's source is used only to re-check it for copying.
  const caption = typedCaption;
  if (input.newsDraftId) {
    const draft = await db.newsDraft.findFirst({ where: { id: input.newsDraftId, tenantId: ws.id }, include: { item: true } });
    if (!draft) return { error: "هەواڵەکە نەدۆزرایەوە." };
    if (!draft.cardPath || draft.cardPath !== input.media?.pathname) {
      return { error: "کارتەکە گۆڕاوە. لە مێزی هەواڵ دووبارە ئامادەی بکەوە." };
    }
    const copyProblem = checkDraft({ headline: "", body: typedCaption }, { title: draft.item.title, snippet: draft.item.snippet }).find(
      (p) => p.code === "COPY",
    );
    if (copyProblem) return { error: copyProblem.message };
  }
  if (captionProblems(caption, targets).length) return { error: "دەقەکە بۆ یەکێک لە شوێنەکان درێژە." };

  const run = async (target: Target): Promise<PublishOutcome> => {
    if (target === "FB") {
      const r = await publishToFacebookPage(ws.id, {
        message: caption,
        mediaUrl: input.media?.url,
        mediaType: input.media?.type,
      });
      return { target, ok: r.ok, url: r.permalinkUrl, externalId: r.externalId, error: r.error };
    }
    if (target === "IG") {
      const r = await publishToInstagram(ws.id, { caption, mediaUrl: input.media!.url, mediaType: input.media!.type }, input.igDeadlineMs);
      return { target, ok: r.ok, url: r.permalinkUrl, externalId: r.externalId, error: r.error };
    }
    if (target === "YT") {
      // publishToYouTube downloads the video from its public Blob URL, then uploads it.
      const r = await publishToYouTube(ws.id, { title: youtubeTitle(caption), description: caption, videoUrl: input.media!.url });
      return { target, ok: r.ok, url: r.permalinkUrl, externalId: r.externalId, error: r.error };
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
    const mediaUrl = `${APP_ORIGIN}/m/${input.media!.pathname}`;
    if (input.media!.type === "IMAGE") {
      const r = await publishPhotoToTikTok(
        ws.id,
        { caption, imageUrl: mediaUrl },
        {
          privacyLevel: tt.privacy!,
          disableComment: !tt.allowComment,
          brandOrganicToggle: tt.commercial && tt.yourBrand,
          brandContentToggle: tt.commercial && tt.branded,
        },
      );
      return { target, ok: r.ok, publishId: r.externalId, error: r.error };
    }
    const r = await publishToTikTok(
      ws.id,
      { title: caption, videoUrl: mediaUrl, durationSec: input.media!.durationSec },
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
  if (input.newsDraftId) {
    try {
      await recordNewsPublish(ws.id, input.newsDraftId, results);
    } catch (e) {
      // The post already went out; a bookkeeping failure must not turn that into a reported failure.
      console.error("recordNewsPublish failed:", e instanceof Error ? e.message : "unknown error");
    }
  }
  if (input.productId) {
    for (const o of results) {
      if (o.ok && o.externalId && (o.target === "FB" || o.target === "IG")) {
        await tagPublishedPost(ws.id, o.target === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", o.externalId, input.productId).catch(() => {});
      }
    }
  }
  return results;
}
