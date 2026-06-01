import { z } from "zod";
import { Type, type Schema } from "@google/genai";

import { getGemini } from "./gemini";
import { fetchRepoSnapshot, formatRepoSnapshot, type RepoSnapshot } from "./repo-content";
import { assertAiBudget, recordAiCall } from "./ai-budget";
import { db } from "./db";

// ---------------------------------------------------------------------------
//  Schema — the Project Personality File
// ---------------------------------------------------------------------------
//
// We keep the Zod schema as the source of truth for TypeScript types, then
// hand-write the equivalent Gemini schema (OpenAPI-flavor) for the API call.
// Same pattern as marketing-plan.ts.

export const ProjectPersonalitySchema = z.object({
  productName: z
    .string()
    .describe("The product's name as users would see it (not the GitHub repo name)"),

  elevatorPitch: z
    .string()
    .describe("One-sentence description of what the product does and who it's for"),

  category: z
    .enum([
      "SAAS_B2B",
      "SAAS_B2C",
      "DEVELOPER_TOOL",
      "AI_PRODUCT",
      "MOBILE_APP",
      "MARKETPLACE",
      "CONTENT_SITE",
      "GAME",
      "OPEN_SOURCE_LIBRARY",
      "EDUCATIONAL",
      "OTHER",
    ])
    .describe("Best-fit product category"),

  audience: z.object({
    primary: z.string().describe("The single most important user type"),
    personas: z
      .array(z.string())
      .describe("3-5 specific personas"),
  }),

  valueProposition: z
    .string()
    .describe("Why someone would pay for or adopt this product — the core promise"),

  pricing: z.object({
    model: z.enum([
      "FREE",
      "FREEMIUM",
      "SUBSCRIPTION",
      "ONE_TIME",
      "USAGE_BASED",
      "OPEN_SOURCE",
      "UNKNOWN",
    ]),
    detectedTiers: z
      .array(
        z.object({
          name: z.string(),
          monthlyPriceUsd: z.number().nullable(),
          highlights: z.array(z.string()),
        }),
      ),
  }),

  techStack: z.array(z.string()),

  toneOfVoice: z.enum(["PLAYFUL", "PROFESSIONAL", "TECHNICAL", "WARM", "BOLD", "MINIMALIST"]),

  brandColors: z.array(z.string()),

  competitors: z.array(z.string()),

  uniqueAngle: z.string(),

  bestMarketingChannels: z.array(
    z.enum([
      "TIKTOK",
      "INSTAGRAM",
      "YOUTUBE",
      "X_TWITTER",
      "LINKEDIN",
      "REDDIT",
      "PRODUCT_HUNT",
      "HACKER_NEWS",
      "SEO_BLOG",
    ]),
  ),

  contentIdeas: z.array(z.string()),

  riskFlags: z.array(z.string()),
});

export type ProjectPersonality = z.infer<typeof ProjectPersonalitySchema>;

// ---------------------------------------------------------------------------
//  Gemini schema (OpenAPI-flavor, mirrors the Zod above)
// ---------------------------------------------------------------------------

const CATEGORY_VALUES = [
  "SAAS_B2B", "SAAS_B2C", "DEVELOPER_TOOL", "AI_PRODUCT", "MOBILE_APP",
  "MARKETPLACE", "CONTENT_SITE", "GAME", "OPEN_SOURCE_LIBRARY", "EDUCATIONAL", "OTHER",
];
const PRICING_MODEL_VALUES = [
  "FREE", "FREEMIUM", "SUBSCRIPTION", "ONE_TIME", "USAGE_BASED", "OPEN_SOURCE", "UNKNOWN",
];
const TONE_VALUES = ["PLAYFUL", "PROFESSIONAL", "TECHNICAL", "WARM", "BOLD", "MINIMALIST"];
const CHANNEL_VALUES = [
  "TIKTOK", "INSTAGRAM", "YOUTUBE", "X_TWITTER", "LINKEDIN",
  "REDDIT", "PRODUCT_HUNT", "HACKER_NEWS", "SEO_BLOG",
];

