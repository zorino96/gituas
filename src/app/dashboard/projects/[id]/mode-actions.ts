"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { AgentMode, MasterMode } from "@/generated/prisma/client";

interface ModeUpdate {
  masterMode?: MasterMode;
  adsMode?: AgentMode;
  contentMode?: AgentMode;
  replyMode?: AgentMode;
  commentMode?: AgentMode;
  scalingMode?: AgentMode;
  requireApproval?: boolean;
}

export async function updateMode(projectId: string, patch: ModeUpdate) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.project.findFirst({
    where: { id: projectId, tenant: { ownerId: session.user.id } },
    select: { id: true, tenantId: true },
  });
  if (!project) throw new Error("Project not found");

  await db.projectMode.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id, ...patch },
    update: patch,
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenantId,
      projectId: project.id,
      actor: "USER",
      action: "project.mode.updated",
      reasoning: `User updated operating mode (${JSON.stringify(patch)})`,
    },
  });

  revalidatePath(`/dashboard/projects/${project.id}`);
}
