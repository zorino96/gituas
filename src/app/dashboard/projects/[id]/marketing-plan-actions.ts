"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { generateMarketingPlan } from "@/lib/marketing-plan";
import { isGeminiConfigured } from "@/lib/gemini";

export async function generatePlan(projectId: string) {
  if (!isGeminiConfigured()) {
    throw new Error("GOOGLE_AI_API_KEY is not configured on this instance");
  }

  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.project.findFirst({
    where: { id: projectId, tenant: { ownerId: session.user.id } },
    select: { id: true, tenantId: true },
  });
  if (!project) throw new Error("Project not found");

  const result = await generateMarketingPlan(session.user.id, project.id);

  await db.marketingPlan.create({
    data: {
      projectId: project.id,
      data: result.plan,
      status: "DRAFT",
      generatedBy: "gemini-2.5-pro",
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: project.tenantId,
      projectId: project.id,
      actor: "AI_GEMINI",
      action: "project.plan.generated",
      reasoning: `Produced a 30-day marketing plan with ${result.plan.contentItems.length} content items and ${result.plan.adCampaigns.length} ad campaigns.`,
      metadata: { usage: result.usage },
    },
  });

  revalidatePath(`/dashboard/projects/${project.id}`);
}
