// The alternative models: a gateway of the owner's own with several models behind one OpenAI-compatible address, tried one
// after the other when the main provider AND the DeepSeek stand-by have both failed (see ./provider.ts). Nothing here is
// used until it is configured; it never sees a call with pictures.
//   ALT_AI_BASE_URL   the gateway's /v1 address (https)
//   ALT_AI_API_KEY    its key (saved with gituas-private/set-alt-ai.ps1, hidden)
//   ALT_AI_MODELS     model ids, comma separated, in the order they are tried (at most four)
//   AI_FALLBACK_ENABLED=0 switches all stand-bys off (this one too)
import { describeEmpty, extractJson, finishReason, MIN_MAX_TOKENS, partsText, replyUsage, sseContent } from "./kurdgg";
import { estimateTokens } from "./models";
import type { JsonCall, JsonResult } from "./provider";

export function altConfigured(): boolean {
  return !!process.env.ALT_AI_BASE_URL?.trim() && !!process.env.ALT_AI_API_KEY?.trim() && altModels().length > 0 && process.env.AI_FALLBACK_ENABLED?.trim() !== "0";
}

/** The model ids to try, in order. */
export function altModels(): string[] {
  return (process.env.ALT_AI_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^[\w.:/@+-]{1,80}$/.test(m))
    .slice(0, 4);
}

/** Whether this call may go to the alternative models: configured, and they are not asked to look at pictures. */
export function altAllows(call: JsonCall): boolean {
  return altConfigured() && !call.images?.length;
}

export class AltReplyError extends Error {
  constructor(
    message: string,
    public readonly usage: { in: number; out: number },
    public readonly truncated = false,
  ) {
    super(message);
    this.name = "AltReplyError";
  }
}

/** One JSON completion through the gateway with one of its models. */
export async function altJson(call: JsonCall, timeoutMs: number, model: string): Promise<JsonResult> {
  const base = process.env.ALT_AI_BASE_URL!.trim().replace(/\/$/, "");
  const systemText = `${call.system}\n\nReply with one JSON object only.`;
  // No temperature or response_format: gateways differ on both, and the prompt asks for JSON (extractJson cuts it out).
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ALT_AI_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: Math.max(call.maxTokens ?? 2000, MIN_MAX_TOKENS),
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: call.user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) {
    // Never echo the gateway's free text: it can quote the request back.
    let code = "unknown";
    try {
      const b = JSON.parse(raw);
      code = b?.error?.type ?? b?.error?.code ?? code;
    } catch {
      /* not JSON */
    }
    throw new Error(`HTTP ${res.status} ${typeof code === "string" ? code.slice(0, 40) : "unknown"}`);
  }
  let content: string;
  let replyModel: string | null;
  try {
    if (raw.trimStart().startsWith("data:")) {
      ({ content, model: replyModel } = sseContent(raw));
    } else {
      const body = JSON.parse(raw) as { model?: string; choices?: { message?: { content?: unknown } }[] };
      content = partsText(body?.choices?.[0]?.message?.content);
      replyModel = body?.model ?? null;
    }
  } catch {
    throw new AltReplyError("the reply was not readable", { in: estimateTokens(systemText + call.user), out: 0 });
  }
  const stated = replyUsage(raw);
  const usage = stated ?? { in: estimateTokens(systemText + call.user), out: estimateTokens(content) };
  const cut = finishReason(raw) === "length" || finishReason(raw) === "max_tokens";
  if (!content.trim()) {
    console.error("[alt] empty reply:", model, describeEmpty(raw));
    throw new AltReplyError("empty reply", usage, cut);
  }
  let data: unknown;
  try {
    data = extractJson(content);
  } catch {
    throw new AltReplyError("the reply was not JSON", usage, cut);
  }
  return { data, model: `alt/${replyModel ?? model}`, usage };
}
