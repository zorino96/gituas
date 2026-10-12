// RETIRED. The first product's Gemini features (agents, marketing plan, personality, engagement drafts) are
// gone from every screen, and no current feature calls this file: all text is Claude Haiku or Opus through
// src/lib/ai/provider.ts, which counts every call against the workspace's allowance. This stub never calls
// Google, so the old /dashboard server actions cannot spend the key even if someone reaches them directly.
// (Speech uses its own code in src/lib/voice and is unaffected.)
import type { GoogleGenAI } from "@google/genai";

export function isGeminiConfigured(): boolean {
  return false;
}

export function getGemini(): GoogleGenAI {
  throw new Error("Gemini is retired: use src/lib/ai/provider.ts");
}
