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
  type FbPost,
  type FbComment,
  type FbConversation,
  type FbMetric,
} from "@/lib/publishers/facebook-engage";

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
  posts: (FbPost & { comments: FbComment[] })[];
  conversations: FbConversation[];
}

export interface EngagementData {
  connected: boolean;
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  insights: IgMetric[];
  media: (IgMedia & { comments: IgComment[] })[];
  conversations: IgConversation[];
  facebook: FacebookEngagement;
  errors: string[];
}

const EMPTY_FB: FacebookEngagement = { connected: false, insights: [], posts: [], conversations: [] };

/** Load Facebook Page engagement (posts+comments, Messenger, insights). */
async function loadFacebook(tenantId: string, errors: string[]): Promise<FacebookEngagement> {
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_FACEBOOK", NOT: { providerAccountId: { startsWith: "act_" } } },
    orderBy: { updatedAt: "desc" },
    select: { providerAccountName: true, providerAccountId: true, avatarUrl: true, scopes: true },
  });
  if (!cred) return EMPTY_FB;

  // Insights are best-effort: Meta withholds Page insights for small/new pages,
  // so a failure here isn't actionable for the user — the panel just shows its
  // empty state. Don't surface it in the error banner.
  const insightsRes = await fetchPageInsights(tenantId);

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
    insights: insightsRes.data ?? [],
    posts,
    conversations: convRes.data ?? [],
  };
}

export async function loadEngagement(): Promise<EngagementData> {
  const tenantId = await currentTenantId();
  const empty: EngagementData = { connected: false, insights: [], media: [], conversations: [], facebook: EMPTY_FB, errors: [] };
  if (!tenantId) return empty;

  const errors: string[] = [];
  const facebook = await loadFacebook(tenantId, errors);

  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_INSTAGRAM" },
    orderBy: { updatedAt: "desc" },
    select: { providerAccountName: true, providerAccountId: true, avatarUrl: true, scopes: true },
  });
  if (!cred) return { ...empty, facebook, errors }; // IG not connected — FB may still be

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
