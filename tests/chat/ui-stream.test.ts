import { describe, expect, it } from "vitest";

import type { ChatErrorCode, ChatEvent } from "@/lib/chat/types";
import { codeFromResponse } from "@/app/app/assistant/chat-model";
import { createNdjsonParser, isChatErrorCode, readEvents, safeMessage, toChatEvent } from "@/app/app/assistant/chat-stream";

const msg = (over: Record<string, unknown> = {}) => ({
  id: "m1", seq: 2, role: "assistant", text: "hi", blocks: [], runs: [], followups: [], attachments: [], createdAt: "2026-10-19T10:00:00.000Z", ...over,
});
const line = (e: unknown) => JSON.stringify(e) + "\n";

/** A body that hands out the given chunks one by one, like the network does. */
function body(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

describe("createNdjsonParser", () => {
  it("returns one event per complete line", () => {
    const p = createNdjsonParser();
    const out = p.push(line({ t: "status", text: "Looking…" }) + line({ t: "done", remaining: { day: 3, month: 40 }, ms: 1200 }));
    expect(out).toEqual([
      { t: "status", text: "Looking…" },
      { t: "done", remaining: { day: 3, month: 40 }, ms: 1200 },
    ]);
  });

  it("keeps a line that is split across chunks until it is whole", () => {
    const p = createNdjsonParser();
    const whole = line({ t: "thread", id: "t1", title: "Orders", isNew: true });
    expect(p.push(whole.slice(0, 15))).toEqual([]);
    expect(p.push(whole.slice(15, 30))).toEqual([]);
    expect(p.push(whole.slice(30))).toEqual([{ t: "thread", id: "t1", title: "Orders", isNew: true }]);
  });

  it("splits a multi-byte character cleanly when the text is decoded chunk by chunk", async () => {
    const events: ChatEvent[] = [];
    const bytes = new TextEncoder().encode(line({ t: "status", text: "سەیری داواکارییەکان دەکەم…" }));
    // cut in the middle of a two-byte letter
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 17));
        c.enqueue(bytes.slice(17));
        c.close();
      },
    });
    await readEvents(stream, (e) => events.push(e));
    expect(events).toEqual([{ t: "status", text: "سەیری داواکارییەکان دەکەم…" }]);
  });

  it("skips a bad line, an empty line and an unknown event without losing the rest", () => {
    const p = createNdjsonParser();
    const out = p.push("not json\n\n" + line({ t: "mystery" }) + line({ t: "status", text: "ok" }) + "\r\n");
    expect(out).toEqual([{ t: "status", text: "ok" }]);
  });

  it("flush hands back a last line that had no newline", () => {
    const p = createNdjsonParser();
    expect(p.push(JSON.stringify({ t: "status", text: "tail" }))).toEqual([]);
    expect(p.flush()).toEqual([{ t: "status", text: "tail" }]);
    expect(p.flush()).toEqual([]);
  });
});

describe("toChatEvent", () => {
  it("fills a message with empty lists when the server left them out", () => {
    const e = toChatEvent({ t: "message", message: { id: "m9", seq: 5, role: "assistant", text: "x" } });
    expect(e).toMatchObject({ t: "message", message: { id: "m9", blocks: [], runs: [], attachments: [], followups: [] } });
  });

  it("turns an unknown error code into internal and keeps the contact flag", () => {
    expect(toChatEvent({ t: "error", code: "weird", message: "boom", contact: true })).toEqual({ t: "error", code: "internal", message: "boom", contact: true });
    expect(toChatEvent({ t: "error", code: "limit_day", message: "" })).toEqual({ t: "error", code: "limit_day", message: "" });
  });

  it("refuses events with no usable id", () => {
    expect(toChatEvent({ t: "thread", title: "x" })).toBeNull();
    expect(toChatEvent({ t: "message", message: { text: "no id" } })).toBeNull();
    expect(toChatEvent({ t: "run", run: { status: "DONE" } })).toBeNull();
    expect(toChatEvent(null)).toBeNull();
    expect(toChatEvent([])).toBeNull();
  });

  it("reads a run's status safely", () => {
    const e = toChatEvent({ t: "run", run: { id: "r1", tool: "post_now", risk: "public", title: "Post", lines: [{ label: "Where", value: "FB" }], status: "BOGUS", expiresAt: "x", long: false } });
    expect(e).toMatchObject({ t: "run", run: { id: "r1", status: "FAILED", lines: [{ label: "Where", value: "FB" }], tainted: false, decidedBy: null } });
  });

  it("drops attachments and blocks that are not objects", () => {
    const m = safeMessage(msg({ attachments: [null, { url: "https://x/y.jpg", id: "a1", kind: "image", name: "y", pathname: "p" }], blocks: [1, { kind: "note", text: "n" }] }));
    expect(m?.attachments).toHaveLength(1);
    expect(m?.blocks).toEqual([{ kind: "note", text: "n" }]);
  });
});

describe("readEvents", () => {
  it("delivers events in order and returns 'done' at the done event", async () => {
    const got: ChatEvent[] = [];
    const end = await readEvents(
      body([line({ t: "thread", id: "t1", title: "T", isNew: true }), line({ t: "message", message: msg() }), line({ t: "done", remaining: { day: 1, month: 2 }, ms: 5 })]),
      (e) => got.push(e),
    );
    expect(end).toBe("done");
    expect(got.map((e) => e.t)).toEqual(["thread", "message", "done"]);
  });

  it("stops at an error event and ignores whatever follows", async () => {
    const got: ChatEvent[] = [];
    const end = await readEvents(body([line({ t: "error", code: "busy", message: "" }), line({ t: "status", text: "late" })]), (e) => got.push(e));
    expect(end).toBe("error");
    expect(got).toEqual([{ t: "error", code: "busy", message: "" }]);
  });

  it("reports 'ended' when the body closes without done or error (a broken connection)", async () => {
    const got: ChatEvent[] = [];
    const end = await readEvents(body([line({ t: "status", text: "working" })]), (e) => got.push(e));
    expect(end).toBe("ended");
    expect(got).toHaveLength(1);
  });

  it("rejects with an abort when the signal fires", async () => {
    const ctrl = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start() {} }); // never sends
    const pending = readEvents(stream, () => undefined, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the error codes the parser knows", () => {
  // A Record over the union: a code added to ChatErrorCode and not here is a type error (tsc), and one not in the parser fails below.
  const ALL: Record<ChatErrorCode, true> = {
    signin: true, forbidden: true, workspace: true, badrequest: true, limit_day: true, limit_month: true, allowance: true, busy: true,
    unavailable: true, not_found: true, expired: true, frozen: true, internal: true,
  };

  it("knows every code the server can send, so none is turned into 'internal'", () => {
    for (const code of Object.keys(ALL)) {
      expect(isChatErrorCode(code), code).toBe(true);
      expect(toChatEvent({ t: "error", code, message: "x" }), code).toMatchObject({ t: "error", code });
      expect(codeFromResponse(200, { code }), code).toBe(code);
    }
  });

  it("keeps 'frozen': a desk whose trial ended is told so, not 'something went wrong'", () => {
    expect(toChatEvent({ t: "error", code: "frozen", message: "" })).toEqual({ t: "error", code: "frozen", message: "" });
    expect(codeFromResponse(200, { code: "frozen" })).toBe("frozen");
  });

  it("still turns a code it does not know into 'internal'", () => {
    expect(toChatEvent({ t: "error", code: "made_up", message: "" })).toMatchObject({ code: "internal" });
    expect(isChatErrorCode("made_up")).toBe(false);
  });
});
