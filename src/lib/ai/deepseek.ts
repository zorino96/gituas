import type { JsonCall, JsonResult } from "./provider";

const ENDPOINT = "https://api.deepseek.com/chat/completions";

// Explicit names: "deepseek-chat" was retired (announced discontinued 2026-07-24).
// Non-thinking calls (thinking === false) use the same flash model with
// `thinking: { type: "disabled" }` in the request body — for bulk, simple
// sorting, where thinking only costs time and can eat the whole reply budget.
export const DEEPSEEK_MODELS = { fast: "deepseek-flash", strong: "deepseek-v4-pro" } as const;

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

/** timeoutMs is the caller's to choose: completeJson budgets it against the overall deadline. */
export async function deepseekJson({ system, user, strength, thinking }: JsonCall, timeoutMs: number): Promise<JsonResult> {
  const model = thinking === false ? DEEPSEEK_MODELS.fast : DEEPSEEK_MODELS[strength];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      ...(thinking === false ? { thinking: { type: "disabled" } } : {}),
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Never echo the provider's free-text message: it can quote back part of the request, including the key.
    const code = body?.error?.type ?? body?.error?.code ?? "unknown";
    throw new Error(`HTTP ${res.status} ${code}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("empty reply");
  return { data: JSON.parse(content), model: body.model ?? model };
}
