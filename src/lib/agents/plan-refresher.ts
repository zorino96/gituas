import { db } from "@/lib/db";
import { generateMarketingPlan } from "@/lib/marketing-plan";

/**
 * Re-runs the 30-day marketing plan when the existing one is exhausted or older
 * than 25 days. Only triggers in AUTO mode.
 */
export async function runPlanRefresher(projectId: string): Promise<{ refreshed: boolean; reason: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, tenant: { select: { id: true, ownerId: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO") {
    return { refreshed: false, reason: "Not AUTO" };
  }

  const latest = await db.marketingPlan.findFirst({
    where: { projectId, status: { in: ["DRAFT", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });

  const ageDays = latest ? (Date.now() - latest.createdAt.getTime()) / 86_400_000 : Infinity;
  const consumed = await db.auditLog.count({
    where: { projectId, action: { startsWith: "content.auto_" } },
  });
  const total = (latest?.data as { contentItems?: unknown[] })?.contentItems?.length ?? 0;
  const exhausted = total > 0 && consumed >= total;

  if (!exhausted && ageDays < 25) {
    return { refreshed: false, reason: "Plan still active" };
  }

  const result = await generateMarketingPlan(project.tenant.ownerId, project.id);
  await db.marketingPlan.create({
    data: {
      projectId,
      data: result.plan,
      status: "DRAFT",
      generatedBy: "gemini-2.5-pro",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  if (latest) {
    await db.marketingPlan.update({
      where: { id: latest.id },
      data: { status: "ARCHIVED" },
    });
  }

  await db.auditLog.create({
    data: {
      tenantId: project.tenant.id,
      projectId,
      actor: "AI_GEMINI",
      initiatedAs: "AUTO",
      action: "plan.auto_refreshed",
      reasoning: exhausted ? "Previous plan exhausted." : `Previous plan was ${Math.round(ageDays)} days old.`,
      metadata: { usage: result.usage },
    },
  });

  return { refreshed: true, reason: exhausted ? "exhausted" : "stale" };
}
