// A free-first AI router in front of kurd.gg: 9Router (or any OpenAI-compatible gateway) set up by the owner on his own
// free accounts. completeJson tries it FIRST for the calls that carry no private data, and when it is out of quota, down,
// slow or answers badly, the call goes on to kurd.gg exactly as before. Nothing here ever throws past completeJson.
//
//   ROUTER_BASE_URL   the gateway's /v1 address (https, reachable from Vercel)
//   ROUTER_API_KEY    the gateway's own key
//   ROUTER_MODEL      the model or combo name configured in the gateway
//   ROUTER_SCOPE      light (default: classifying, filtering, picking, picture scenes)
//                     draft (also the news drafts and video scripts: public headlines, Sorani quality matters)
//   ROUTER_ENABLED=0  switches it off without removing the keys
//
// What may go through it is the caller's choice (`free` on the call) and only ever PUBLIC news content: a buyer's
// message, a voice note or an order never carries `free`, because a free gateway can keep what it is sent.
import { describeEmpty, extractJson, finishReason, MIN_MAX_TOKENS, partsText, replyUsage, sseContent } from "./kurdgg";
import { estimateTokens } from "./models";
import type { JsonCall, JsonResult } from "./provider";

export type FreeLevel = "light" | "draft";

export function routerConfigured(): boolean {
  return (
    !!process.env.ROUTER_BASE_URL?.trim() &&
    !!process.env.ROUTER_API_KEY?.trim() &&
    !!process.env.ROUTER_MODEL?.trim() &&
    process.env.ROUTER_ENABLED?.trim() !== "0"
  );
}

/** How far the router is trusted: "light" tasks only, or the drafts and scripts as well. */
export function routerScope(): FreeLevel {
  return process.env.ROUTER_SCOPE?.trim() === "draft" ? "draft" : "light";
}

/** Whether this call may go to the router now. */
export function routerAllows(call: JsonCall, now = Date.now()): boolean {
  if (!call.free || !routerConfigured()) return false;
  // Opus was asked for because the work is worth it, and a picture needs a model that can see.
  if (call.tier === "opus" || call.images?.length) return false;
  if (call.free === "draft" && routerScope() !== "draft") return false;
  return now >= coolUntil;
}

// When the router fails the way a used-up quota does, it is left alone for a while: every call would otherwise wait for
// the same refusal before reaching kurd.gg. Per server instance; that is enough, the cost of a wrong guess is one call.
let coolUntil = 0;
const QUOTA_COOL_MS = 10 * 60_000;
const FAULT_COOL_MS = 2 * 60_000;

/** The router answered with something unusable or refused: note it so the next calls skip it for a while. */
export function noteRouterFailure(e: unknown, now = Date.now()): void {
  const m = e instanceof Error ? /^HTTP (\d{3})/.exec(e.message) : null;
  const status = m ? Number(m[1]) : 0;
  if (status === 429 || status === 402 || status === 403) coolUntil = now + QUOTA_COOL_MS;
  else if (status >= 500 || status === 0) coolUntil = now + FAULT_COOL_MS;
  // a 4xx for this one request (a bad shape) leaves the router in use
}

/** For tests and the health check. */
export function resetRouterCooling(): void {
  coolUntil = 0;
}

export class RouterReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterReplyError";
  }
}

/** One JSON completion through the router; the same call shape as kurdggJson. */
export async function routerJson(call: JsonCall, timeoutMs: number): Promise<JsonResult> {
  const base = process.env.ROUTER_BASE_URL!.trim().replace(/\/$/, "");
  const model = process.env.ROUTER_MODEL!.trim();
  const systemText = `${call.system}\n\nReply with one JSON object only.`;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ROUTER_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.3,
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
  if (!content.trim()) {
    console.error("[router] empty reply:", model, describeEmpty(raw));
    throw new RouterReplyError("empty reply");
  }
  let data: unknown;
  try {
    data = extractJson(content);
  } catch {
    throw new RouterReplyError(finishReason(raw) === "length" ? "the reply ran into the cap" : "the reply was not JSON");
  }
  const stated = replyUsage(raw);
  const usage = stated ?? { in: estimateTokens(systemText + call.user), out: estimateTokens(content) };
  return { data, model: `router/${replyModel ?? model}`, usage };
}
