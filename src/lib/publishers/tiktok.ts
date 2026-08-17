// ---------------------------------------------------------------------------
//  TikTok Content Posting API — Direct Post
// ---------------------------------------------------------------------------
//
//  Flow (https://developers.tiktok.com/doc/content-posting-api-get-started):
//    1. POST /v2/post/publish/creator_info/query/  — REQUIRED before a direct
//       post; returns the privacy levels the creator is allowed to use
//       (an un-audited app is limited to SELF_ONLY).
//    2. POST /v2/post/publish/video/init/  — start a Direct Post, pulling the
//       video from our domain-verified URL (PULL_FROM_URL).
//
//  The video URL must live on a URL prefix verified in the TikTok app's
//  "URL properties" (we verified https://gituas.vercel.app/).

import { db } from "@/lib/db";
import { vaultDecrypt } from "@/lib/vault";
import { newestFirst, unexpired } from "@/lib/oauth/pick";
import type { PublishResult } from "./index";

const BASE = "https://open.tiktokapis.com/v2";

interface CreatorInfo {
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
  creator_username?: string;
  creator_nickname?: string;
  creator_avatar_url?: string;
}

async function tiktokToken(tenantId: string): Promise<string | null> {
  // TikTok has no refresh path here, so an expired row is dead weight.
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "TIKTOK", ...unexpired() },
    orderBy: newestFirst,
  });
  if (!cred) return null;
  try {
    return vaultDecrypt(cred.tokenEncrypted);
  } catch {
    return null;
  }
}

async function queryCreatorInfo(token: string): Promise<CreatorInfo | { error: string }> {
  const r = await fetch(`${BASE}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  const j = await r.json();
  if (!r.ok || j?.error?.code !== "ok") {
    return { error: `creator_info ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 200)}` };
  }
  return j.data as CreatorInfo;
}

/** Fetch the connected creator's username + avatar (for the "confirm account" UI). */
export async function getTikTokCreator(
  tenantId: string,
): Promise<{ username?: string; nickname?: string; avatarUrl?: string } | null> {
  const token = await tiktokToken(tenantId);
  if (!token) return null;
  const info = await queryCreatorInfo(token);
  if ("error" in info) return null;
  return {
    username: info.creator_username,
    nickname: info.creator_nickname,
    avatarUrl: info.creator_avatar_url,
  };
}

/** Ask TikTok what became of a Direct Post.
 *
 *  The guidelines require the creator to be able to follow their post after they
 *  press the button — publishing is asynchronous and can take minutes, and a
 *  post can still fail after init returned ok (an unreachable video URL, a
 *  duration over the creator's limit, a copyright block). Storing publish_id and
 *  never asking again would leave the creator staring at "sent" forever. */
export async function fetchTikTokPostStatus(
  tenantId: string,
  publishId: string,
): Promise<{ status: string; failReason?: string; publiclyAvailablePostId?: string } | { error: string }> {
  const token = await tiktokToken(tenantId);
  if (!token) return { error: "TikTok is not connected." };

  const r = await fetch(`${BASE}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const j = await r.json();
  if (!r.ok || j?.error?.code !== "ok") {
    return { error: `status/fetch ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 200)}` };
  }
  const ids: unknown = j?.data?.publicaly_available_post_id ?? j?.data?.publicly_available_post_id;
  return {
    status: j?.data?.status ?? "UNKNOWN",
    failReason: j?.data?.fail_reason || undefined,
    publiclyAvailablePostId: Array.isArray(ids) ? String(ids[0]) : undefined,
  };
}

/** Everything the post screen must render before it may show a Post button.
 *  TikTok's content-sharing guidelines require the creator to see which account
 *  they are posting to and to pick the privacy level and the interaction
 *  settings themselves, so the UI cannot be built from anything less. */
export type TikTokPostContext = CreatorInfo;

