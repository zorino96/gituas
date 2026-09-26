// One call shape for JSON completions. DeepSeek first (one retry), Gemini as
// the fallback, so a DeepSeek outage never stops the desk.
import { isGeminiConfigured } from "@/lib/gemini";
import { deepseekConfigured, deepseekJson } from "./deepseek";
import { geminiJson } from "./gemini-json";

/** fast = deepseek-flash (default); strong = deepseek-v4-pro (the editor's "improve"). */
export type Strength = "fast" | "strong";

export interface JsonCall {
  system: string;
  user: string;
  strength: Strength;
}

export interface JsonResult {
  data: unknown;
  model: string;
}

export class AiUnavailable extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function completeJson(call: JsonCall): Promise<JsonResult> {
  const errors: string[] = [];
  if (deepseekConfigured()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await deepseekJson(call);
      } catch (e) {
        errors.push(`deepseek: ${message(e)}`);
      }
    }
  }
  if (isGeminiConfigured()) {
    try {
      return await geminiJson(call);
    } catch (e) {
      errors.push(`gemini: ${message(e)}`);
    }
  }
  throw new AiUnavailable(errors.join("; ") || "no AI provider is configured");
}
