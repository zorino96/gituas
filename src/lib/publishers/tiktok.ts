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
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "TIKTOK" },
    orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
  });
  if (!cred) return null;
  if (cred.expiresAt && cred.expiresAt < new Date()) return null; // expired — needs refresh
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

export async function publishToTikTok(
  tenantId: string,
  content: { title: string; videoUrl: string },
): Promise<PublishResult> {
  const token = await tiktokToken(tenantId);
  if (!token) return { ok: false, error: "TikTok not connected (or token expired)" };

  if (!/^https:\/\//i.test(content.videoUrl)) {
    return { ok: false, error: "TikTok needs an https video URL hosted on a verified domain" };
  }

  // 1. Creator info — required before a Direct Post; tells us the allowed
  //    privacy levels (un-audited apps may only post SELF_ONLY).
  const info = await queryCreatorInfo(token);
  if ("error" in info) return { ok: false, error: info.error };

  const privacy =
    info.privacy_level_options?.find((p) => p === "SELF_ONLY") ??
    info.privacy_level_options?.[0] ??
    "SELF_ONLY";

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
        privacy_level: privacy,
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        // Spec-required commercial-content disclosures; Gituas posts organic
        // brand-owned content, so both default off.
        brand_content_toggle: false,
        brand_organic_toggle: false,
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
