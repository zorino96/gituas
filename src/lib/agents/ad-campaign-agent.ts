import { db } from "@/lib/db";

/**
 * Realizes ad campaigns from the marketing plan. Creates draft AdCampaign rows
 * for each campaign in the active plan that doesn't already have a matching
 * record. The actual platform calls (Meta/Google/TikTok) are out of scope until
 * those OAuth credentials exist — this agent just stages the campaigns.
 */
export async function runAdCampaignAgent(projectId: string): Promise<{ staged: number; skipped: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, tenant: { select: { id: true } } },
  });
  if (!project?.mode || project.mode.masterMode !== "AUTO" || project.mode.adsMode !== "AUTO") {
    return { staged: 0, skipped: "Ads agent disabled" };
  }

  const planRow = await db.marketingPlan.findFirst({
    where: { projectId, status: { in: ["DRAFT", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!planRow) return { staged: 0, skipped: "No active plan" };

  const plan = planRow.data as { adCampaigns?: Array<{
    name: string;
    platform: string;
    monthlyBudgetUsd: number;
    adCopy: string;
    audienceTargeting?: string;
  }> };
  const campaigns = plan.adCampaigns ?? [];
  if (campaigns.length === 0) return { staged: 0, skipped: "No campaigns" };

  let staged = 0;
  for (const c of campaigns) {
    const platform = normalizePlatform(c.platform);
    if (!platform) continue;
    const exists = await db.adCampaign.findFirst({
      where: { projectId, name: c.name },
    });
    if (exists) continue;
    await db.adCampaign.create({
      data: {
        projectId,
        platform: platform as "X_TWITTER" | "LINKEDIN" | "REDDIT" | "META_INSTAGRAM" | "META_FACEBOOK" | "TIKTOK" | "YOUTUBE",
        name: c.name,
        budgetCents: Math.round(c.monthlyBudgetUsd * 100),
        copy: c.adCopy,
        targeting: c.audienceTargeting ? { description: c.audienceTargeting } : undefined,
        status: project.mode.requireApproval ? "PENDING_APPROVAL" : "DRAFT",
      },
    });
    if (project.mode.requireApproval) {
      await db.approvalRequest.create({
        data: {
          projectId,
          kind: "AD_CAMPAIGN",
          status: "PENDING",
          payload: { name: c.name, platform, budget: c.monthlyBudgetUsd },
        },
      });
    }
    staged++;
  }

  if (staged > 0) {
    await db.auditLog.create({
      data: {
        tenantId: project.tenant.id,
        projectId,
        actor: "AI_ROUTER",
        initiatedAs: "AUTO",
        action: "ads.auto_staged",
        reasoning: `Staged ${staged} ad campaigns from the active plan.`,
        metadata: { staged },
      },
    });
  }

  return { staged, skipped: "" };
}

function normalizePlatform(raw: string): string | null {
  const upper = raw.toUpperCase();
  if (upper.includes("META") || upper.includes("FACEBOOK")) return "META_FACEBOOK";
  if (upper.includes("INSTAGRAM") || upper === "IG") return "META_INSTAGRAM";
  if (upper.includes("TIKTOK")) return "TIKTOK";
  if (upper.includes("YOUTUBE") || upper === "YT") return "YOUTUBE";
  if (upper.includes("LINKEDIN")) return "LINKEDIN";
  if (upper.includes("REDDIT")) return "REDDIT";
  if (upper.includes("X") || upper.includes("TWITTER")) return "X_TWITTER";
  return null;
}
