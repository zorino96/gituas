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

async function currentTenantId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  return tenant?.id ?? null;
}

export interface EngagementData {
  connected: boolean;
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  insights: IgMetric[];
  media: (IgMedia & { comments: IgComment[] })[];
  conversations: IgConversation[];
  errors: string[];
}

export async function loadEngagement(): Promise<EngagementData> {
  const tenantId = await currentTenantId();
  const empty: EngagementData = { connected: false, insights: [], media: [], conversations: [], errors: [] };
  if (!tenantId) return empty;

  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_INSTAGRAM" },
    orderBy: { updatedAt: "desc" },
    select: { providerAccountName: true, providerAccountId: true, avatarUrl: true, scopes: true },
  });
  if (!cred) return empty;

  const errors: string[] = [];

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
