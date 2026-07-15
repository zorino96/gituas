"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { publishPlatformPost } from "@/lib/publishers";
import { launchMetaCampaign } from "@/lib/ads/meta-ads";

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
    // Flip the matching pending campaign → ACTIVE, then (for Meta) launch it as a
    // real PAUSED campaign via the Marketing API.
    const payload = approval.payload as { name?: string };
    if (payload.name) {
      const campaign = await db.adCampaign.findFirst({
        where: { projectId: approval.projectId, name: payload.name, status: "PENDING_APPROVAL" },
      });
      if (campaign) {
        await db.adCampaign.update({
          where: { id: campaign.id },
          data: { status: "ACTIVE", startedAt: new Date() },
        });
        if (campaign.platform === "META_FACEBOOK") {
          const project = await db.project.findUnique({
            where: { id: approval.projectId },
            select: { productionUrl: true },
          });
          const r = await launchMetaCampaign(approval.project.tenantId, {
            name: campaign.name,
            budgetCents: campaign.budgetCents,
            copy: campaign.copy,
            creativeUrl: campaign.creativeUrl,
            targeting: campaign.targeting,
            linkUrl: project?.productionUrl ?? undefined,
          });
          if (r.ok && r.campaignId) {
            await db.adCampaign.update({
              where: { id: campaign.id },
              data: { externalCampaignId: r.campaignId },
            });
          } else {
            // Launch failed — don't leave it looking live.
            await db.adCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
            await db.auditLog.create({
              data: {
                tenantId: approval.project.tenantId,
                projectId: approval.projectId,
                actor: "USER",
                action: "ads.launch_failed",
                reasoning: r.error ?? "Meta campaign launch failed.",
                metadata: { campaignId: campaign.id },
              },
            });
          }
        }
      }
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
