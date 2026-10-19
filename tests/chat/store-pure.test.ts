import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { buildHistory } from "@/lib/chat/history";
import {
  argsHashOf,
  attachmentsOf,
  canonicalJson,
  effectiveStatus,
  isOwnAttachment,
  messageToDto,
  nextAttachmentId,
  runToDto,
  type ChatMessage,
  type ChatRun,
} from "@/lib/chat/store";

const T = "tenant1";
const own = (id: string, extra: Record<string, unknown> = {}) => ({ id, url: `https://x.public.blob.vercel-storage.com/merchant/${T}/${id}.jpg`, pathname: `merchant/${T}/${id}.jpg`, kind: "image" as const, name: id, ...extra });

const msg = (o: Partial<ChatMessage> & { seq: number; role: string }): ChatMessage =>
  ({ id: `m${o.seq}`, threadId: "th", content: "", toolCalls: null, toolCallId: null, meta: null, tainted: false, createdAt: new Date("2026-10-19T10:00:00Z"), ...o }) as ChatMessage;

const run = (o: Partial<ChatRun> = {}): ChatRun =>
  ({
    id: "r1",
    threadId: "th",
    tenantId: T,
    userId: "u1",
    toolCallId: "c1",
    tool: "post_now",
    args: { caption: "hi" },
    argsHash: "x",
    risk: "public",
    status: "PROPOSED",
    decidedBy: null,
    autonomy: "ASK",
    tainted: false,
    card: { title: "Post now", lines: [{ label: "Caption", value: "hi" }], long: false },
    result: null,
    error: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    decidedAt: null,
    finishedAt: null,
    ...o,
  }) as ChatRun;

