import { db } from "@/lib/db";
import { getGemini } from "@/lib/gemini";
import { platformToProvider } from "@/lib/publishers";
import type { OAuthProvider, Platform } from "@/generated/prisma/client";
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

/** Every platform a plan item names, not just the first one that matched.
 *
 *  `platform` is free text the planner wrote, so it says things like
 *  "Instagram + Facebook" or "TikTok and YouTube Shorts". normalizePlatform
 *  returns on its first hit, which meant the second platform was dropped in
 *  silence: the plan promised a cross-post and one of them simply never
 *  existed. Scan for all of them instead. Order is stable so the same plan
 *  item always fans out the same way. */
function normalizePlatforms(raw: string): Platform[] {
  const upper = raw.toUpperCase();
  const found: Platform[] = [];
  const add = (p: Platform) => {
    if (!found.includes(p)) found.push(p);
  };
  if (/TWITTER|X/.test(upper)) add("X_TWITTER");
  if (upper.includes("LINKEDIN")) add("LINKEDIN");
  if (upper.includes("REDDIT")) add("REDDIT");
  if (upper.includes("INSTAGRAM") || /IG/.test(upper)) add("META_INSTAGRAM");
  if (upper.includes("FACEBOOK") || /FB/.test(upper)) add("META_FACEBOOK");
  if (upper.includes("TIKTOK")) add("TIKTOK");
  if (upper.includes("YOUTUBE") || /YT/.test(upper) || upper.includes("SHORTS")) add("YOUTUBE");

  if (found.length > 0) return found;
  const single = normalizePlatform(raw);
  return single ? [single as Platform] : [];
}

/** Does the plan item mean "put this everywhere" rather than naming places?
 *  Planners write "cross-post everywhere" and "all channels" as often as they
 *  write platform names, and neither contains one -- without this they fell
 *  through to the REDDIT default and the post went to exactly one place the
 *  plan never asked for. */
function wantsEveryPlatform(raw: string): boolean {
  return /(ALL|EVERY|EVERYWHERE|CROSS[- ]?POST|ALL CHANNELS|EACH)/i.test(raw);
}

/** Every platform this tenant currently has a live credential for. */
async function allConnected(tenantId: string): Promise<Platform[]> {
  const order: Platform[] = [
    "META_INSTAGRAM", "META_FACEBOOK", "TIKTOK", "YOUTUBE",
    "X_TWITTER", "LINKEDIN", "REDDIT",
  ];
  return await connectedAmong(tenantId, order).then((live) =>
    // connectedAmong falls back to its input when nothing is connected; here
    // that would mean "post to all seven platforms we cannot reach", so an
    // empty result is the honest answer.
    live.length === order.length ? [] : live,
  );
}

/** Which of those platforms this tenant can actually post to today.
 *
 *  Creating a PlatformPost for a platform with no credential produces a row
 *  that can only ever fail, and the owner sees a queue item that will never
 *  clear. Drop them here rather than at publish time -- but never return an
 *  empty list off the back of it, because a post that fans out to nothing is
 *  worse than one that fails loudly. */
async function connectedAmong(tenantId: string, platforms: Platform[]): Promise<Platform[]> {
  if (platforms.length === 0) return [];
  const providers = platforms
    .map((p) => ({ platform: p, provider: platformToProvider(p) }))
    .filter((x): x is { platform: Platform; provider: OAuthProvider } => x.provider !== null);

  const creds = await db.oAuthCredential.findMany({
    where: {
      tenantId,
      provider: { in: providers.map((x) => x.provider) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { provider: true },
  });
  const live = new Set(creds.map((c) => c.provider));
  const connected = providers.filter((x) => live.has(x.provider)).map((x) => x.platform);
  return connected.length > 0 ? connected : platforms;
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

  const named = normalizePlatforms(nextItem.platform);
  const platforms =
    named.length > 0
      ? await connectedAmong(project.tenant.id, named)
      : wantsEveryPlatform(nextItem.platform)
        ? await allConnected(project.tenant.id)
        : [];
  if (platforms.length === 0) {
    // Nothing to post to. Saying so beats inventing a destination: the old
    // code defaulted to REDDIT, so a plan item naming an unconnected platform
    // quietly went somewhere else entirely.
    return { skipped: true, reason: `No connected platform matches "${nextItem.platform}"` };
  }
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
      // One row per destination. TikTok is included on purpose: the publisher
      // refuses to send it automatically (the Content Sharing Guidelines
      // require the creator to set visibility themselves), so its row waits in
      // SCHEDULED for the Post to TikTok screen instead of going out unseen.
      platformPosts: {
        create: platforms.map((platform) => ({
          platform,
          status: (willApprove ? "PENDING_APPROVAL" : "SCHEDULED") as "PENDING_APPROVAL" | "SCHEDULED",
        })),
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
          // `platform` is kept alongside `platforms` so approval rows written
          // before the fan-out existed still render; new rows carry both.
          platform: platforms[0],
          platforms,
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
