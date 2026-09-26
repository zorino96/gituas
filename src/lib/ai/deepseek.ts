import type { JsonCall, JsonResult } from "./provider";

const ENDPOINT = "https://api.deepseek.com/chat/completions";

// Explicit names: "deepseek-chat" is no longer listed in DeepSeek's docs.
export const DEEPSEEK_MODELS = { fast: "deepseek-flash", strong: "deepseek-v4-pro" } as const;

export function deepseekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export async function deepseekJson({ system, user, strength }: JsonCall): Promise<JsonResult> {
  const model = DEEPSEEK_MODELS[strength];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    // The strong model reasons first (~8 s); both stay inside Vercel's 60 s.
    signal: AbortSignal.timeout(strength === "strong" ? 50_000 : 25_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(body?.error ?? body ?? "").slice(0, 200)}`);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("empty reply");
  return { data: JSON.parse(content), model: body.model ?? model };
}
