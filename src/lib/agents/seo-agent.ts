import { db } from "@/lib/db";
import { getGemini } from "@/lib/gemini";
import { assertAiBudget, recordAiCall } from "@/lib/ai-budget";

/**
 * Generates one long-form SEO blog post per week when seoBlog is in the
 * personality's bestMarketingChannels and content agent is AUTO. The post is
 * saved as a ContentPost with format=blog so the user can publish it manually.
 */
export async function runSeoAgent(projectId: string): Promise<{ generated: boolean; reason: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, personality: true, tenant: { select: { id: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO" || project.mode.contentMode !== "AUTO") {
    return { generated: false, reason: "Disabled" };
  }
  if (!project.personality) return { generated: false, reason: "No personality" };

  const channels = (project.personality.data as { bestMarketingChannels?: string[] })?.bestMarketingChannels ?? [];
  if (!channels.includes("SEO_BLOG")) return { generated: false, reason: "SEO not in channels" };

  // One post per 7 days
  const recent = await db.auditLog.findFirst({
    where: { projectId, action: "seo.auto_generated", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
  });
  if (recent) return { generated: false, reason: "Already generated this week" };

  await assertAiBudget(project.tenant.id);
  const ai = getGemini();
  const personality = project.personality.data as { productName?: string; uniqueAngle?: string; valueProposition?: string };
  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: [
      {
        role: "user",
        parts: [{
          text: `Write an 800-1200 word SEO blog post for ${personality.productName ?? project.name}.\n\nFocus on the topic that best demonstrates: ${personality.uniqueAngle ?? personality.valueProposition ?? "the core value"}.\n\nUse H2/H3 markdown headings, short paragraphs, and end with a natural CTA to try the product.`,
        }],
      },
    ],
    config: { maxOutputTokens: 4000 },
  });

  const body = response.text ?? "";
  if (!body) return { generated: false, reason: "Empty response" };

  const placeholderAssetUrl =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAwIiBoZWlnaHQ9IjYzMCI+PHJlY3QgZmlsbD0iI2VlZSIgd2lkdGg9IjEyMDAiIGhlaWdodD0iNjMwIi8+PC9zdmc+";
  const post = await db.contentPost.create({
    data: {
      projectId,
      sourceAssetUrl: placeholderAssetUrl,
      sourceAssetType: "IMAGE",
      description: body,
      hashtags: [],
      status: project.mode.requireApproval ? "PENDING_APPROVAL" : "DRAFT",
    },
  });

  await recordAiCall(project.tenant.id, {
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenant.id,
      projectId,
      actor: "AI_GEMINI",
      initiatedAs: "AUTO",
      action: "seo.auto_generated",
      reasoning: `Drafted a long-form SEO post (${body.length} chars).`,
      metadata: { contentPostId: post.id },
    },
  });

  return { generated: true, reason: "ok" };
}
