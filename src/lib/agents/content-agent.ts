import { db } from "@/lib/db";
import { getGemini } from "@/lib/gemini";
import { assertAiBudget, recordAiCall } from "@/lib/ai-budget";
import type { MarketingPlan } from "@/lib/marketing-plan";
import { Type, type Schema } from "@google/genai";

// ---------------------------------------------------------------------------
//  Content Agent
// ---------------------------------------------------------------------------
//
//  Picks the next un-consumed content item from the active MarketingPlan and
//  produces a real ContentPost via Gemini. Respects requireApproval — if true
//  it leaves the ContentPost in PENDING_APPROVAL; otherwise SCHEDULED.

export interface PlanProgress {
  consumed: number;
  total: number;
  remaining: number;
  nextItem: { day: number; hook: string } | null;
}

export async function getPlanProgress(projectId: string): Promise<PlanProgress | null> {
  const latest = await db.marketingPlan.findFirst({
    where: { projectId, status: { in: ["DRAFT", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!latest) return null;

  const plan = latest.data as unknown as MarketingPlan;
  const items = plan.contentItems ?? [];
  const total = items.length;

  const consumed = await db.auditLog.count({
    where: {
      projectId,
      action: { startsWith: "content.auto_" },
    },
  });

  const next = items[consumed] ?? null;

  return {
    consumed: Math.min(consumed, total),
    total,
    remaining: Math.max(total - consumed, 0),
    nextItem: next ? { day: next.day, hook: next.hook } : null,
  };
}

const generatedPostSchema: Schema = {
  type: Type.OBJECT,
  required: ["description", "hashtags", "sourceAssetDescription"],
  properties: {
    description: {
      type: Type.STRING,
      description: "Final ready-to-publish post text (the caption / body / thread).",
    },
    hashtags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Optimized hashtag list (no leading #).",
    },
    sourceAssetDescription: {
      type: Type.STRING,
      description: "Description of the IMAGE the user should upload to accompany this post. Specific enough that an image-gen model could draw it.",
    },
  },
};

interface GeneratedPost {
  description: string;
  hashtags: string[];
  sourceAssetDescription: string;
}

const ACTIVE_PLATFORMS = new Set([
  "META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE",
  "X_TWITTER", "LINKEDIN", "REDDIT",
]);

function normalizePlatform(raw: string): string | null {
  const upper = raw.toUpperCase().replace(/[^A-Z_]/g, "_");
  if (ACTIVE_PLATFORMS.has(upper)) return upper;
  if (upper.includes("TWITTER") || upper === "X") return "X_TWITTER";
  if (upper.includes("INSTAGRAM") || upper === "IG") return "META_INSTAGRAM";
  if (upper.includes("FACEBOOK") || upper === "FB") return "META_FACEBOOK";
  if (upper.includes("REDDIT")) return "REDDIT";
  if (upper.includes("LINKEDIN")) return "LINKEDIN";
  if (upper.includes("TIKTOK")) return "TIKTOK";
  if (upper.includes("YOUTUBE") || upper === "YT") return "YOUTUBE";
  return null;
}

export async function runContentAgent(projectId: string): Promise<
  | { skipped: true; reason: string }
  | { skipped: false; contentPostId: string; nextItemDay: number; nextItemHook: string }
> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { mode: true, personality: true, tenant: { select: { id: true } } },
  });
  if (!project) return { skipped: true, reason: "Project not found" };
  if (!project.mode || project.mode.masterMode !== "AUTO") {
    return { skipped: true, reason: "Project not in AUTO mode" };
  }
  if (project.mode.contentMode !== "AUTO") {
    return { skipped: true, reason: "Content agent disabled" };
  }
  if (!project.personality) {
    return { skipped: true, reason: "Personality required" };
  }

  const planRow = await db.marketingPlan.findFirst({
    where: { projectId, status: { in: ["DRAFT", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!planRow) return { skipped: true, reason: "No active plan" };

  const plan = planRow.data as unknown as MarketingPlan;
  const consumed = await db.auditLog.count({
    where: { projectId, action: { startsWith: "content.auto_" } },
  });
  const nextItem = plan.contentItems?.[consumed];
  if (!nextItem) return { skipped: true, reason: "Plan exhausted" };

  await assertAiBudget(project.tenant.id);

  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: [
      {
        role: "user",
        parts: [{
          text: `Produce a ready-to-publish post for ${project.name}.

Plan item (day ${nextItem.day}, platform ${nextItem.platform}, format ${nextItem.format}):
Hook: ${nextItem.hook}
Brief: ${nextItem.brief}
CTA: ${nextItem.cta}
Suggested hashtags: ${nextItem.hashtags.join(", ") || "(none)"}

Use the brand voice from the Project Personality:
${JSON.stringify(project.personality.data, null, 2).slice(0, 4000)}`,
        }],
      },
    ],
    config: {
      systemInstruction: `You are the Content Agent for Gituas. You take a marketing-plan item and write the final post that the user can publish today.

Output strict JSON. No prose. The description must be a complete post that includes the hook AND fulfills the brief AND ends naturally with the CTA. The sourceAssetDescription describes the IMAGE that should accompany this post.`,
      responseMimeType: "application/json",
      responseSchema: generatedPostSchema,
      maxOutputTokens: 4000,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini returned empty content");
  const generated = JSON.parse(raw) as GeneratedPost;

  const usage = response.usageMetadata;
  await recordAiCall(project.tenant.id, {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  });

  const platform = normalizePlatform(nextItem.platform) ?? "REDDIT";
  const willApprove = project.mode.requireApproval;

  // Use a 1x1 placeholder PNG as the source asset (the Vault/Sharp pipeline
  // would normally provide a real generated image).
  const placeholderAssetUrl =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAwIiBoZWlnaHQ9IjEwMDAiPjxyZWN0IGZpbGw9IiNlZWUiIHdpZHRoPSIxMDAwIiBoZWlnaHQ9IjEwMDAiLz48L3N2Zz4=";

  const post = await db.contentPost.create({
    data: {
      projectId,
      sourceAssetUrl: placeholderAssetUrl,
      sourceAssetType: "IMAGE",
      description: generated.description,
      hashtags: generated.hashtags,
      status: willApprove ? "PENDING_APPROVAL" : "SCHEDULED",
      platformPosts: {
        create: [{
          platform: platform as "X_TWITTER" | "LINKEDIN" | "REDDIT" | "META_INSTAGRAM" | "META_FACEBOOK" | "TIKTOK" | "YOUTUBE",
          status: willApprove ? "PENDING_APPROVAL" : "SCHEDULED",
        }],
      },
    },
  });

  if (willApprove) {
    await db.approvalRequest.create({
      data: {
        projectId,
        kind: "CONTENT_POST",
        status: "PENDING",
        payload: {
          contentPostId: post.id,
          platform,
          preview: generated.description.slice(0, 200),
        },
      },
    });
  }

  await db.auditLog.create({
    data: {
      tenantId: project.tenant.id,
      projectId,
      actor: "AI_GEMINI",
      initiatedAs: "AUTO",
      action: willApprove ? "content.auto_drafted" : "content.auto_scheduled",
      reasoning: `Produced day-${nextItem.day} content item (${nextItem.platform}/${nextItem.format}) — "${nextItem.hook.slice(0, 80)}…"`,
      metadata: {
        contentPostId: post.id,
        planRowId: planRow.id,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
    },
  });

  return {
    skipped: false,
    contentPostId: post.id,
    nextItemDay: nextItem.day,
    nextItemHook: nextItem.hook,
  };
}
