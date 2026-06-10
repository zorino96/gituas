// ---------------------------------------------------------------------------
//  Instagram (Instagram API with Instagram Login) — Reels publishing
// ---------------------------------------------------------------------------
//
//  Flow (https://developers.facebook.com/docs/instagram-platform/content-publishing/):
//    1. POST /{IG_USER_ID}/media            — create a REELS container; Meta
//       pulls the video from any public https URL (no domain verification)
//    2. GET  /{container}?fields=status_code — poll until FINISHED
//    3. POST /{IG_USER_ID}/media_publish     — go live
//
//  Tokens are long-lived (60 days) and self-refreshing: there is no
//  refresh_token. We swap in a fresh token when the current one nears expiry
//  (must be >=24h old and not yet expired — an expired token is unrecoverable).

import { db } from "@/lib/db";
import { vaultDecrypt, vaultEncrypt } from "@/lib/vault";
import type { PublishResult } from "./index";

const HOST = "https://graph.instagram.com";
const V = `${HOST}/v25.0`;

interface IgCred {
  id: string;
  igUserId: string;
  token: string;
  expiresAt: Date | null;
}

async function loadCred(tenantId: string): Promise<IgCred | null> {
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_INSTAGRAM" },
    orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
  });
  if (!cred) return null;
  if (cred.expiresAt && cred.expiresAt < new Date()) return null; // expired — reconnect required
  try {
    return {
      id: cred.id,
      igUserId: cred.providerAccountId,
      token: vaultDecrypt(cred.tokenEncrypted),
      expiresAt: cred.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Swap in a fresh 60-day token when within 10 days of expiry. */
async function lazyRefresh(cred: IgCred): Promise<IgCred> {
  const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;
  if (!cred.expiresAt || cred.expiresAt.getTime() - Date.now() > TEN_DAYS) return cred;
  try {
    const r = await fetch(
      `${HOST}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (r.ok && j?.access_token) {
      const expiresAt = j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null;
      await db.oAuthCredential.update({
        where: { id: cred.id },
        data: { tokenEncrypted: vaultEncrypt(j.access_token), expiresAt },
      });
      return { ...cred, token: j.access_token, expiresAt };
    }
  } catch {
    /* keep the current token — it is still valid */
  }
  return cred;
}

export async function publishToInstagram(
  tenantId: string,
  content: { caption: string; videoUrl: string },
): Promise<PublishResult> {
  let cred = await loadCred(tenantId);
  if (!cred) return { ok: false, error: "Instagram not connected (or token expired — reconnect)" };
  if (!/^https:\/\//i.test(content.videoUrl)) {
    return { ok: false, error: "Instagram needs a public https video URL" };
  }
  cred = await lazyRefresh(cred);

  // Pre-flight: accounts are capped (currently 100 API posts / 24h moving window)
  try {
    const q = await fetch(
      `${V}/${cred.igUserId}/content_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(cred.token)}`,
    ).then((r) => r.json());
    const usage = q?.data?.[0]?.quota_usage;
    const total = q?.data?.[0]?.config?.quota_total;
    if (typeof usage === "number" && typeof total === "number" && usage >= total) {
      return { ok: false, error: `Instagram publish quota reached (${usage}/${total} per 24h)` };
    }
  } catch {
    /* quota check is best-effort */
  }

  // 1. Create the REELS container
  const containerRes = await fetch(`${V}/${cred.igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: content.videoUrl,
      caption: content.caption.slice(0, 2200),
      share_to_feed: "true",
      access_token: cred.token,
    }).toString(),
  });
  const containerJson = await containerRes.json();
  if (!containerRes.ok || !containerJson?.id) {
    return {
      ok: false,
      error: `Instagram container ${containerRes.status}: ${JSON.stringify(containerJson?.error ?? containerJson).slice(0, 250)}`,
    };
  }
  const containerId = String(containerJson.id);

  // 2. Poll until FINISHED. Bounded (~45s) to stay inside serverless limits;
  //    short marketing clips usually process well under that.
  let status = "IN_PROGRESS";
  for (let i = 0; i < 9 && status === "IN_PROGRESS"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const s = await fetch(
        `${V}/${containerId}?fields=status_code&access_token=${encodeURIComponent(cred.token)}`,
      ).then((r) => r.json());
      status = s?.status_code ?? status;
    } catch {
      /* transient — keep polling */
    }
  }
  if (status !== "FINISHED") {
    return {
      ok: false,
      error:
        status === "IN_PROGRESS"
          ? `Instagram container ${containerId} still processing — retry the publish shortly`
          : `Instagram container ${containerId} status: ${status}`,
    };
  }

  // 3. Publish
  const pubRes = await fetch(`${V}/${cred.igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: cred.token }).toString(),
  });
  const pub = await pubRes.json();
  if (!pubRes.ok || !pub?.id) {
    return {
      ok: false,
      error: `Instagram publish ${pubRes.status}: ${JSON.stringify(pub?.error ?? pub).slice(0, 250)}`,
    };
  }

  await db.oAuthCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } });

  let permalinkUrl: string | undefined;
  try {
    const p = await fetch(
      `${V}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(cred.token)}`,
    ).then((r) => r.json());
    permalinkUrl = p?.permalink ?? undefined;
  } catch {
    /* permalink is nice-to-have */
  }

  return { ok: true, externalId: String(pub.id), permalinkUrl };
}
