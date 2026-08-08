// ---------------------------------------------------------------------------
//  Post to TikTok — the screen TikTok's content-sharing guidelines require
// ---------------------------------------------------------------------------
//
//  Approving in the queue is not enough for TikTok. Before a Direct Post the
//  creator must be shown which account the video goes to, and must choose the
//  privacy level and the comment/duet/stitch settings themselves with nothing
//  pre-selected. All of that is driven by /creator_info/query/, so this page is
//  a server component that fetches it fresh on every load.

import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getTikTokPostContext } from "@/lib/publishers/tiktok";
import { TikTokPostForm } from "./post-client";

export const dynamic = "force-dynamic";
// creator_info + the Direct Post init are two round trips to TikTok; give the
// post action room on a cold serverless instance.
export const maxDuration = 60;

export default async function PostToTikTokPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;

  const post = await db.contentPost.findFirst({
    where: { id, project: { tenant: { ownerId: session.user.id } } },
    include: {
      project: { select: { id: true, name: true, tenantId: true } },
      platformPosts: { where: { platform: "TIKTOK" } },
    },
  });
  if (!post) notFound();

  const platformPost = post.platformPosts[0];
  const ctx = await getTikTokPostContext(post.project.tenantId);

  const caption = [
    post.description,
    (post.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          post to tiktok
        </div>
        <div className="mt-1 font-mono text-3xl">{post.project.name}</div>
        <Link
          href="/dashboard/approvals"
          className="mt-2 inline-block font-mono text-xs text-fg-dim hover:text-fg"
        >
          ← back to approvals
        </Link>
      </div>

      {"error" in ctx ? (
        <div className="rounded-xl border border-line bg-panel p-6 space-y-3">
          <div className="font-mono text-sm text-red-400">tiktok unavailable</div>
          <p className="text-sm text-fg-dim leading-relaxed">{ctx.error}</p>
          <Link
            href="/dashboard/integrations"
            className="inline-block font-mono text-xs px-3 py-2 rounded border border-line hover:border-money"
          >
            go to integrations
          </Link>
        </div>
      ) : platformPost?.status === "PUBLISHED" ? (
        <div className="rounded-xl border border-line bg-panel p-6 space-y-2">
          <div className="font-mono text-sm text-money">already posted</div>
          <p className="text-sm text-fg-dim">
            This video was sent to TikTok
            {platformPost.postedAt ? ` on ${platformPost.postedAt.toISOString().slice(0, 10)}` : ""}.
          </p>
        </div>
      ) : (
        <TikTokPostForm
          contentPostId={post.id}
          caption={caption}
          videoUrl={post.sourceAssetUrl}
          creator={{
            nickname: ctx.creator_nickname,
            username: ctx.creator_username,
            avatarUrl: ctx.creator_avatar_url,
          }}
          privacyOptions={ctx.privacy_level_options ?? []}
          commentDisabled={ctx.comment_disabled}
          duetDisabled={ctx.duet_disabled}
          stitchDisabled={ctx.stitch_disabled}
          maxDurationSec={ctx.max_video_post_duration_sec}
        />
      )}
    </div>
  );
}
