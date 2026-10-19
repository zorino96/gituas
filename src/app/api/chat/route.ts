import { errorText } from "@/lib/chat/text";
import { actorFromSession } from "@/lib/chat/session";
import { executeChatRequest } from "@/lib/chat/turn";
import type { ChatErrorCode, ChatEvent } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A turn is bounded by the loop's own deadline (50 s); the route gets the platform's full minute.
export const maxDuration = 60;

const HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" };
const enc = new TextEncoder();
const line = (e: ChatEvent) => enc.encode(`${JSON.stringify(e)}\n`);

/**
 * One chat turn, streamed as newline-delimited JSON (a ChatEvent per line). Every outcome, errors included, is such a line with a
 * 200 status, so the screen has one thing to read. The person, the workspace and the role come from the session only.
 */
export async function POST(req: Request): Promise<Response> {
  const who = await actorFromSession();
  const once = (code: ChatErrorCode, lang = who.ok ? who.actor.lang : who.lang) => new Response(line({ t: "error", code, message: errorText(code, lang) }), { headers: HEADERS });
  if (!who.ok) return once(who.code, who.lang);
  // A JSON body only: a cross-site form post cannot send one.
  if (!req.headers.get("content-type")?.includes("application/json")) return once("badrequest");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return once("badrequest");
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the person's screen goes away the turn still finishes and is saved: only the sending stops.
      const emit = (e: ChatEvent) => {
        try {
          controller.enqueue(line(e));
        } catch {
          /* the reader is gone */
        }
      };
      try {
        await executeChatRequest(who.actor, body, emit);
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: HEADERS });
}
