// ---------------------------------------------------------------------------
//  Facebook Page engagement (Facebook Login for Business)
// ---------------------------------------------------------------------------
//
//  Comments, Messenger conversations and Page insights on top of the same
//  non-expiring Page token the publisher uses. Scopes (Advanced Access via
//  App Review — Phase 2A):
//    pages_read_engagement / pages_manage_engagement → read/reply/hide comments
//    pages_messaging                                 → read/send Messenger msgs
//    read_insights                                   → Page insights
//
//  Messenger policy (enforced by Meta): free-form replies only inside the 24h
//  window since the user's last message; recipients are PSIDs (you only get a
//  PSID after the user messages the Page first). Mirrors instagram-engage.ts.

import { FB_V, loadFbCred, type FbCred } from "./facebook";

export interface FbResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

function fail(prefix: string, status: number, body: unknown): FbResult<never> {
  const detail = (body as { error?: unknown })?.error ?? body;
  return { ok: false, error: `${prefix} ${status}: ${JSON.stringify(detail).slice(0, 250)}` };
}

async function withCred<T>(
  tenantId: string,
  fn: (cred: FbCred) => Promise<FbResult<T>>,
): Promise<FbResult<T>> {
  const cred = await loadFbCred(tenantId);
  if (!cred) return { ok: false, error: "Facebook Page not connected (or token expired — reconnect)" };
  try {
    return await fn(cred);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Facebook request failed" };
  }
}

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------- posts ----------------------------------------------------------

export interface FbPost {
  id: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
  comments_count?: number;
  likes_count?: number;
  /** The post's image, when it has one. */
  full_picture?: string;
}

/** Recent posts on the Page, with their engagement counts. This is the content
 *  pages_read_engagement is defined by — "content posted by the Page" — so the
 *  full list is returned and rendered, not just the posts that drew comments. */
