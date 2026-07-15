// ---------------------------------------------------------------------------
//  Facebook Pages — content publishing (Facebook Login for Business)
// ---------------------------------------------------------------------------
//
//  Publishes to a Facebook Page's feed using the non-expiring PAGE access token
//  minted at connect time (see oauth/flow.ts — the META_FACEBOOK branch stores
//  the page token keyed by page id in `providerAccountId`).
//
//    text / link  → POST /{page-id}/feed   (message, link)
//    photo        → POST /{page-id}/photos (url, caption)
//    video        → POST /{page-id}/videos (file_url, description)
//
//  Unlike Instagram there is no container-poll dance for photos and no
//  lazy-refresh — a page token derived from a long-lived user token doesn't
//  expire. The credential is shared with the engagement layer (comments, DMs,
//  insights) in ./facebook-engage.ts.

import { db } from "@/lib/db";
import { vaultDecrypt } from "@/lib/vault";
import type { PublishResult } from "./index";

export const FB_V = "https://graph.facebook.com/v25.0";

export interface FbCred {
  id: string;
  /** The Facebook Page id (stored in OAuthCredential.providerAccountId). */
  pageId: string;
  token: string;
}

/** Load a usable Facebook Page credential (the row whose account id is a page). */
export async function loadFbCred(tenantId: string): Promise<FbCred | null> {
  // A Page credential's providerAccountId is a bare page id; the ads System-User
  // credential uses an `act_...` id — exclude that here.
  const cred = await db.oAuthCredential.findFirst({
    where: {
      tenantId,
      provider: "META_FACEBOOK",
      NOT: { providerAccountId: { startsWith: "act_" } },
    },
    orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
  });
  if (!cred) return null;
  if (cred.expiresAt && cred.expiresAt < new Date()) return null; // reconnect required
  try {
    return { id: cred.id, pageId: cred.providerAccountId, token: vaultDecrypt(cred.tokenEncrypted) };
  } catch {
    return null;
  }
}

export interface FbPublishInput {
  message: string;
  /** Public https URL of the asset Facebook will pull (optional for text posts). */
  mediaUrl?: string;
  mediaType?: "IMAGE" | "VIDEO";
}

export async function publishToFacebookPage(
  tenantId: string,
  content: FbPublishInput,
): Promise<PublishResult> {
  const cred = await loadFbCred(tenantId);
  if (!cred) return { ok: false, error: "Facebook Page not connected (or token expired — reconnect)" };

  const hasMedia = !!content.mediaUrl && /^https:\/\//i.test(content.mediaUrl);
  const isVideo = content.mediaType === "VIDEO";

  let endpoint: string;
  const params: Record<string, string> = { access_token: cred.token };
  if (hasMedia && isVideo) {
    endpoint = `${FB_V}/${cred.pageId}/videos`;
    params.file_url = content.mediaUrl!;
    params.description = content.message.slice(0, 5000);
  } else if (hasMedia) {
    endpoint = `${FB_V}/${cred.pageId}/photos`;
    params.url = content.mediaUrl!;
    params.caption = content.message.slice(0, 5000);
    params.published = "true";
  } else {
    endpoint = `${FB_V}/${cred.pageId}/feed`;
    params.message = content.message.slice(0, 5000);
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const j = await res.json();
    // feed → {id}; photos → {id, post_id}; videos → {id}
    const externalId: string | undefined = j?.post_id ?? j?.id;
    if (!res.ok || !externalId) {
      return { ok: false, error: `Facebook publish ${res.status}: ${JSON.stringify(j?.error ?? j).slice(0, 250)}` };
    }

    await db.oAuthCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } });

    let permalinkUrl: string | undefined;
    try {
      const p = await fetch(
        `${FB_V}/${externalId}?fields=permalink_url&access_token=${encodeURIComponent(cred.token)}`,
      ).then((r) => r.json());
      permalinkUrl = p?.permalink_url
        ? (p.permalink_url.startsWith("http") ? p.permalink_url : `https://www.facebook.com${p.permalink_url}`)
        : undefined;
    } catch {
      /* permalink is nice-to-have */
    }

    return { ok: true, externalId: String(externalId), permalinkUrl };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Facebook call failed" };
  }
}
