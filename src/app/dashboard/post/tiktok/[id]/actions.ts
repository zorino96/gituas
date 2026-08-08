"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { publishToTikTok, type TikTokPostOptions } from "@/lib/publishers/tiktok";

// NB: a "use server" module may only export async functions, so the serverless
// time limit for this action lives on the page (see page.tsx `maxDuration`).

export async function postToTikTok(
  contentPostId: string,
  options: TikTokPostOptions,
): Promise<{ ok: boolean; error?: string }> {
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

  const caption = [
    post.description,
    (post.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  if (platformPost) {
    await db.platformPost.update({
      where: { id: platformPost.id },
      data: { status: "PUBLISHING" },
    });
  }

  const result = await publishToTikTok(
    post.project.tenantId,
    { title: caption, videoUrl: post.sourceAssetUrl },
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
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
