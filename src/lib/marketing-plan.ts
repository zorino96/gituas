import { z } from "zod";
import { Type, type Schema } from "@google/genai";

import { getGemini } from "./gemini";
import { assertAiBudget, recordAiCall } from "./ai-budget";
import { db } from "./db";
import type { ProjectPersonality } from "./personality";

// ---------------------------------------------------------------------------
//  Schema — the 30-day Marketing Plan
//
//  Field names match the JSON shape already saved in Neon by the previous
//  generation (positioning, weekNumber/theme/goal, brief, adCopy, kpiTarget…).
// ---------------------------------------------------------------------------

export const MarketingPlanSchema = z.object({
  positioning: z.string().describe("One-line positioning statement"),
  strategy: z.string().describe("Multi-sentence strategy for the next 30 days"),
  earlyWins: z.array(z.string()).describe("First 2-3 concrete tasks to do this week"),

  weeklyThemes: z.array(
    z.object({
      weekNumber: z.number(),
      theme: z.string(),
      goal: z.string(),
    }),
  ),

  contentItems: z.array(
    z.object({
      day: z.number(),
      platform: z.string(),
      format: z.string(),
      hook: z.string(),
      brief: z.string(),
      hashtags: z.array(z.string()),
      cta: z.string(),
    }),
  ),

  adCampaigns: z.array(
    z.object({
      name: z.string(),
      platform: z.string(),
      objective: z.string(),
      monthlyBudgetUsd: z.number(),
      audienceTargeting: z.string(),
      adCopy: z.string(),
      creativeDirection: z.string(),
      kpiTarget: z.string(),
    }),
  ),

  kpis: z.array(z.string()),

  risks: z.array(z.string()).describe("Risk plus its mitigation, all in one sentence per item"),
});

export type MarketingPlan = z.infer<typeof MarketingPlanSchema>;

// ---------------------------------------------------------------------------
//  Gemini schema
// ---------------------------------------------------------------------------

const planResponseSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "positioning", "strategy", "earlyWins", "weeklyThemes",
    "contentItems", "adCampaigns", "kpis", "risks",
  ],
  properties: {
    positioning: { type: Type.STRING },
    strategy: { type: Type.STRING },
    earlyWins: { type: Type.ARRAY, items: { type: Type.STRING } },
    weeklyThemes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["weekNumber", "theme", "goal"],
        properties: {
          weekNumber: { type: Type.NUMBER },
          theme: { type: Type.STRING },
          goal: { type: Type.STRING },
        },
      },
    },
    contentItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["day", "platform", "format", "hook", "brief", "hashtags", "cta"],
        properties: {
          day: { type: Type.NUMBER },
          platform: { type: Type.STRING },
          format: { type: Type.STRING },
          hook: { type: Type.STRING },
          brief: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          cta: { type: Type.STRING },
        },
      },
    },
    adCampaigns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: [
          "name", "platform", "objective", "monthlyBudgetUsd",
          "audienceTargeting", "adCopy", "creativeDirection", "kpiTarget",
        ],
        properties: {
          name: { type: Type.STRING },
          platform: { type: Type.STRING },
          objective: { type: Type.STRING },
          monthlyBudgetUsd: { type: Type.NUMBER },
          audienceTargeting: { type: Type.STRING },
          adCopy: { type: Type.STRING },
          creativeDirection: { type: Type.STRING },
          kpiTarget: { type: Type.STRING },
        },
      },
    },
    kpis: { type: Type.ARRAY, items: { type: Type.STRING } },
    risks: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

// ---------------------------------------------------------------------------
//  Prompt
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You are the Marketing Strategist for Gituas, a multi-tenant autonomous SaaS orchestrator.

You receive a Project Personality File and must produce a concrete 30-day Marketing Plan that downstream agents (content-agent, ad-campaign-agent) will execute.

Output a single JSON object. No prose.

Rules:

1. positioning: one sentence — "<product>: <core promise>".

2. strategy: 3–5 sentences. What's the goal of the next 30 days, what's the bet, what's the headline outcome.

3. earlyWins: 2-3 concrete actions the user can take THIS WEEK (not 30 days).

4. weeklyThemes: exactly 4 weeks. weekNumber 1-4. Each has a distinct phase (validation → reach → conversion → retention etc.).

5. contentItems: exactly 12 items spread across the month. Each item must be SPECIFIC to this product — no generic templates. Use the personality's bestMarketingChannels — do not invent channels that weren't selected. Each item must have a real hook, brief, hashtags, and CTA the user could literally publish.

6. adCampaigns: 1–3 campaigns. monthlyBudgetUsd should reflect a realistic spend for an early-stage product ($100–$500 per campaign). audienceTargeting must be specific (subreddits, audiences, keywords). adCopy must be ready to paste into the ad manager.

7. kpis: 3–6 measurable KPIs (e.g. "Waitlist signups", "Cost Per Lead", "Reddit upvotes").

8. risks: 3–5 risks specific to this product (legal, market, execution). Each risk MUST include its mitigation in the same string — e.g. "<risk>. Mitigation: <action>."

9. Lean into the personality's riskFlags — your plan must acknowledge and mitigate them.`;

// ---------------------------------------------------------------------------
//  Generation
// ---------------------------------------------------------------------------

export interface PlanGenerationResult {
  plan: MarketingPlan;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function generateMarketingPlan(
  userId: string,
  projectId: string,
): Promise<PlanGenerationResult> {
  const project = await db.project.findFirst({
    where: { id: projectId, tenant: { ownerId: userId } },
    include: { personality: true, tenant: { select: { id: true } } },
  });
  if (!project) throw new Error("Project not found");
  if (!project.personality) throw new Error("Project Personality required first");

  const tenant = project.tenant;
  await assertAiBudget(tenant.id);

  const personality = project.personality.data as unknown as ProjectPersonality;

  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: [
      {
        role: "user",
        parts: [{
          text: `Project Personality File for "${personality.productName}":\n\n${JSON.stringify(personality, null, 2)}\n\nProduce the 30-day Marketing Plan.`,
        }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: planResponseSchema,
      maxOutputTokens: 32_000,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini returned an empty response");

  let plan: MarketingPlan;
  try {
    plan = JSON.parse(raw) as MarketingPlan;
  } catch {
    throw new Error("Gemini returned a response that was not valid JSON");
  }

  const usage = response.usageMetadata;
  await recordAiCall(tenant.id, {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  });

  return {
    plan,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}