describe("argsHashOf", () => {
  it("is the same for the same arguments in any key order and different for different ones", () => {
    expect(argsHashOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(argsHashOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(argsHashOf({ a: 1 })).not.toBe(argsHashOf({ a: 2 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe("effectiveStatus and runToDto", () => {
  it("shows a card nobody confirmed in time as expired", () => {
    expect(effectiveStatus(run({ expiresAt: new Date(Date.now() - 1) }))).toBe("EXPIRED");
    expect(effectiveStatus(run())).toBe("PROPOSED");
    expect(effectiveStatus(run({ status: "DONE", expiresAt: new Date(Date.now() - 1) }))).toBe("DONE");
  });

  it("builds what the screen needs from the run", () => {
    const dto = runToDto(run({ status: "DONE", decidedBy: "AUTO", result: { text: "Posted.", jobId: "j1", media: { url: "u", pathname: "p", kind: "video", name: "n" } } }));
    expect(dto).toMatchObject({ id: "r1", tool: "post_now", risk: "public", title: "Post now", status: "DONE", decidedBy: "AUTO", resultText: "Posted.", jobId: "j1", long: false });
    expect(dto.lines).toEqual([{ label: "Caption", value: "hi" }]);
    expect(dto.media).toEqual({ url: "u", pathname: "p", kind: "video", name: "n" });
  });
});

describe("messageToDto", () => {
  it("hides tool messages and attaches blocks and runs to an assistant message", () => {
    expect(messageToDto(msg({ seq: 1, role: "tool" }), new Map())).toBeNull();
    const m = msg({ seq: 2, role: "assistant", content: "Here", meta: { blocks: [{ kind: "note", text: "n" }], runIds: ["r1", "gone"] } });
    const dto = messageToDto(m, new Map([["r1", run()]]))!;
    expect(dto.blocks).toHaveLength(1);
    expect(dto.runs.map((r) => r.id)).toEqual(["r1"]);
    expect(dto.followups).toEqual([]);
  });

  it("carries the files of a user message", () => {
    const dto = messageToDto(msg({ seq: 1, role: "user", content: "see", meta: { attachments: [own("a1")] } }), new Map())!;
    expect(dto.attachments).toHaveLength(1);
  });
});

describe("attachments", () => {
  it("accepts only the workspace's own uploads", () => {
    expect(isOwnAttachment(own("a1"), T)).toBe(true);
    expect(isOwnAttachment(own("a1", { url: "https://evil.example/a.jpg" }), T)).toBe(false);
    expect(isOwnAttachment(own("a1", { pathname: "merchant/other/a.jpg" }), T)).toBe(false);
    expect(isOwnAttachment(own("a1", { pathname: `merchant/${T}/../x.jpg` }), T)).toBe(false);
    expect(isOwnAttachment(own("x1"), T)).toBe(false);
  });

  it("collects the person's files and the pictures finished runs made, with stable ids", () => {
    const rows = [msg({ seq: 1, role: "user", meta: { attachments: [own("a1")] } }), msg({ seq: 2, role: "assistant" })];
    const made = run({ status: "DONE", result: { attachmentId: "a2", media: { url: own("a2").url, pathname: own("a2").pathname, kind: "image", name: "pic" } } });
    const notDone = run({ id: "r2", status: "PROPOSED", result: null });
    expect(attachmentsOf(rows, [made, notDone], T).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("gives a made picture the next free id when its saved id was taken meanwhile", () => {
    const rows = [msg({ seq: 1, role: "user", meta: { attachments: [own("a1"), own("a2")] } })];
    const clash = run({ status: "DONE", result: { attachmentId: "a2", media: { url: own("p").url, pathname: own("p").pathname, kind: "image", name: "pic" } } });
    const second = run({ id: "r9", status: "DONE", result: { attachmentId: "a2", media: { url: own("q").url, pathname: own("q").pathname, kind: "image", name: "pic2" } } });
    expect(attachmentsOf(rows, [clash, second], T).map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("gives the next free id", () => {
    expect(nextAttachmentId([])).toBe("a1");
    expect(nextAttachmentId([{ id: "a1" }, { id: "a2" }, { id: "a4" }])).toBe("a3");
  });
});

describe("buildHistory", () => {
  it("flattens earlier tool traffic into one-line notes and never repeats the tool's data", () => {
    const rows = [
      msg({ seq: 1, role: "user", content: "how many orders?" }),
      msg({ seq: 2, role: "assistant", content: "Let me look.", toolCalls: [{ id: "c1", name: "orders_summary", args: "{}" }] as never }),
      msg({ seq: 3, role: "tool", toolCallId: "c1", content: '{"secret":"0750 111 2222"}', meta: { note: "3 orders" } }),
      msg({ seq: 4, role: "assistant", content: "You have 3." }),
      msg({ seq: 5, role: "user", content: "post it" }),
      msg({ seq: 6, role: "assistant", content: "", toolCalls: [{ id: "c2", name: "post_now", args: "{}" }] as never }),
      msg({ seq: 7, role: "tool", toolCallId: "c2", content: "{}", meta: { runId: "r1" } }),
    ];
    const h = buildHistory(rows, new Map([["r1", run({ status: "DONE", result: { text: "Posted." } })]]));
    const text = JSON.stringify(h);
    expect(text).not.toContain("0750");
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(String(h[1].content)).toContain("orders_summary → 3 orders");
    expect(String(h[1].content)).toContain("You have 3.");
    expect(String(h[3].content)).toContain("post_now → done: Posted.");
  });

  it("starts with the person's words and keeps only what fits", () => {
    const rows = [
      msg({ seq: 1, role: "assistant", content: "orphan" }),
      msg({ seq: 2, role: "user", content: "a".repeat(100) }),
      msg({ seq: 3, role: "assistant", content: "b".repeat(100) }),
      msg({ seq: 4, role: "user", content: "c".repeat(100) }),
    ];
    const all = buildHistory(rows, new Map());
    expect(all[0].role).toBe("user");
    expect(all).toHaveLength(3);
    const small = buildHistory(rows, new Map(), { maxChars: 150 });
    expect(small.at(-1)?.content).toBe("c".repeat(100));
    expect(small[0].role).toBe("user");
  });
});
