"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { generateProjectPersonality } from "@/lib/personality";
import { isGeminiConfigured } from "@/lib/gemini";

export async function generatePersonality(projectId: string) {
  if (!isGeminiConfigured()) {
    throw new Error("GOOGLE_AI_API_KEY is not configured on this instance");
  }

  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.project.findFirst({
    where: { id: projectId, tenant: { ownerId: session.user.id } },
  });
  if (!project) throw new Error("Project not found");

  if (!project.githubRepoOwner || !project.githubRepoName) {
    throw new Error("Project has no GitHub repo connected");
  }

  const result = await generateProjectPersonality(
    session.user.id,
    project.githubRepoOwner,
    project.githubRepoName,
  );

  await db.projectPersonality.upsert({
    where: { projectId: project.id },
    create: {
      projectId: project.id,
      data: result.personality,
      generatedBy: "gemini-2.5-pro",
    },
    update: {
      data: result.personality,
      version: { increment: 1 },
      generatedBy: "gemini-2.5-pro",
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenantId,
      projectId: project.id,
      actor: "AI_GEMINI",
      action: "project.personality.generated",
      reasoning: `Analyzed ${project.githubRepoOwner}/${project.githubRepoName} and produced Project Personality File.`,
      metadata: { usage: result.usage },
    },
  });

  revalidatePath(`/dashboard/projects/${project.id}`);
}
