// Reading the answer of POST /api/chat: newline-delimited JSON, one ChatEvent per line. Pure and browser-free, so it is tested
// in node. A line can be split across two chunks of the network, and a bad line must never end the whole turn.

import type { ChatErrorCode, ChatEvent, MessageDto, RunDto } from "@/lib/chat/types";

const CODES: readonly ChatErrorCode[] = [
  "signin", "forbidden", "workspace", "badrequest", "limit_day", "limit_month", "allowance", "busy", "unavailable", "not_found", "expired", "internal",
];
export const isChatErrorCode = (v: unknown): v is ChatErrorCode => typeof v === "string" && (CODES as readonly string[]).includes(v);

const RUN_STATUSES = ["PROPOSED", "RUNNING", "DONE", "FAILED", "CANCELLED", "EXPIRED"] as const;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A run as the screen can safely draw it: the arrays are arrays, the status is one we know. Null when it is not a run at all. */
export function safeRun(v: unknown): RunDto | null {
  if (!isObject(v) || typeof v.id !== "string" || !v.id) return null;
  const status = (RUN_STATUSES as readonly unknown[]).includes(v.status) ? (v.status as RunDto["status"]) : "FAILED";
  return {
    id: v.id,
    tool: str(v.tool),
    risk: (typeof v.risk === "string" ? v.risk : "low") as RunDto["risk"],
    title: str(v.title),
    lines: arr<{ label?: unknown; value?: unknown }>(v.lines).map((l) => ({ label: str(l?.label), value: str(l?.value) })),
    status,
    decidedBy: v.decidedBy === "CONFIRMED" || v.decidedBy === "AUTO" ? v.decidedBy : null,
    tainted: v.tainted === true,
    expiresAt: str(v.expiresAt),
    resultText: typeof v.resultText === "string" ? v.resultText : undefined,
    error: typeof v.error === "string" ? v.error : undefined,
    media: isObject(v.media) && typeof v.media.url === "string" ? (v.media as unknown as RunDto["media"]) : undefined,
    jobId: typeof v.jobId === "string" ? v.jobId : undefined,
    long: v.long === true,
  };
}

/** A message as the screen can safely draw it (the server is trusted, but a half-written line must not blank the screen). */
export function safeMessage(v: unknown): MessageDto | null {
  if (!isObject(v) || typeof v.id !== "string" || !v.id) return null;
  return {
    id: v.id,
    seq: typeof v.seq === "number" ? v.seq : 0,
    role: v.role === "user" ? "user" : "assistant",
    text: str(v.text),
    blocks: arr<MessageDto["blocks"][number]>(v.blocks).filter((b) => isObject(b) && typeof b.kind === "string"),
    runs: arr<unknown>(v.runs).map(safeRun).filter((r): r is RunDto => !!r),
    followups: arr<unknown>(v.followups).filter((s): s is string => typeof s === "string"),
    attachments: arr<MessageDto["attachments"][number]>(v.attachments).filter((a) => isObject(a) && typeof a.url === "string"),
    createdAt: str(v.createdAt),
  };
}

/** One parsed line as a ChatEvent, or null when it is not one we know. */
export function toChatEvent(v: unknown): ChatEvent | null {
  if (!isObject(v)) return null;
  switch (v.t) {
    case "thread":
      return typeof v.id === "string" && v.id ? { t: "thread", id: v.id, title: str(v.title), isNew: v.isNew === true } : null;
    case "status":
      return { t: "status", text: str(v.text) };
    case "message": {
      const message = safeMessage(v.message);
      return message ? { t: "message", message } : null;
    }
    case "run": {
      const run = safeRun(v.run);
      return run ? { t: "run", run } : null;
    }
    case "done": {
      const r = isObject(v.remaining) ? v.remaining : {};
      return { t: "done", remaining: { day: Number(r.day) || 0, month: Number(r.month) || 0 }, ms: Number(v.ms) || 0 };
    }
    case "error":
      return {
        t: "error",
        code: isChatErrorCode(v.code) ? v.code : "internal",
        message: str(v.message),
        ...(v.contact === true ? { contact: true } : {}),
      };
    default:
      return null;
  }
}

function parseLine(line: string): ChatEvent[] {
  const s = line.trim();
  if (!s) return [];
  try {
    const e = toChatEvent(JSON.parse(s));
    return e ? [e] : [];
  } catch {
    return [];
  }
}

/** Feed it text as it arrives; it hands back the complete events and keeps a half line for the next chunk. */
export function createNdjsonParser() {
  let rest = "";
  return {
    push(chunk: string): ChatEvent[] {
      rest += chunk;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      return lines.flatMap(parseLine);
    },
    /** The stream ended: a last line without a newline still counts. */
    flush(): ChatEvent[] {
      const last = rest;
      rest = "";
      return parseLine(last);
    },
  };
}

const aborted = (signal: AbortSignal) => (signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));

/**
 * Reads a response body to its end, calling `onEvent` for each event in order, and stops at "done" or "error" (a stream that
 * goes on after its last event is not waited for). Returns how it ended: "done", "error", or "ended" when the body closed
 * with neither (the connection broke). An aborted signal makes the read reject with the signal's own error.
 */
export async function readEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<"done" | "error" | "ended"> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createNdjsonParser();
  const stop = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", stop, { once: true });
  const deliver = (events: ChatEvent[]): "done" | "error" | null => {
    for (const e of events) {
      onEvent(e);
      if (e.t === "done" || e.t === "error") return e.t;
    }
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // Cancelling the reader ends a pending read quietly: an abort must not look like a connection that broke.
      if (signal?.aborted) throw aborted(signal);
      if (done) break;
      const end = deliver(parser.push(decoder.decode(value, { stream: true })));
      if (end) {
        stop();
        return end;
      }
    }
    const end = deliver([...parser.push(decoder.decode()), ...parser.flush()]);
    return end ?? "ended";
  } catch (e) {
    if (signal?.aborted) throw aborted(signal);
    throw e;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
