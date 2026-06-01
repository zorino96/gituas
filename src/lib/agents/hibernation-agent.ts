import { db } from "@/lib/db";

/**
 * Puts projects to sleep when they show no signs of life — no published posts
 * in 30 days, no recent commits, no spending. Saves AI budget by stopping all
 * agents on the project until the user wakes it up.
 */
export async function runHibernationAgent(projectId: string): Promise<{ hibernated: boolean; reason: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, tenant: { select: { id: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO") {
    return { hibernated: false, reason: "Not AUTO" };
  }
  if (project.status === "HIBERNATING") {
    return { hibernated: false, reason: "Already hibernating" };
  }

  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const recentActivity = await db.auditLog.count({
    where: { projectId, createdAt: { gte: cutoff } },
  });
  if (recentActivity >= 3) return { hibernated: false, reason: "Active project" };

  await db.project.update({
    where: { id: projectId },
    data: { status: "HIBERNATING" },
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenant.id,
      projectId,
      actor: "SYSTEM",
      initiatedAs: "AUTO",
      action: "project.hibernated",
      reasoning: `No meaningful activity in 30 days — putting the project to sleep to save budget.`,
    },
  });

  return { hibernated: true, reason: "idle" };
}