const personalityResponseSchema: Schema = {
  type: Type.OBJECT,
  required: [
    "productName", "elevatorPitch", "category", "audience", "valueProposition",
    "pricing", "techStack", "toneOfVoice", "brandColors", "competitors",
    "uniqueAngle", "bestMarketingChannels", "contentIdeas", "riskFlags",
  ],
  properties: {
    productName: { type: Type.STRING, description: "The product's name as users would see it" },
    elevatorPitch: { type: Type.STRING, description: "One sentence: what it does and who it's for" },
    category: { type: Type.STRING, enum: CATEGORY_VALUES },
    audience: {
      type: Type.OBJECT,
      required: ["primary", "personas"],
      properties: {
        primary: { type: Type.STRING },
        personas: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
    valueProposition: { type: Type.STRING },
    pricing: {
      type: Type.OBJECT,
      required: ["model", "detectedTiers"],
      properties: {
        model: { type: Type.STRING, enum: PRICING_MODEL_VALUES },
        detectedTiers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["name", "monthlyPriceUsd", "highlights"],
            properties: {
              name: { type: Type.STRING },
              monthlyPriceUsd: { type: Type.NUMBER, nullable: true },
              highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
          },
        },
      },
    },
    techStack: { type: Type.ARRAY, items: { type: Type.STRING } },
    toneOfVoice: { type: Type.STRING, enum: TONE_VALUES },
    brandColors: { type: Type.ARRAY, items: { type: Type.STRING } },
    competitors: { type: Type.ARRAY, items: { type: Type.STRING } },
    uniqueAngle: { type: Type.STRING },
    bestMarketingChannels: { type: Type.ARRAY, items: { type: Type.STRING, enum: CHANNEL_VALUES } },
    contentIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
    riskFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

// ---------------------------------------------------------------------------
//  Prompt
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You are the Project Personality Analyzer for Gituas, a multi-tenant autonomous SaaS orchestrator.

Your job: read the contents of a GitHub repository and produce a structured "Project Personality File" — a JSON document that downstream Gituas agents (ad generation, content production, reply automation) will use to make every decision about how to market this product.

Approach:

1. Read the entire repo snapshot carefully. The README is the strongest signal for product positioning and audience. The package.json or equivalent reveals the tech stack. Any landing-page file ('app/page.tsx', 'pages/index.tsx', 'index.html') reveals tone and brand colors.

2. Be specific, not generic. "Developers" is a useless audience description. "Solo founders shipping micro-SaaS who can't justify a marketing hire" is useful.

3. Detect, do not invent. If the repo has no pricing information, set pricing.model to UNKNOWN and detectedTiers to []. Do NOT fabricate prices.

4. Surface honest concerns in riskFlags. If the README is empty or the product feels like a clone, say so. Downstream agents will adjust strategy based on this.

5. Pick marketing channels based on the actual product, not generic SaaS advice. A B2B developer tool belongs on Hacker News and LinkedIn, not TikTok. A consumer creativity app belongs on TikTok and Instagram, not LinkedIn.

6. Brand colors must be real hex codes from the codebase (Tailwind config, CSS variables, theme files). If none are detectable, return an empty array — do not guess.

7. Content ideas should be concrete hooks or post titles, not vague topics. Bad: "Tutorial about the API". Good: "I built a 5-line replacement for Auth0 — here's why it took 3 weeks".

Output a single JSON object matching the schema. No prose before or after.`;

// ---------------------------------------------------------------------------
//  Generation
// ---------------------------------------------------------------------------

export interface GenerationResult {
  personality: ProjectPersonality;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
}

export async function generateProjectPersonality(
  userId: string,
  owner: string,
  repo: string,
): Promise<GenerationResult> {
  const tenant = await db.tenant.findFirst({
    where: { ownerId: userId },
    select: { id: true },
  });
  if (tenant) await assertAiBudget(tenant.id);

  const snapshot = await fetchRepoSnapshot(userId, owner, repo);
  if (!snapshot) {
    throw new Error("Could not access this repo — GitHub access may have expired");
  }
  if (snapshot.files.length === 0) {
    throw new Error("Repo has no readable content — empty, private, or no README/source files");
  }

  const repoContext = formatRepoSnapshot(snapshot);
  const ai = getGemini();

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: [
      {
        role: "user",
        parts: [{ text: `Analyze this repository and produce its Project Personality File:\n\n${repoContext}` }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: personalityResponseSchema,
      maxOutputTokens: 16_000,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini returned an empty response");

  let personality: ProjectPersonality;
  try {
    personality = JSON.parse(raw) as ProjectPersonality;
  } catch {
    throw new Error("Gemini returned a response that was not valid JSON");
  }

  const usage = response.usageMetadata;
  if (tenant) {
    await recordAiCall(tenant.id, {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    });
  }

  return {
    personality,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  };
}

// Re-export for the action layer
export type { RepoSnapshot };
