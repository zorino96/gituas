import { db } from "@/lib/db";
import { generateProjectPersonality } from "@/lib/personality";

/**
 * Re-runs the Project Personality every 45+ days when in AUTO mode. Catches
 * cases where the repo has evolved (pivot, rename, new pricing, etc.).
 */
export async function runPersonalityRefresher(projectId: string): Promise<{ refreshed: boolean; reason: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      mode: true,
      personality: true,
      tenant: { select: { id: true, ownerId: true } },
    },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO") {
    return { refreshed: false, reason: "Not AUTO" };
  }
  if (!project.githubRepoOwner || !project.githubRepoName) {
    return { refreshed: false, reason: "No repo connected" };
  }
  if (!project.personality) return { refreshed: false, reason: "No baseline personality yet" };

  const ageDays = (Date.now() - project.personality.updatedAt.getTime()) / 86_400_000;
  if (ageDays < 45) {
    return { refreshed: false, reason: `Only ${Math.round(ageDays)} days old` };
  }

  const result = await generateProjectPersonality(
    project.tenant.ownerId,
    project.githubRepoOwner,
    project.githubRepoName,
  );

  await db.projectPersonality.update({
    where: { projectId },
    data: {
      data: result.personality,
      version: { increment: 1 },
      generatedBy: "gemini-2.5-pro",
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenant.id,
      projectId,
      actor: "AI_GEMINI",
      initiatedAs: "AUTO",
      action: "personality.auto_refreshed",
      reasoning: `Re-analyzed repo after ${Math.round(ageDays)} days.`,
      metadata: { usage: result.usage },
    },
  });

  return { refreshed: true, reason: "stale" };
}
