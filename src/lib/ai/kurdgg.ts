// kurd.gg (Pawan.Krd): an OpenAI-compatible chat API, used first for its Sorani.
//   KURDGG_API_KEY        required (set in Vercel)
//   KURDGG_BASE_URL       default https://api.kurd.gg/v1
//   KURDGG_MODEL          the model for every call (see GET /v1/models)
//   KURDGG_MODEL_STRONG   the editor's "improve"; defaults to KURDGG_MODEL
import type { JsonCall, JsonResult } from "./provider";

const DEFAULT_BASE = "https://api.kurd.gg/v1";

export function kurdggConfigured(): boolean {
  return !!process.env.KURDGG_API_KEY?.trim() && !!process.env.KURDGG_MODEL?.trim();
}

function modelFor(strength: JsonCall["strength"]): string {
  const fast = process.env.KURDGG_MODEL!.trim();
  return strength === "strong" ? process.env.KURDGG_MODEL_STRONG?.trim() || fast : fast;
}

/**
 * The JSON object in a chat reply. Models that ignore JSON mode still wrap it in a
 * ```json fence or add a sentence around it; both are cut away here.
 */
export function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const text = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("the reply was not JSON");
  }
}

/**
 * The text of a streamed reply. kurd.gg answers as server-sent events ("data: {chunk}" lines,
 * then "data: [DONE]") even when no stream was asked for; the pieces are joined here.
 */
export function sseContent(raw: string): { content: string; model: string | null } {
  let content = "";
  let model: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload) as { model?: string; choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[] };
      model = chunk.model ?? model;
      const piece = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
      if (typeof piece === "string") content += piece;
    } catch {
      // a keep-alive or comment line
    }
  }
  return { content, model };
}

/** timeoutMs is the caller's to choose: completeJson budgets it against the overall deadline. */
export async function kurdggJson({ system, user, strength }: JsonCall, timeoutMs: number): Promise<JsonResult> {
  const base = (process.env.KURDGG_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  const model = modelFor(strength);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KURDGG_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${system}\n\nReply with one JSON object only.` },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) {
    // Never echo the provider's free-text message: it can quote back part of the request, including the key.
    let code = "unknown";
    try {
      const b = JSON.parse(raw);
      code = b?.error?.type ?? b?.error?.code ?? code;
    } catch {}
    throw new Error(`HTTP ${res.status} ${code}`);
  }
  let content: string;
  let replyModel: string | null;
  if (raw.trimStart().startsWith("data:")) {
    ({ content, model: replyModel } = sseContent(raw));
  } else {
    const body = JSON.parse(raw) as { model?: string; choices?: { message?: { content?: unknown } }[] };
    const c = body?.choices?.[0]?.message?.content;
    content = typeof c === "string" ? c : "";
    replyModel = body?.model ?? null;
  }
  if (!content.trim()) throw new Error("empty reply");
  return { data: extractJson(content), model: `kurdgg/${replyModel ?? model}` };
}
