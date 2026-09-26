// One call shape for JSON completions. DeepSeek first (one retry), Gemini as
// the fallback, so a DeepSeek outage never stops the desk. Every attempt is
// budgeted against one overall deadline, so a slow DeepSeek can never eat the
// time Gemini would have needed inside Vercel's 60 s.
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

export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailable";
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Per-strength DeepSeek timeout, before it gets clamped to what the deadline allows. */
const TIMEOUT: Record<Strength, number> = { fast: 20_000, strong: 38_000 };
const DEADLINE_MS = 50_000;

interface DeepseekAttempt<T> {
  ok: boolean;
  result?: { data: T; model: string };
  timedOut: boolean;
}

export async function completeJson<T = unknown>(
  call: JsonCall,
  validate: (data: unknown) => T | null = (d) => d as T,
): Promise<{ data: T; model: string }> {
  const start = Date.now();
  const remaining = () => DEADLINE_MS - (Date.now() - start);
  const errors: string[] = [];

  // One DeepSeek attempt. A reply that parses but fails validation is a
  // failure too, but never counts as a timeout (so it's still retried).
  const attemptDeepseek = async (timeoutMs: number): Promise<DeepseekAttempt<T>> => {
    try {
      const result = await deepseekJson(call, timeoutMs);
      const data = validate(result.data);
      if (data === null) {
        errors.push("deepseek: the reply did not have the shape we need");
        return { ok: false, timedOut: false };
      }
      return { ok: true, result: { data, model: result.model }, timedOut: false };
    } catch (e) {
      errors.push(`deepseek: ${message(e)}`);
      return { ok: false, timedOut: isTimeout(e) };
    }
  };

  if (deepseekConfigured()) {
    const t1 = Math.min(TIMEOUT[call.strength], remaining() - 8000);
    if (t1 >= 5000) {
      const first = await attemptDeepseek(t1);
      if (first.ok) return first.result!;
      if (!first.timedOut && remaining() >= TIMEOUT[call.strength] + 8000) {
        const second = await attemptDeepseek(TIMEOUT[call.strength]);
        if (second.ok) return second.result!;
      }
    }
  }

  if (isGeminiConfigured()) {
    const t2 = remaining() - 1000;
    if (t2 >= 5000) {
      try {
        const result = await geminiJson(call, t2);
        const data = validate(result.data);
        if (data === null) {
          errors.push("gemini: the reply did not have the shape we need");
        } else {
          return { data, model: result.model };
        }
      } catch (e) {
        errors.push(`gemini: ${message(e)}`);
      }
    }
  }

  throw new AiUnavailable(errors.join("; ") || "no AI provider is configured");
}