export async function getTikTokPostContext(
  tenantId: string,
): Promise<TikTokPostContext | { error: string }> {
  const token = await tiktokToken(tenantId);
  if (!token) return { error: "TikTok is not connected, or the token has expired — reconnect it on Integrations." };
  return await queryCreatorInfo(token);
}

/** The creator's choices. Every field is a decision TikTok requires a human to
 *  make: none of it may be defaulted or inferred by us. */
export interface TikTokPostOptions {
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** "Your brand" — promotes the creator's own business. */
  brandOrganicToggle: boolean;
  /** "Branded content" — a paid partnership with a third party. */
  brandContentToggle: boolean;
}

export async function publishToTikTok(
  tenantId: string,
  /** `title` is whatever the creator left in the caption box, not what we
   *  drafted — the guidelines require the preset text to be editable, so the
   *  screen is the source of truth here, never the stored draft. */
  content: { title: string; videoUrl: string; durationSec?: number },
  options: TikTokPostOptions,
): Promise<PublishResult> {
  const token = await tiktokToken(tenantId);
  if (!token) return { ok: false, error: "TikTok not connected (or token expired)" };

  if (!/^https:\/\//i.test(content.videoUrl)) {
    return { ok: false, error: "TikTok needs an https video URL hosted on a verified domain" };
  }

  // 1. Creator info — required before a Direct Post, and re-queried here rather
  //    than trusted from the page: the creator may have changed their privacy or
  //    interaction settings in the TikTok app since the screen was rendered, and
  //    posting against a stale option is exactly what the guidelines forbid.
  const info = await queryCreatorInfo(token);
  if ("error" in info) return { ok: false, error: info.error };

  if (!info.privacy_level_options?.includes(options.privacyLevel)) {
    return {
      ok: false,
      error: `"${options.privacyLevel}" is not a privacy level this account may use right now — reopen the post screen.`,
    };
  }
  if (info.comment_disabled && !options.disableComment) {
    return { ok: false, error: "This creator has comments turned off in TikTok." };
  }
  if (info.duet_disabled && !options.disableDuet) {
    return { ok: false, error: "This creator has duet turned off in TikTok." };
  }
  if (info.stitch_disabled && !options.disableStitch) {
    return { ok: false, error: "This creator has stitch turned off in TikTok." };
  }
  // TikTok's own rule: branded content cannot be posted privately.
  if (options.brandContentToggle && options.privacyLevel === "SELF_ONLY") {
    return { ok: false, error: "Branded content cannot be posted with visibility set to Only me." };
  }
  // The duration limit is per-creator and comes back from creator_info, so it
  // has to be checked against a freshly measured video rather than assumed.
  if (
    content.durationSec != null &&
    info.max_video_post_duration_sec != null &&
    content.durationSec > info.max_video_post_duration_sec
  ) {
    return {
      ok: false,
      error: `This video is ${Math.round(content.durationSec)}s, and this account may post at most ${info.max_video_post_duration_sec}s.`,
    };
  }
  if (!content.title.trim()) {
    return { ok: false, error: "Add a caption before posting." };
  }

  // 2. Initialise the Direct Post (pull the video from our verified domain).
  const r = await fetch(`${BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: content.title.slice(0, 2200),
        privacy_level: options.privacyLevel,
        disable_comment: options.disableComment,
        disable_duet: options.disableDuet,
        disable_stitch: options.disableStitch,
        brand_content_toggle: options.brandContentToggle,
        brand_organic_toggle: options.brandOrganicToggle,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: content.videoUrl,
      },
    }),
  });
  const j = await r.json();
  if (!r.ok || j?.error?.code !== "ok") {
    return { ok: false, error: `TikTok init ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 250)}` };
  }

  // The post is created asynchronously; publish_id can be polled via
  // /v2/post/publish/status/fetch/ if we want delivery confirmation.
  const publishId: string | undefined = j?.data?.publish_id;
  return { ok: true, externalId: publishId };
}
