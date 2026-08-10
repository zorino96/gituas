"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  fetchTikTokPostStatus,
  publishToTikTok,
  type TikTokPostOptions,
} from "@/lib/publishers/tiktok";

// NB: a "use server" module may only export async functions, so the serverless
// time limit for this action lives on the page (see page.tsx `maxDuration`).

export async function postToTikTok(
  contentPostId: string,
  options: TikTokPostOptions,
  /** The caption as the creator left it, and the duration the browser measured
   *  off the actual video file. Both come from the screen rather than the stored
   *  draft, because the creator is allowed to change the caption and because the
   *  duration limit has to be checked against the real file. */
  edited: { title: string; durationSec?: number },
): Promise<{ ok: boolean; error?: string; publishId?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Unauthorized" };

  const post = await db.contentPost.findFirst({
    where: { id: contentPostId, project: { tenant: { ownerId: session.user.id } } },
    include: {
      project: { select: { id: true, tenantId: true } },
      platformPosts: { where: { platform: "TIKTOK" } },
    },
  });
  if (!post) return { ok: false, error: "Not found" };

  const platformPost = post.platformPosts[0];
  if (platformPost?.status === "PUBLISHED") {
    return { ok: false, error: "This video has already been posted to TikTok." };
  }

  const caption = edited.title.slice(0, 2200);

  if (platformPost) {
    await db.platformPost.update({
      where: { id: platformPost.id },
      data: { status: "PUBLISHING" },
    });
  }

  const result = await publishToTikTok(
    post.project.tenantId,
    { title: caption, videoUrl: post.sourceAssetUrl, durationSec: edited.durationSec },
    options,
  );

  if (platformPost) {
    await db.platformPost.update({
      where: { id: platformPost.id },
      data: {
        status: result.ok ? "PUBLISHED" : "FAILED",
        platformPostId: result.externalId,
        errorMessage: result.error,
        postedAt: result.ok ? new Date() : undefined,
      },
    });
  }

  if (result.ok) {
    await db.contentPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    // Close the approval this post was waiting on, so the queue does not keep
    // offering a video that has already gone out.
    await db.approvalRequest.updateMany({
      where: {
        projectId: post.project.id,
        kind: "CONTENT_POST",
        status: "PENDING",
        payload: { path: ["contentPostId"], equals: post.id },
      },
      data: { status: "APPROVED", decidedAt: new Date() },
    });
  }

  // The reasoning line records the creator's actual choices — this is the audit
  // trail TikTok's guidelines are ultimately about.
  await db.auditLog.create({
    data: {
      tenantId: post.project.tenantId,
      projectId: post.project.id,
      actor: "USER",
      action: result.ok ? "tiktok.posted" : "tiktok.post_failed",
      reasoning: result.ok
        ? `Creator posted to TikTok with visibility ${options.privacyLevel}; comments ${options.disableComment ? "off" : "on"}, duet ${options.disableDuet ? "off" : "on"}, stitch ${options.disableStitch ? "off" : "on"}.`
        : (result.error ?? "TikTok post failed."),
      metadata: {
        contentPostId: post.id,
        publishId: result.externalId ?? null,
        privacyLevel: options.privacyLevel,
        brandOrganic: options.brandOrganicToggle,
        brandedContent: options.brandContentToggle,
      },
    },
  });

  revalidatePath(`/dashboard/post/tiktok/${post.id}`);
  revalidatePath("/dashboard/approvals");
  return result.ok
    ? { ok: true, publishId: result.externalId }
    : { ok: false, error: result.error };
}

/** Follow a Direct Post after it was accepted. Publishing is asynchronous, so
 *  "sent" is not "published" — the creator needs to see which one it is. */
export async function checkTikTokPostStatus(
  contentPostId: string,
  publishId: string,
): Promise<{ status?: string; failReason?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const post = await db.contentPost.findFirst({
    where: { id: contentPostId, project: { tenant: { ownerId: session.user.id } } },
    select: { project: { select: { tenantId: true } } },
  });
  if (!post) return { error: "Not found" };

  const r = await fetchTikTokPostStatus(post.project.tenantId, publishId);
  if ("error" in r) return { error: r.error };
  return { status: r.status, failReason: r.failReason };
}
