"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getGemini } from "@/lib/gemini";
import {
  fetchMedia,
  fetchComments,
  replyToComment,
  setCommentHidden,
  fetchConversations,
  sendInstagramDM,
  fetchUserInsights,
  type IgMedia,
  type IgComment,
  type IgConversation,
  type IgMetric,
} from "@/lib/publishers/instagram-engage";
import {
  fetchPagePosts,
  fetchPageComments,
  replyToPageComment,
  hidePageComment,
  fetchPageConversations,
  sendMessengerMessage,
  fetchPageInsights,
  fetchPageProfile,
  type FbPost,
  type FbComment,
  type FbConversation,
  type FbMetric,
} from "@/lib/publishers/facebook-engage";
import {
  fetchChannelStats,
  fetchRecentVideos,
  type YtMetric,
  type YtVideo,
} from "@/lib/publishers/youtube-engage";

async function currentTenantId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  return tenant?.id ?? null;
}

export interface FacebookEngagement {
  connected: boolean;
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  insights: FbMetric[];
  /** Set when the insights call failed. Shown as a quiet inline note under the
   *  panel rather than in the page-wide error banner — see loadFacebook. */
  insightsNote?: string;
  posts: (FbPost & { comments: FbComment[] })[];
  conversations: FbConversation[];
}

/** YouTube is read-only here: no comment/DM surface, just channel + video stats. */
export interface YouTubeEngagement {
  connected: boolean;
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  stats: YtMetric[];
  videos: YtVideo[];
}

export interface EngagementData {
  connected: boolean;
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  insights: IgMetric[];
  media: (IgMedia & { comments: IgComment[] })[];
  conversations: IgConversation[];
  facebook: FacebookEngagement;
  youtube: YouTubeEngagement;
  errors: string[];
}

const EMPTY_FB: FacebookEngagement = { connected: false, insights: [], posts: [], conversations: [] };
const EMPTY_YT: YouTubeEngagement = { connected: false, stats: [], videos: [] };

/** Load YouTube channel counters + recent uploads (3 quota units total).
 *
 *  Best-effort, like Facebook Page insights: a stats hiccup (quota, an expired
 *  refresh, a channel with nothing uploaded) isn't actionable for the operator
 *  and shouldn't paint an error banner across a page whose primary surfaces —
 *  Instagram and Facebook — are fine. The panel shows its empty state instead. */
async function loadYouTube(tenantId: string): Promise<YouTubeEngagement> {
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "YOUTUBE" },
    orderBy: { updatedAt: "desc" },
    select: { providerAccountName: true, providerAccountId: true, avatarUrl: true, scopes: true },
  });
  if (!cred) return EMPTY_YT;

  const statsRes = await fetchChannelStats(tenantId);
  const videosRes = await fetchRecentVideos(tenantId, 6);

  return {
    connected: true,
    account: {
      name: cred.providerAccountName ?? cred.providerAccountId,
      avatarUrl: cred.avatarUrl,
      scopes: cred.scopes,
    },
    stats: statsRes.data ?? [],
    videos: videosRes.data ?? [],
  };
}

/** Load Facebook Page engagement (posts+comments, Messenger, insights). */
async function loadFacebook(tenantId: string, errors: string[]): Promise<FacebookEngagement> {
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_FACEBOOK", NOT: { providerAccountId: { startsWith: "act_" } } },
    orderBy: { updatedAt: "desc" },
    select: { providerAccountName: true, providerAccountId: true, avatarUrl: true, scopes: true },
  });
  if (!cred) return EMPTY_FB;

  // Insights stay off the page-wide error banner: a red bar over a working
  // page is worse than a quiet panel. But they are NOT swallowed. A previous
  // version of this code silently discarded the failure with a comment
  // blaming Meta for withholding data from small Pages; the real cause was
  // that we were requesting metrics Meta had deleted, and hiding the error
  // kept that invisible through three App Review submissions. Log it loudly,
  // note it inline, keep it out of the banner.
  const insightsRes = await fetchPageInsights(tenantId);
  let insightsNote: string | undefined;
  if (!insightsRes.ok) {
    console.error(
      `[engagement] Facebook Page insights failed for tenant=${tenantId}. ` +
        `Meta prunes the Page metric catalogue between API versions — if this says ` +
        `"(#100) The value must be a valid insights metric", the metric list in ` +
        `facebook-engage.ts PAGE_METRIC_GROUPS needs re-verifying against a live Page. ` +
        `error=${insightsRes.error}`,
    );
    insightsNote = insightsRes.error;
  }

  // The follower count comes from the Page node, not from insights, so it
  // survives the metric deprecations that empty the panel.
  const profileRes = await fetchPageProfile(tenantId);
  if (!profileRes.ok) {
    console.error(`[engagement] Facebook Page profile failed for tenant=${tenantId}. error=${profileRes.error}`);
  }

  const postsRes = await fetchPagePosts(tenantId, 6);
  if (!postsRes.ok) errors.push(`fb: ${postsRes.error ?? "posts failed"}`);

  const posts: (FbPost & { comments: FbComment[] })[] = [];
  for (const p of (postsRes.data ?? []).slice(0, 5)) {
    let comments: FbComment[] = [];
    if ((p.comments_count ?? 0) > 0) {
      const c = await fetchPageComments(tenantId, p.id);
      if (c.ok) comments = c.data ?? [];
    }
    posts.push({ ...p, comments });
  }

  const convRes = await fetchPageConversations(tenantId);
  if (!convRes.ok) errors.push(`fb: ${convRes.error ?? "conversations failed"}`);

  return {
    connected: true,
    account: {
      name: cred.providerAccountName ?? cred.providerAccountId,
      avatarUrl: cred.avatarUrl,
      scopes: cred.scopes,
    },
    insights: buildFbInsights(profileRes.data?.followers, insightsRes.data ?? []),
    insightsNote,
    posts,
    conversations: convRes.data ?? [],
  };
}

