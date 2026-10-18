// DeepSeek: the stand-by for kurd.gg. completeJson (./provider.ts) goes to it only AFTER kurd.gg has failed (down, busy,
// slow, a reply that does not fit), so a shop's assistant and replies and the newsroom keep answering through an outage.
//   DEEPSEEK_API_KEY      required for the stand-by to exist
//   AI_FALLBACK_ENABLED=0 switches the stand-by off without removing the key
//   DEEPSEEK_MODEL        the fast model (default deepseek-flash); DEEPSEEK_MODEL_PRO the careful one (default deepseek-v4-pro)
// It never sees a call that carries pictures (it cannot see) and is never used to get around a workspace's allowance:
// a call refused for the allowance is refused here too (the check happens before any provider is tried).
import { extractJson, MIN_MAX_TOKENS } from "./kurdgg";
import { estimateTokens } from "./models";
import type { JsonCall, JsonResult } from "./provider";

const ENDPOINT = "https://api.deepseek.com/chat/completions";

const FAST_MODEL = "deepseek-flash";
const PRO_MODEL = "deepseek-v4-pro";

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY?.trim() && process.env.AI_FALLBACK_ENABLED?.trim() !== "0";
}

/** A reply that arrived (and was billed) but could not be used: it carries the tokens it cost so the allowance can count them. */
export class DeepseekReplyError extends Error {
  constructor(
    message: string,
    public readonly usage: { in: number; out: number },
    /** The answer ran into max_tokens: the same cap would cut it again. */
    public readonly truncated = false,
  ) {
    super(message);
    this.name = "DeepseekReplyError";
  }
}

/** Whether this call may go to the stand-by: it must be configured, and DeepSeek cannot look at pictures. */
export function deepseekAllows(call: JsonCall): boolean {
  return deepseekConfigured() && !call.images?.length;
}

/** The model for a call: the careful one when the call was worth Opus, the fast one otherwise. */
export function deepseekModel(careful: boolean): string {
  return (careful ? process.env.DEEPSEEK_MODEL_PRO?.trim() || PRO_MODEL : process.env.DEEPSEEK_MODEL?.trim() || FAST_MODEL);
}

/** timeoutMs is the caller's to choose: completeJson budgets it against the overall deadline. */
export async function deepseekJson(call: JsonCall, timeoutMs: number, careful = false): Promise<JsonResult> {
  const { system, user, maxTokens } = call;
  const model = deepseekModel(careful);
  const systemText = `${system}\n\nReply with one JSON object only.`;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
      // The careful model thinks first and the thinking counts against the cap, so it gets room; the fast one answers straight away.
      max_tokens: Math.max(maxTokens ?? 2000, careful ? 8000 : MIN_MAX_TOKENS),
      ...(careful ? {} : { thinking: { type: "disabled" } }),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  let body: { model?: string; choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { type?: string; code?: string } } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // not JSON: handled below by status
  }
  if (!res.ok) {
    // Never echo the provider's free-text message: it can quote back part of the request, including the key.
    const code = body?.error?.type ?? body?.error?.code ?? "unknown";
    throw new Error(`HTTP ${res.status} ${code}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  const stated = body?.usage;
  const text = typeof content === "string" ? content : "";
  const usage =
    typeof stated?.prompt_tokens === "number" && typeof stated?.completion_tokens === "number"
      ? { in: stated.prompt_tokens, out: stated.completion_tokens }
      : { in: estimateTokens(systemText + user), out: estimateTokens(text) };
  const cut = body?.choices?.[0]?.finish_reason === "length";
  if (!text.trim()) throw new DeepseekReplyError("empty reply", usage, cut);
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    // The parser's own message quotes the reply: only the fact is kept.
    throw new DeepseekReplyError("the reply was not JSON", usage, cut);
  }
  return { data, model: body?.model ?? model, usage };
}
