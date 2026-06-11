// ---------------------------------------------------------------------------
//  Instagram engagement (Instagram API with Instagram Login)
// ---------------------------------------------------------------------------
//
//  Comments, DMs and insights on top of the same long-lived token the Reels
//  publisher uses. Scopes (request Advanced Access per scope — Phase 1):
//    instagram_business_manage_comments  → read / reply / hide / delete comments
//    instagram_business_manage_messages  → read / send DMs
//    instagram_business_manage_insights  → user + media analytics
//
//  Messaging policy (enforced by Meta — see META-SUBMISSION.md):
//    • you may only reply to users who messaged first (no cold outreach)
//    • free-form replies only inside the 24h window since their last message
//    • HUMAN_AGENT must NOT be used for automated/AI replies
//
//  Docs:
//    https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/

import { getIgCred, V, type IgCred } from "./instagram";

export interface IgResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function fail(prefix: string, status: number, body: unknown): IgResult<never> {
  const detail = (body as { error?: unknown })?.error ?? body;
  return { ok: false, error: `${prefix} ${status}: ${JSON.stringify(detail).slice(0, 250)}` };
}

async function withCred<T>(
  tenantId: string,
  fn: (cred: IgCred) => Promise<IgResult<T>>,
): Promise<IgResult<T>> {
  const cred = await getIgCred(tenantId);
  if (!cred) return { ok: false, error: "Instagram not connected (or token expired — reconnect)" };
  try {
    return await fn(cred);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Instagram request failed" };
  }
}

// ---------- comments -------------------------------------------------------

export interface IgComment {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
}

/** Read the comments on one of the account's own media items. */
export async function fetchComments(tenantId: string, mediaId: string): Promise<IgResult<IgComment[]>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(
      `${V}/${mediaId}/comments?fields=id,text,username,timestamp&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("IG comments", r.status, j);
    return { ok: true, data: (j?.data ?? []) as IgComment[] };
  });
}

/** Reply to a comment (creates a threaded reply under it). */
export async function replyToComment(tenantId: string, commentId: string, message: string): Promise<IgResult<{ id: string }>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${V}/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: message.slice(0, 2200), access_token: cred.token }).toString(),
    });
    const j = await r.json();
    if (!r.ok || !j?.id) return fail("IG comment reply", r.status, j);
    return { ok: true, data: { id: String(j.id) } };
  });
}

/** Hide (or unhide) a comment on the account's media. */
export async function setCommentHidden(tenantId: string, commentId: string, hide: boolean): Promise<IgResult<true>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${V}/${commentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ hide: String(hide), access_token: cred.token }).toString(),
    });
    const j = await r.json();
    if (!r.ok) return fail("IG comment hide", r.status, j);
    return { ok: true, data: true };
  });
}

// ---------- direct messages ------------------------------------------------

/**
 * Send a DM reply. Per Meta policy this only succeeds for users who messaged
 * the account first and within the 24h standard messaging window; outside it,
 * Meta returns an error rather than delivering.
 */
export async function sendInstagramDM(tenantId: string, recipientId: string, text: string): Promise<IgResult<{ messageId?: string }>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${V}/${cred.igUserId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: text.slice(0, 1000) },
        access_token: cred.token,
      }),
    });
    const j = await r.json();
    if (!r.ok) return fail("IG send DM", r.status, j);
    return { ok: true, data: { messageId: j?.message_id } };
  });
}

// ---------- insights -------------------------------------------------------

export interface IgMetric {
  name: string;
  value: number;
}

const DEFAULT_USER_METRICS = ["reach", "follower_count", "profile_views"];

/** Account-level insights for a moving window (default: last day). */
export async function fetchUserInsights(
  tenantId: string,
  metrics: string[] = DEFAULT_USER_METRICS,
  period = "day",
): Promise<IgResult<IgMetric[]>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(
      `${V}/${cred.igUserId}/insights?metric=${metrics.join(",")}&period=${period}&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("IG user insights", r.status, j);
    const data: IgMetric[] = (j?.data ?? []).map((m: { name: string; values?: { value: number }[] }) => ({
      name: m.name,
      value: m.values?.[0]?.value ?? 0,
    }));
    return { ok: true, data };
  });
}

/** Per-media insights (reach, likes, comments, saved, …). */
export async function fetchMediaInsights(
  tenantId: string,
  mediaId: string,
  metrics: string[] = ["reach", "likes", "comments", "saved", "shares"],
): Promise<IgResult<IgMetric[]>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(
      `${V}/${mediaId}/insights?metric=${metrics.join(",")}&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("IG media insights", r.status, j);
    const data: IgMetric[] = (j?.data ?? []).map((m: { name: string; values?: { value: number }[] }) => ({
      name: m.name,
      value: m.values?.[0]?.value ?? 0,
    }));
    return { ok: true, data };
  });
}
