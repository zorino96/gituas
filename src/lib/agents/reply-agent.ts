import { db } from "@/lib/db";
import { getGemini } from "@/lib/gemini";
import { assertAiBudget, recordAiCall } from "@/lib/ai-budget";
import { sendConversationReply } from "@/lib/publishers/reply-sender";

/**
 * Generates draft replies for incoming ConversationMessages (DMs, comments,
 * etc.). Only runs when replyMode === AUTO. Real platform fetchers (X/IG/etc.)
 * write inbound rows; this agent picks them up and drafts a response.
 */
export async function runReplyAgent(projectId: string): Promise<{ replied: number; skipped: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, personality: true, tenant: { select: { id: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO" || project.mode.replyMode !== "AUTO") {
    return { replied: 0, skipped: "Reply agent disabled" };
  }
  if (!project.personality) return { replied: 0, skipped: "Personality required" };

  const inbox = await db.conversationMessage.findMany({
    where: {
      projectId,
      direction: "INBOUND",
      status: "RECEIVED",
      content: { not: null },
    },
    take: 5,
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length === 0) return { replied: 0, skipped: "No pending replies" };

  await assertAiBudget(project.tenant.id);
  const ai = getGemini();
  let replied = 0;

  for (const msg of inbox) {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{
            text: `Draft a reply to this inbound message on ${msg.platform}.

Author: ${msg.authorHandle ?? msg.authorName ?? "anonymous"}
Message: ${msg.content}

Match the brand voice from the Personality (${(project.personality.data as { toneOfVoice?: string })?.toneOfVoice ?? "PROFESSIONAL"}). Be helpful, concise, on-brand. Don't be sycophantic.`,
          }],
        },
      ],
      config: { maxOutputTokens: 800 },
    });

    const reply = response.text?.trim() ?? "";
    if (!reply) continue;

    if (project.mode.requireApproval) {
      // Hold for a human — the approval action sends it on accept.
      await db.conversationMessage.update({
        where: { id: msg.id },
        data: { status: "PENDING_APPROVAL", generatedReply: reply, reasoning: "Drafted by reply-agent" },
      });
      await db.approvalRequest.create({
        data: {
          projectId,
          kind: "REPLY",
          status: "PENDING",
          payload: { conversationMessageId: msg.id, preview: reply.slice(0, 200) },
        },
      });
    } else {
      // Auto-send immediately and record the real outcome.
      const sent = await sendConversationReply(project.tenant.id, msg, reply);
      await db.conversationMessage.update({
        where: { id: msg.id },
        data: {
          status: sent.ok ? "SENT" : "FAILED",
          generatedReply: reply,
          reasoning: sent.ok ? "Sent by reply-agent" : `Send failed: ${sent.error}`,
        },
      });
    }
    replied++;

    await recordAiCall(project.tenant.id, {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    });
  }

  await db.auditLog.create({
    data: {
      tenantId: project.tenant.id,
      projectId,
      actor: "AI_GEMINI",
      initiatedAs: "AUTO",
      action: "reply.auto_drafted",
      reasoning: `Drafted ${replied} replies (${project.mode.requireApproval ? "queued for approval" : "sent immediately"}).`,
      metadata: { count: replied },
    },
  });

  return { replied, skipped: "" };
}
