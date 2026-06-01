import { db } from "@/lib/db";
import { vaultDecrypt } from "@/lib/vault";

/**
 * Polls the Reddit Connect integration for the user's recent inbox/mentions and
 * writes them as ConversationMessage rows for the reply-agent to handle.
 */
export async function runRedditInboxAgent(projectId: string): Promise<{ fetched: number; skipped: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, tenant: { select: { id: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO") {
    return { fetched: 0, skipped: "Not AUTO" };
  }
  if (project.mode.replyMode !== "AUTO" && project.mode.commentMode !== "AUTO") {
    return { fetched: 0, skipped: "Reply/comment agents disabled" };
  }
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId: project.tenant.id, provider: "REDDIT" },
  });
  if (!cred) return { fetched: 0, skipped: "No Reddit connection" };
  if (!process.env.REDDIT_USER_AGENT) return { fetched: 0, skipped: "REDDIT_USER_AGENT not set" };
  if (cred.expiresAt && cred.expiresAt < new Date()) {
    return { fetched: 0, skipped: "Reddit token expired" };
  }

  let token: string;
  try {
    token = vaultDecrypt(cred.tokenEncrypted);
  } catch {
    return { fetched: 0, skipped: "Vault decrypt failed" };
  }

  try {
    const res = await fetch("https://oauth.reddit.com/message/inbox.json?limit=25", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": process.env.REDDIT_USER_AGENT! },
    });
    if (!res.ok) return { fetched: 0, skipped: `reddit ${res.status}` };
    const j = await res.json();
    const items: Array<{ data: { id: string; author: string; body: string; subject?: string; was_comment?: boolean; link_id?: string } }> =
      j?.data?.children ?? [];

    let fetched = 0;
    for (const it of items) {
      const externalMessageId = it.data.id;
      const exists = await db.conversationMessage.findFirst({
        where: { projectId, externalMessageId, platform: "REDDIT" },
        select: { id: true },
      });
      if (exists) continue;
      await db.conversationMessage.create({
        data: {
          projectId,
          platform: "REDDIT",
          channelType: it.data.was_comment ? "COMMENT" : "DM",
          direction: "INBOUND",
          status: "RECEIVED",
          externalThreadId: it.data.link_id ?? null,
          externalMessageId,
          authorHandle: it.data.author,
          authorName: it.data.author,
          content: it.data.body,
        },
      });
      fetched++;
    }

    await db.oAuthCredential.update({
      where: { id: cred.id },
      data: { lastUsedAt: new Date() },
    });

    if (fetched > 0) {
      await db.auditLog.create({
        data: {
          tenantId: project.tenant.id,
          projectId,
          actor: "SYSTEM",
          initiatedAs: "AUTO",
          action: "inbox.reddit_fetched",
          reasoning: `Pulled ${fetched} new reddit inbox items.`,
          metadata: { fetched },
        },
      });
    }
    return { fetched, skipped: "" };
  } catch (err) {
    return { fetched: 0, skipped: err instanceof Error ? err.message : "fetch failed" };
  }
}
