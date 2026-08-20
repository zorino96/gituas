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
import { vaultDecrypt, vaultEncrypt } from "@/lib/vault";
import { newestFirst, usableOrRefreshable } from "@/lib/oauth/pick";
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

/** Trade the stored refresh_token for a fresh access token, and persist both.
 *
 *  TikTok access tokens live 24 hours. Without this, a creator who connected
 *  yesterday opens the Post to TikTok screen today and is told to reconnect --
 *  every day, forever. That is fine for a demo account and unusable for a
 *  customer.
 *
 *  Two details the docs are quiet about and that make this easy to get wrong:
 *  TikTok ROTATES the refresh token on every call, so the response's
 *  refresh_token must be written back or the next refresh fails; and a failure
 *  here must NOT delete the credential -- a network blip would log the creator
 *  out of an account they never disconnected. On failure we leave the row alone
 *  and return null, which surfaces as "reconnect on Integrations". */
async function refreshTikTokToken(cred: {
  id: string;
  refreshTokenEncrypted: string | null;
}): Promise<string | null> {
  if (!cred.refreshTokenEncrypted) return null;
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return null;

  let refreshToken: string;
  try {
    refreshToken = vaultDecrypt(cred.refreshTokenEncrypted);
  } catch {
    return null;
  }

  let j: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null = null;
  try {
    const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) {
      console.error(
        `[tiktok] refresh failed for credential ${cred.id}: ` +
          `${j?.error ?? r.status} ${j?.error_description ?? ""}`.trim(),
      );
      return null;
    }
  } catch (err) {
    console.error(`[tiktok] refresh threw for credential ${cred.id}:`, err);
    return null;
  }

  const accessToken = j.access_token;
  await db.oAuthCredential.update({
    where: { id: cred.id },
    data: {
      tokenEncrypted: vaultEncrypt(accessToken),
      // Rotated on every refresh — keep the old one only if TikTok omitted it.
      ...(j.refresh_token ? { refreshTokenEncrypted: vaultEncrypt(j.refresh_token) } : {}),
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
    },
  });
  return accessToken;
}

async function tiktokToken(tenantId: string): Promise<string | null> {
  // Expired rows stay eligible: a refresh_token can trade them for a live
  // token. Only a row with neither is dead weight.
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "TIKTOK", ...usableOrRefreshable() },
    orderBy: newestFirst,
  });
  if (!cred) return null;

  // Refresh a minute early rather than on the exact boundary — a token that
  // expires mid-request fails the call, not the check.
  const stale = cred.expiresAt != null && cred.expiresAt.getTime() - Date.now() < 60_000;
  if (stale) return await refreshTikTokToken(cred);

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

/** Turn TikTok's init failure into something the account owner can act on.
 *  The raw body is a JSON blob with a snake_case code and a link to the
 *  developer guidelines — fine in a log, useless on a screen someone is
 *  trying to post from. The codes below are the ones this app can actually
 *  provoke; anything else falls through with the code intact so we are never
 *  hiding a failure we did not anticipate. */
function explainInitError(status: number, err: unknown): string {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  switch (code) {
    case "unaudited_client_can_only_post_to_private_accounts":
      return 'While the Direct Post audit is pending, TikTok only accepts posts set to "Only me". Choose that, or wait for the audit to pass.';
    case "spam_risk_too_many_posts":
      return "TikTok says this account has posted too many times today. Try again tomorrow.";
    case "spam_risk_user_banned_from_posting":
      return "TikTok has blocked this account from posting.";
    case "reached_active_user_cap":
      return "This app has reached the number of creators TikTok allows it to publish for today.";
    case "url_ownership_unverified":
      return "TikTok will not pull the video: the domain hosting it is not verified in the developer portal.";
    case "privacy_level_option_mismatch":
      return "That visibility option is not one this account may use — reopen the post screen to refresh the list.";
    case "access_token_invalid":
    case "scope_not_authorized":
      return "TikTok rejected the stored token — reconnect the account on Integrations.";
    default:
      return code
        ? `TikTok refused the post (${code}). See developers.tiktok.com/doc/content-sharing-guidelines.`
        : `TikTok refused the post (HTTP ${status}).`;
  }
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
    return { ok: false, error: explainInitError(r.status, j?.error) };
  }

  // The post is created asynchronously; publish_id can be polled via
  // /v2/post/publish/status/fetch/ if we want delivery confirmation.
  const publishId: string | undefined = j?.data?.publish_id;
  return { ok: true, externalId: publishId };
}