/**
 * Assemble the Page insight tiles.
 *
 *  followers  ← the Page node field, else the page_follows metric
 *  the rest   ← whatever metrics resolved, minus the zeros
 *
 *  Zeros are dropped because a grid of them reads as a broken integration
 *  rather than a quiet Page. Followers is exempt: 0 followers is a real
 *  answer, and keeping one tile guarantees the panel is never empty while
 *  the Page is connected.
 */
function buildFbInsights(fieldFollowers: number | undefined, metrics: FbMetric[]): FbMetric[] {
  const followers = fieldFollowers ?? metrics.find((m) => m.name === "page_follows")?.value;
  const rest = metrics.filter((m) => m.name !== "page_follows" && m.value > 0);
  return [
    ...(followers === undefined ? [] : [{ name: "followers", value: followers }]),
    ...rest,
  ];
}

export async function loadEngagement(): Promise<EngagementData> {
  const tenantId = await currentTenantId();
  const empty: EngagementData = { connected: false, insights: [], media: [], conversations: [], facebook: EMPTY_FB, youtube: EMPTY_YT, errors: [] };
  if (!tenantId) return empty;

  const errors: string[] = [];
  const facebook = await loadFacebook(tenantId, errors);
  const youtube = await loadYouTube(tenantId);

  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_INSTAGRAM" },
    orderBy: { updatedAt: "desc" },
    select: { providerAccountName: true, providerAccountId: true, avatarUrl: true, scopes: true },
  });
  if (!cred) return { ...empty, facebook, youtube, errors }; // IG not connected — FB/YT may still be

  const insightsRes = await fetchUserInsights(tenantId);
  if (!insightsRes.ok) errors.push(insightsRes.error ?? "insights failed");

  const mediaRes = await fetchMedia(tenantId, 6);
  if (!mediaRes.ok) errors.push(mediaRes.error ?? "media failed");

  // Pull comments for the posts that have any (bounded to keep it fast).
  const media: (IgMedia & { comments: IgComment[] })[] = [];
  for (const m of (mediaRes.data ?? []).slice(0, 5)) {
    let comments: IgComment[] = [];
    if ((m.comments_count ?? 0) > 0) {
      const c = await fetchComments(tenantId, m.id);
      if (c.ok) comments = c.data ?? [];
    }
    media.push({ ...m, comments });
  }

  const convRes = await fetchConversations(tenantId);
  if (!convRes.ok) errors.push(convRes.error ?? "conversations failed");

  return {
    connected: true,
    account: {
      name: cred.providerAccountName ?? cred.providerAccountId,
      avatarUrl: cred.avatarUrl,
      scopes: cred.scopes,
    },
    insights: insightsRes.data ?? [],
    media,
    conversations: convRes.data ?? [],
    facebook,
    youtube,
    errors,
  };
}

export async function replyCommentAction(commentId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  const r = await replyToComment(tenantId, commentId, text);
  if (r.ok) {
    await db.auditLog.create({
      data: {
        tenantId,
        actor: "USER",
        action: "engagement.comment_reply",
        reasoning: `Replied to Instagram comment ${commentId}.`,
        metadata: { commentId },
      },
    });
  }
  return { ok: r.ok, error: r.error };
}

export async function hideCommentAction(commentId: string, hide: boolean): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  const r = await setCommentHidden(tenantId, commentId, hide);
  return { ok: r.ok, error: r.error };
}

export async function sendDmAction(recipientId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  const r = await sendInstagramDM(tenantId, recipientId, text);
  if (r.ok) {
    await db.auditLog.create({
      data: {
        tenantId,
        actor: "USER",
        action: "engagement.dm_reply",
        reasoning: `Sent an Instagram DM reply to ${recipientId}.`,
        metadata: { recipientId },
      },
    });
  }
  return { ok: r.ok, error: r.error };
}

// ---------- Facebook Page actions ------------------------------------------

export async function replyFbCommentAction(commentId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  const r = await replyToPageComment(tenantId, commentId, text);
  if (r.ok) {
    await db.auditLog.create({
      data: { tenantId, actor: "USER", action: "engagement.fb_comment_reply", reasoning: `Replied to Facebook comment ${commentId}.`, metadata: { commentId } },
    });
  }
  return { ok: r.ok, error: r.error };
}

export async function hideFbCommentAction(commentId: string, hide: boolean): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  const r = await hidePageComment(tenantId, commentId, hide);
  return { ok: r.ok, error: r.error };
}

export async function sendMessengerAction(psid: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  const r = await sendMessengerMessage(tenantId, psid, text);
  if (r.ok) {
    await db.auditLog.create({
      data: { tenantId, actor: "USER", action: "engagement.fb_messenger_reply", reasoning: `Sent a Messenger reply to ${psid}.`, metadata: { psid } },
    });
  }
  return { ok: r.ok, error: r.error };
}

/** Draft an on-brand reply with Gemini for the operator to review/send. */
export async function draftReplyAction(incoming: string, kind: "comment" | "dm"): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Not signed in" };
  try {
    const ai = getGemini();
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{
            text: `Draft a short, friendly, on-brand reply to this Instagram ${kind}. Be helpful and concise, no hashtags, no emoji spam, don't be sycophantic.\n\n${kind}: "${incoming}"`,
          }],
        },
      ],
      config: { maxOutputTokens: 300 },
    });
    const reply = res.text?.trim() ?? "";
    if (!reply) return { ok: false, error: "Empty draft" };
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Draft failed" };
  }
}