export async function fetchPagePosts(tenantId: string, limit = 6): Promise<FbResult<FbPost[]>> {
  return withCred(tenantId, async (cred) => {
    const fields = [
      "id",
      "message",
      "permalink_url",
      "created_time",
      "full_picture",
      "comments.summary(true).limit(0)",
      "likes.summary(true).limit(0)",
    ].join(",");
    const r = await fetch(
      `${FB_V}/${cred.pageId}/feed?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("FB posts", r.status, j);
    const total = (v: unknown) => (v as { summary?: { total_count?: number } })?.summary?.total_count;
    const posts = ((j?.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id),
      message: p.message as string | undefined,
      permalink_url: p.permalink_url as string | undefined,
      created_time: p.created_time as string | undefined,
      full_picture: p.full_picture as string | undefined,
      comments_count: total(p.comments),
      likes_count: total(p.likes),
    }));
    return { ok: true, data: posts };
  });
}

// ---------- comments -------------------------------------------------------

export interface FbComment {
  id: string;
  message?: string;
  username?: string;
  timestamp?: string;
}

export async function fetchPageComments(tenantId: string, postId: string): Promise<FbResult<FbComment[]>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(
      `${FB_V}/${postId}/comments?fields=id,message,from{name},created_time&filter=stream&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("FB comments", r.status, j);
    const rows = ((j?.data ?? []) as Array<{ id: string; message?: string; from?: { name?: string }; created_time?: string }>)
      .map((c) => ({ id: c.id, message: c.message, username: c.from?.name, timestamp: c.created_time }));
    return { ok: true, data: rows };
  });
}

export interface FbCommentThread {
  id: string;
  message?: string;
  username?: string;
  authorId?: string;
  timestamp?: string;
  hidden: boolean;
  replies: { id: string; message?: string; authorId?: string; authorName?: string; created_time?: string }[];
}

/**
 * Top-level comments with their replies nested and the hidden flag — what the
 * merchant app needs to tell answered from unanswered. Kept separate from
 * fetchPageComments, whose flat `filter=stream` listing the dashboard relies on.
 */
export async function fetchPageCommentThreads(tenantId: string, postId: string): Promise<FbResult<FbCommentThread[]>> {
  return withCred(tenantId, async (cred) => {
    const fields = "id,message,from{id,name},created_time,is_hidden,comments.limit(25){id,message,from{id,name},created_time}";
    const r = await fetch(
      `${FB_V}/${postId}/comments?fields=${fields}&filter=toplevel&order=reverse_chronological&limit=50&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("FB comments", r.status, j);
    type From = { id?: string; name?: string };
    type Raw = {
      id: string; message?: string; from?: From; created_time?: string; is_hidden?: boolean;
      comments?: { data?: { id: string; message?: string; from?: From; created_time?: string }[] };
    };
    const rows = ((j?.data ?? []) as Raw[]).map((c) => ({
      id: c.id,
      message: c.message,
      username: c.from?.name,
      authorId: c.from?.id,
      timestamp: c.created_time,
      hidden: !!c.is_hidden,
      replies: (c.comments?.data ?? []).map((r) => ({
        id: r.id, message: r.message, authorId: r.from?.id, authorName: r.from?.name, created_time: r.created_time,
      })),
    }));
    return { ok: true, data: rows };
  });
}

/** Delete a comment on the Page's posts. Permanent — the caller confirms first. */
export async function deletePageComment(tenantId: string, commentId: string): Promise<FbResult<true>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${FB_V}/${commentId}?access_token=${encodeURIComponent(cred.token)}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.success === false) return fail("FB comment delete", r.status, j);
    return { ok: true, data: true };
  });
}

/** Reply to a comment (or post) as the Page. */
export async function replyToPageComment(tenantId: string, commentId: string, message: string): Promise<FbResult<{ id: string }>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${FB_V}/${commentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: message.slice(0, 8000), access_token: cred.token }).toString(),
    });
    const j = await r.json();
    if (!r.ok || !j?.id) return fail("FB comment reply", r.status, j);
    return { ok: true, data: { id: String(j.id) } };
  });
}

/** Hide (or unhide) a comment on the Page. */
export async function hidePageComment(tenantId: string, commentId: string, hide: boolean): Promise<FbResult<true>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${FB_V}/${commentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ is_hidden: String(hide), access_token: cred.token }).toString(),
    });
    const j = await r.json();
    if (!r.ok) return fail("FB comment hide", r.status, j);
    return { ok: true, data: true };
  });
}

// ---------- messenger conversations ----------------------------------------

export interface FbConversation {
  id: string;
  updatedTime?: string;
  /** The other participant's PSID (needed to send a reply). */
  participantId?: string;
  participantName?: string;
  messages: { id: string; text?: string; fromPage: boolean; createdTime?: string }[];
  withinWindow: boolean;
}

/** List recent Messenger threads with their last few messages (two-step, like IG). */
export async function fetchPageConversations(tenantId: string, limit = 10): Promise<FbResult<FbConversation[]>> {
  return withCred(tenantId, async (cred) => {
    const t = encodeURIComponent(cred.token);
    const listRes = await fetch(
      `${FB_V}/${cred.pageId}/conversations?platform=messenger&limit=${limit}&access_token=${t}`,
    );
    const list = await listRes.json();
    if (!listRes.ok) return fail("FB conversations", listRes.status, list);

    const convos: FbConversation[] = [];
    for (const c of (list?.data ?? []) as { id: string; updated_time?: string }[]) {
      let messages: FbConversation["messages"] = [];
      let participantId: string | undefined;
      let participantName: string | undefined;
      try {
        const mRes = await fetch(
          `${FB_V}/${c.id}/messages?fields=id,message,from{id,name},created_time&limit=8&access_token=${t}`,
        );
        const m = await mRes.json();
        if (mRes.ok) {
          const rows = (m?.data ?? []) as { id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string }[];
          messages = rows
            .map((x) => ({ id: x.id, text: x.message, fromPage: x.from?.id === cred.pageId, createdTime: x.created_time }))
            .reverse();
          const other = rows.find((x) => x.from?.id && x.from.id !== cred.pageId)?.from;
          participantId = other?.id;
          participantName = other?.name;
        }
      } catch {
        /* leave thread without messages/participant */
      }
      const lastInbound = [...messages].reverse().find((mm) => !mm.fromPage);
      const withinWindow = lastInbound?.createdTime
        ? Date.now() - new Date(lastInbound.createdTime).getTime() < REPLY_WINDOW_MS
        : false;
      convos.push({ id: c.id, updatedTime: c.updated_time, participantId, participantName, messages, withinWindow });
    }
    convos.sort((a, b) => new Date(b.updatedTime ?? 0).getTime() - new Date(a.updatedTime ?? 0).getTime());
    return { ok: true, data: convos };
  });
}

/**
 * Send a Messenger reply to a PSID. Free-form (RESPONSE) only succeeds within
 * the 24h window since the user's last message; outside it Meta returns an
 * error which we surface as a human message.
 */
export async function sendMessengerMessage(tenantId: string, psid: string, text: string): Promise<FbResult<{ messageId?: string }>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(`${FB_V}/${cred.pageId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: { text: text.slice(0, 2000) },
        access_token: cred.token,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      const err = j?.error ?? {};
      if (err.code === 10 || /outside of allowed window|24 hours|not be delivered/i.test(String(err.message ?? ""))) {
        return { ok: false, error: "Outside Messenger's 24-hour reply window — you can only reply within 24h of the person's last message." };
      }
      return fail("FB send message", r.status, j);
    }
    return { ok: true, data: { messageId: j?.message_id } };
  });
}

// ---------- insights -------------------------------------------------------

export interface FbMetric {
  name: string;
  value: number;
}

// The Graph API rejects the WHOLE request if any single metric is invalid for
// the version/period, and Meta prunes the Page metric catalogue between
// versions without notice. As of v25.0 the entire page_impressions family and
// page_fans are gone — they return "(#100) The value must be a valid insights
// metric". The list below was verified against a live Page on 2026-08-26.
//
// This list WILL rot again. What must not rot with it is the follower count:
// fetchPageProfile() reads that from the Page node itself, so the panel keeps
// its headline number even when every metric here dies. Metrics are decoration.
const PAGE_METRIC_GROUPS: { metrics: string[]; period: string }[] = [
  { metrics: ["page_post_engagements", "page_follows"], period: "day" },
  { metrics: ["page_views_total", "page_total_actions"], period: "day" },
];

function readMetricValue(last: unknown): number {
  if (typeof last === "number") return last;
  if (last && typeof last === "object") {
    return Object.values(last as Record<string, number>).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  }
  return 0;
}

export interface FbProfile {
  name?: string;
  followers?: number;
  category?: string;
  link?: string;
}

/** Page node fields. The follower count lives here as a plain field, which is
 *  why it survives the metric deprecations that empty the insights panel. */
export async function fetchPageProfile(tenantId: string): Promise<FbResult<FbProfile>> {
  return withCred(tenantId, async (cred) => {
    const r = await fetch(
      `${FB_V}/${cred.pageId}?fields=name,fan_count,followers_count,category,link&access_token=${encodeURIComponent(cred.token)}`,
    );
    const j = await r.json();
    if (!r.ok) return fail("FB page profile", r.status, j);
    // followers_count is the current field; fan_count is the older one and is
    // still populated. Either is a real number — prefer whichever is present.
    const followers = typeof j?.followers_count === "number"
      ? j.followers_count
      : typeof j?.fan_count === "number"
        ? j.fan_count
        : undefined;
    return {
      ok: true,
      data: {
        name: j?.name as string | undefined,
        followers,
        category: j?.category as string | undefined,
        link: j?.link as string | undefined,
      },
    };
  });
}

/** Page-level insights. Best-effort: returns whatever metric groups resolve;
 *  only fails if every group errors (e.g. token/permission problem). */
export async function fetchPageInsights(tenantId: string): Promise<FbResult<FbMetric[]>> {
  return withCred(tenantId, async (cred) => {
    const out: FbMetric[] = [];
    let anyOk = false;
    let lastErr: string | undefined;
    for (const g of PAGE_METRIC_GROUPS) {
      const r = await fetch(
        `${FB_V}/${cred.pageId}/insights?metric=${g.metrics.join(",")}&period=${g.period}&access_token=${encodeURIComponent(cred.token)}`,
      );
      const j = await r.json();
      if (!r.ok) {
        lastErr = fail("FB page insights", r.status, j).error;
        continue;
      }
      anyOk = true;
      for (const m of (j?.data ?? []) as Array<{ name: string; values?: Array<{ value: unknown }> }>) {
        out.push({ name: m.name, value: readMetricValue(m.values?.[m.values.length - 1]?.value) });
      }
    }
    if (!anyOk) return { ok: false, error: lastErr ?? "insights unavailable" };
    return { ok: true, data: out };
  });
}
