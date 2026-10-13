// kurd.gg (Pawan.Krd): an OpenAI-compatible chat API, and the only AI text provider Gituas uses.
//   KURDGG_API_KEY        required (set in Vercel)
//   KURDGG_BASE_URL       default https://api.kurd.gg/v1
//   KURDGG_MODEL          the Haiku model id (default cc/claude-haiku-5-5)
//   KURDGG_MODEL_OPUS     the Opus model id (default cc/claude-opus-5-5), used only by plans that include it
import { estimateTokens, modelFor, type AiTier } from "./models";
import type { JsonCall, JsonResult } from "./provider";

const DEFAULT_BASE = "https://api.kurd.gg/v1";

export function kurdggConfigured(): boolean {
  return !!process.env.KURDGG_API_KEY?.trim();
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

/** A reply's text: a string, or a list of content parts (some gateways answer that way); anything else is no text. */
export function partsText(piece: unknown): string {
  if (typeof piece === "string") return piece;
  if (!Array.isArray(piece)) return "";
  return piece
    .map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : ""))
    .join("");
}

/**
 * What shape an empty answer had, for the log: keys and kinds only, never the provider's own words
 * (they can quote the request back).
 */
export function describeEmpty(raw: string): string {
  const kinds = new Set<string>();
  const keys = new Set<string>();
  let chunks = 0;
  const look = (c: { choices?: { delta?: Record<string, unknown>; message?: Record<string, unknown>; finish_reason?: unknown }[]; error?: unknown }) => {
    chunks++;
    if (c.error !== undefined) keys.add("error");
    const ch = c.choices?.[0];
    if (!ch) return;
    if (typeof ch.finish_reason === "string") keys.add(`finish:${ch.finish_reason}`);
    for (const part of [ch.delta, ch.message]) {
      if (!part) continue;
      for (const [k, v] of Object.entries(part)) {
        keys.add(k);
        kinds.add(`${k}:${Array.isArray(v) ? "array" : v === null ? "null" : typeof v}`);
      }
    }
  };
  if (raw.trimStart().startsWith("data:")) {
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        look(JSON.parse(payload));
      } catch {
        /* not a chunk */
      }
    }
  } else {
    try {
      look(JSON.parse(raw));
    } catch {
      /* not JSON */
    }
  }
  return JSON.stringify({ bytes: raw.length, chunks, keys: [...keys].sort(), kinds: [...kinds].sort() });
}

interface Chunk {
  model?: string;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[];
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
      const chunk = JSON.parse(payload) as Chunk;
      model = chunk.model ?? model;
      content += partsText(chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content);
    } catch {
      // a keep-alive or comment line
    }
  }
  return { content, model };
}

/** The token counts a reply states (in a plain body or in the last chunk of a stream), or null. */
export function replyUsage(raw: string): { in: number; out: number } | null {
  const read = (u: Chunk["usage"]) => {
    const a = Number(u?.prompt_tokens);
    const b = Number(u?.completion_tokens);
    return Number.isFinite(a) && Number.isFinite(b) && a + b > 0 ? { in: a, out: b } : null;
  };
  if (!raw.trimStart().startsWith("data:")) {
    try {
      return read((JSON.parse(raw) as Chunk).usage);
    } catch {
      return null;
    }
  }
  let found: { in: number; out: number } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      found = read((JSON.parse(payload) as Chunk).usage) ?? found;
    } catch {
      // not a chunk
    }
  }
  return found;
}

/** A reply that arrived (and was paid for) but could not be used; says what it cost and whether it was cut short. */
export class KurdggReplyError extends Error {
  constructor(
    message: string,
    readonly usage: { in: number; out: number },
    /** The answer ran into the length cap: asking again with the same cap cuts it again. */
    readonly truncated: boolean,
  ) {
    super(message);
    this.name = "KurdggReplyError";
  }
}

/** Why the model stopped ("stop", "length", ...), from a plain body or the last chunk of a stream. */
export function finishReason(raw: string): string | null {
  const read = (c: { choices?: { finish_reason?: unknown }[] }) => (typeof c.choices?.[0]?.finish_reason === "string" ? (c.choices[0].finish_reason as string) : null);
  if (!raw.trimStart().startsWith("data:")) {
    try {
      return read(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  let found: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      found = read(JSON.parse(payload)) ?? found;
    } catch {
      // not a chunk
    }
  }
  return found;
}

/** The answer cap when the caller sets none. */
const DEFAULT_MAX_TOKENS = 2000;
/**
 * The models on this gateway think before they answer, and the thinking counts against max_tokens: with a cap of
 * 160 to 500 the whole cap went on thinking and the reply was EMPTY (finish "max_tokens"; seen on 2026-10-13 in the
 * review of an idea, and it would have hit every short call). So no call is sent with less than this. What is
 * billed is what the model actually writes, and the workspace's allowance counts that.
 */
const MIN_MAX_TOKENS = 3000;

/** "length" (OpenAI) and "max_tokens" (Anthropic) both mean the answer ran into the cap. */
const ranIntoCap = (reason: string | null) => reason === "length" || reason === "max_tokens";

/** timeoutMs is the caller's to choose: completeJson budgets it against the overall deadline. */
export async function kurdggJson(call: JsonCall, timeoutMs: number, tier: AiTier = "haiku"): Promise<JsonResult> {
  const { system, user, model: override, images, maxTokens } = call;
  const base = (process.env.KURDGG_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, "");
  const model = override?.trim() || modelFor(tier);
  const systemText = `${system}\n\nReply with one JSON object only.`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KURDGG_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
      max_tokens: Math.max(maxTokens ?? DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemText },
        {
          role: "user",
          content: images?.length
            ? [{ type: "text", text: user }, ...images.slice(0, 6).map((url) => ({ type: "image_url", image_url: { url } }))]
            : user,
        },
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
    content = partsText(body?.choices?.[0]?.message?.content);
    replyModel = body?.model ?? null;
  }
  // The provider's own count when it gives one; else an estimate that leans high (a picture is about 800 tokens).
  const stated = replyUsage(raw);
  if (!content.trim()) {
    console.error("[kurdgg] empty reply:", model, describeEmpty(raw));
    // Paid for all the same: the usage goes with the error, so the allowance counts it.
    const spent = stated ?? { in: estimateTokens(systemText + user) + (images?.length ?? 0) * 800, out: 0 };
    throw new KurdggReplyError("empty reply", spent, ranIntoCap(finishReason(raw)));
  }
  // Which figures the month's count rests on: stated by the provider, or estimated here (numbers only in the log).
  if (!stated) console.info("[kurdgg] usage not stated, estimated:", model);
  const usage = stated ?? {
    in: estimateTokens(systemText + user) + (images?.length ?? 0) * 800,
    out: estimateTokens(content),
  };
  let data: unknown;
  try {
    data = extractJson(content);
  } catch (e) {
    throw new KurdggReplyError(e instanceof Error ? e.message : "the reply was not JSON", usage, ranIntoCap(finishReason(raw)));
  }
  return { data, model: `kurdgg/${replyModel ?? model}`, usage };
}
