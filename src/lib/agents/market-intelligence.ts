import { db } from "@/lib/db";
import { getGemini } from "@/lib/gemini";
import { assertAiBudget, recordAiCall } from "@/lib/ai-budget";

/**
 * Gemini scans the latest content posts of detected competitors and writes
 * MemoryItems with insights ("competitor X is pivoting to enterprise"). These
 * feed back into later plan refreshes. Skeleton implementation — real
 * competitor scraping would require platform integrations.
 */
export async function runMarketIntelligence(projectId: string): Promise<{ insights: number; skipped: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, personality: true, tenant: { select: { id: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO") {
    return { insights: 0, skipped: "Not AUTO" };
  }
  if (!project.personality) return { insights: 0, skipped: "No personality" };

  const competitors = (project.personality.data as { competitors?: string[] })?.competitors ?? [];
  if (competitors.length === 0) return { insights: 0, skipped: "No competitors" };

  await assertAiBudget(project.tenant.id);
  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [{
          text: `For each of these competitors of ${project.name}, write a single sentence describing what they're emphasizing this quarter (positioning, pricing changes, new features). Competitors: ${competitors.join(", ")}.\n\nReturn one insight per line.`,
        }],
      },
    ],
    config: { maxOutputTokens: 1200 },
  });

  const lines = (response.text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  let stored = 0;
  for (const insight of lines.slice(0, 10)) {
    await db.memoryItem.create({
      data: {
        tenantId: project.tenant.id,
        projectId,
        kind: "competitor_insight",
        content: insight,
        embedding: [],
        metadata: { source: "market-intelligence" },
      },
    });
    stored++;
  }

  await recordAiCall(project.tenant.id, {
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  });

  if (stored > 0) {
    await db.auditLog.create({
      data: {
        tenantId: project.tenant.id,
        projectId,
        actor: "AI_GEMINI",
        initiatedAs: "AUTO",
        action: "intel.auto_scanned",
        reasoning: `Stored ${stored} competitor insights from Gemini.`,
        metadata: { count: stored, competitors: competitors.length },
      },
    });
  }

  return { insights: stored, skipped: "" };
}
