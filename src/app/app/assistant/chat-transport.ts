// How the screen talks to the two endpoints. A small interface, so the dev preview can stand in a made-up server.

import type { ChatRequest, RunDecisionRequest, RunDecisionResponse } from "@/lib/chat/types";
import { codeFromResponse } from "./chat-model";

export interface ChatTransport {
  /** POST /api/chat: the answer is a stream of newline-delimited JSON events. */
  send(req: ChatRequest, signal: AbortSignal): Promise<Response>;
  /** POST /api/chat/runs/<id>: confirm or cancel a card. */
  decide(runId: string, body: RunDecisionRequest): Promise<RunDecisionResponse>;
}

export const httpTransport: ChatTransport = {
  send: (req, signal) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(req),
      signal,
      cache: "no-store",
    }),

  async decide(runId, body) {
    const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON: the status below says what it was */
    }
    if (json && typeof json === "object" && typeof (json as { ok?: unknown }).ok === "boolean") return json as RunDecisionResponse;
    return { ok: false, code: codeFromResponse(res.status, json), message: "" };
  },
};
