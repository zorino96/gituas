"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { publishPlatformPost } from "@/lib/publishers";

async function loadOwned(approvalId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const approval = await db.approvalRequest.findFirst({
    where: { id: approvalId, project: { tenant: { ownerId: session.user.id } } },
    include: { project: { select: { id: true, tenantId: true } } },
  });
  if (!approval) throw new Error("Not found");
  return { approval, userId: session.user.id };
}

export async function approveRequest(approvalId: string) {
  const { approval } = await loadOwned(approvalId);
  if (approval.status !== "PENDING") throw new Error("Already decided");

  await db.approvalRequest.update({
    where: { id: approval.id },
    data: { status: "APPROVED", decidedAt: new Date() },
  });

  if (approval.kind === "CONTENT_POST") {
    const payload = approval.payload as { contentPostId?: string };
    if (payload.contentPostId) {
      await db.contentPost.update({
        where: { id: payload.contentPostId },
        data: { status: "SCHEDULED" },
      });
      const pps = await db.platformPost.findMany({
        where: { contentPostId: payload.contentPostId, status: "PENDING_APPROVAL" },
      });
      for (const pp of pps) {
        await db.platformPost.update({
          where: { id: pp.id },
          data: { status: "SCHEDULED" },
        });
        // Best-effort immediate publish (will be SCHEDULED until publisher works)
        await publishPlatformPost(pp.id);
      }
    }
  } else if (approval.kind === "REPLY") {
    const payload = approval.payload as { conversationMessageId?: string };
    if (payload.conversationMessageId) {
      await db.conversationMessage.update({
        where: { id: payload.conversationMessageId },
        data: { status: "SENT" },
      });
    }
  } else if (approval.kind === "AD_CAMPAIGN") {
    // Move any DRAFT campaign matching name → ACTIVE
    const payload = approval.payload as { name?: string };
    if (payload.name) {
      await db.adCampaign.updateMany({
        where: { projectId: approval.projectId, name: payload.name, status: "PENDING_APPROVAL" },
        data: { status: "ACTIVE", startedAt: new Date() },
      });
    }
  }

  await db.auditLog.create({
    data: {
      tenantId: approval.project.tenantId,
      projectId: approval.projectId,
      actor: "USER",
      action: `approval.approved.${approval.kind.toLowerCase()}`,
      reasoning: "User approved.",
      metadata: { approvalId: approval.id },
    },
  });

  revalidatePath("/dashboard/approvals");
}

export async function rejectRequest(approvalId: string, reason?: string) {
  const { approval } = await loadOwned(approvalId);
  if (approval.status !== "PENDING") throw new Error("Already decided");

  await db.approvalRequest.update({
    where: { id: approval.id },
    data: { status: "REJECTED", decidedAt: new Date(), reason },
  });

  if (approval.kind === "CONTENT_POST") {
    const payload = approval.payload as { contentPostId?: string };
    if (payload.contentPostId) {
      await db.contentPost.update({
        where: { id: payload.contentPostId },
        data: { status: "FAILED" },
      });
    }
  }

  await db.auditLog.create({
    data: {
      tenantId: approval.project.tenantId,
      projectId: approval.projectId,
      actor: "USER",
      action: `approval.rejected.${approval.kind.toLowerCase()}`,
      reasoning: reason ?? "User rejected.",
      metadata: { approvalId: approval.id },
    },
  });

  revalidatePath("/dashboard/approvals");
}
