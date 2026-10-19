import { describe, expect, it } from "vitest";

import type { ChatAttachment, ChatEvent, MessageDto, RunDto, ThreadSummary } from "@/lib/chat/types";
import {
  abortTurn,
  applyEvent,
  beginTurn,
  codeFromResponse,
  dayNumber,
  failTurn,
  groupOf,
  groupThreads,
  hasRunning,
  initialChatState,
  minutesLeft,
  patchRun,
  reconcile,
  safeHref,
  shownStatus,
  splitLinks,
  upsertThread,
} from "@/app/app/assistant/chat-model";

const NOW = Date.parse("2026-10-19T12:00:00+03:00");
const msg = (id: string, seq: number, role: "user" | "assistant", text: string, over: Partial<MessageDto> = {}): MessageDto => ({
  id, seq, role, text, blocks: [], runs: [], followups: [], attachments: [], createdAt: "2026-10-19T09:00:00.000Z", ...over,
});
const run = (id: string, over: Partial<RunDto> = {}): RunDto => ({
  id, tool: "post_now", risk: "public", title: "Post now", lines: [], status: "PROPOSED", decidedBy: null, tainted: false,
  expiresAt: new Date(NOW + 10 * 60_000).toISOString(), long: false, ...over,
});
const tmp = (over: Record<string, unknown> = {}) => ({ id: "tmp:1", text: "show orders", attachments: [] as ChatAttachment[], quick: false, createdAt: "2026-10-19T09:00:00.000Z", ...over });
const feed = (state: ReturnType<typeof initialChatState>, ...events: ChatEvent[]) => events.reduce(applyEvent, state);

describe("a turn as events arrive", () => {
  it("draws the person's message at once, then swaps it for the kept one", () => {
    let s = beginTurn(initialChatState(), tmp());
    expect(s.streaming).toBe(true);
    expect(s.messages.map((m) => m.id)).toEqual(["tmp:1"]);
    s = feed(s, { t: "thread", id: "t1", title: "Orders", isNew: true }, { t: "message", message: msg("u1", 1, "user", "show orders") });
    expect(s.threadId).toBe("t1");
    expect(s.title).toBe("Orders");
    expect(s.messages.map((m) => m.id)).toEqual(["u1"]);
    expect(s.pending).toBeNull();
  });

  it("shows the status, clears it when the answer arrives, and ends on done with the turns left", () => {
    let s = beginTurn(initialChatState({ threadId: "t1" }), tmp());
    s = feed(s, { t: "status", text: "Looking at the orders…" });
    expect(s.status).toBe("Looking at the orders…");
    s = feed(s, { t: "message", message: msg("a1", 2, "assistant", "You have 3 orders.") });
    expect(s.status).toBeNull();
    s = feed(s, { t: "done", remaining: { day: 4, month: 90 }, ms: 900 });
    expect(s).toMatchObject({ streaming: false, remaining: { day: 4, month: 90 } });
    expect(s.messages.at(-1)?.text).toBe("You have 3 orders.");
  });

  it("keeps several assistant messages of one turn in order and replaces a message that is sent twice", () => {
    let s = initialChatState();
    s = feed(s, { t: "message", message: msg("a2", 4, "assistant", "second") }, { t: "message", message: msg("a1", 3, "assistant", "first") });
    expect(s.messages.map((m) => m.id)).toEqual(["a1", "a2"]);
    s = feed(s, { t: "message", message: msg("a1", 3, "assistant", "first, edited") });
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].text).toBe("first, edited");
  });

  it("updates a card in place when its state changes", () => {
    let s = initialChatState({ messages: [msg("a1", 2, "assistant", "ok", { runs: [run("r1")] })] });
    s = feed(s, { t: "run", run: run("r1", { status: "DONE", decidedBy: "AUTO", resultText: "Posted." }) });
    expect(s.messages[0].runs[0]).toMatchObject({ status: "DONE", decidedBy: "AUTO", resultText: "Posted." });
  });

  it("holds a card update that arrives before its message and applies it when the message comes", () => {
    let s = initialChatState();
    s = feed(s, { t: "run", run: run("r1", { status: "DONE" }) });
    expect(s.strayRuns.r1.status).toBe("DONE");
    s = feed(s, { t: "message", message: msg("a1", 2, "assistant", "ok", { runs: [run("r1", { status: "PROPOSED" })] }) });
    expect(s.messages[0].runs[0].status).toBe("DONE");
    expect(s.strayRuns).toEqual({});
  });
});

describe("a turn that fails", () => {
  it("takes the message back out and hands the words back to the composer when the server never kept it", () => {
    const files: ChatAttachment[] = [{ id: "a1", url: "https://x/a.jpg", pathname: "merchant/w/a.jpg", kind: "image", name: "a.jpg" }];
    const s = failTurn(beginTurn(initialChatState(), tmp({ attachments: files })), "limit_day");
    expect(s.messages).toEqual([]);
    expect(s.restore).toEqual({ text: "show orders", attachments: files });
    expect(s.error).toEqual({ code: "limit_day", message: "", contact: false });
    expect(s.streaming).toBe(false);
  });

  it("does not put a quick button's label into the composer", () => {
    const s = failTurn(beginTurn(initialChatState(), tmp({ quick: true, text: "Today" })), "internal");
    expect(s.restore).toBeNull();
    expect(s.messages).toEqual([]);
  });

  it("keeps the message when the server had already kept it", () => {
    let s = beginTurn(initialChatState(), tmp());
    s = feed(s, { t: "message", message: msg("u1", 1, "user", "show orders") }, { t: "error", code: "unavailable", message: "", contact: true });
    expect(s.messages.map((m) => m.id)).toEqual(["u1"]);
    expect(s.restore).toBeNull();
    expect(s.error).toEqual({ code: "unavailable", message: "", contact: true });
  });

  it("a Stop only stops waiting: nothing is removed and no error is shown", () => {
    const s = abortTurn(beginTurn(initialChatState(), tmp()));
    expect(s).toMatchObject({ streaming: false, status: null, error: null, pending: null });
    expect(s.messages).toHaveLength(1);
  });

  it("clears the last error when the next turn begins", () => {
    const failed = failTurn(beginTurn(initialChatState(), tmp()), "busy");
    expect(beginTurn(failed, tmp({ id: "tmp:2" })).error).toBeNull();
  });
});

describe("reconcile", () => {
  it("takes the server's list and drops a drawn message the server already holds", () => {
    const local = [msg("u1", 1, "user", "hi"), msg("tmp:2", 2, "user", "show orders")];
    const remote = [msg("u1", 1, "user", "hi"), msg("u2", 2, "user", "show orders"), msg("a2", 3, "assistant", "3 orders")];
    expect(reconcile(local, remote).map((m) => m.id)).toEqual(["u1", "u2", "a2"]);
  });

  it("keeps a drawn message the server does not have yet", () => {
    const local = [msg("u1", 1, "user", "hi"), msg("tmp:2", 2, "user", "later")];
    expect(reconcile(local, [msg("u1", 1, "user", "hi")]).map((m) => m.id)).toEqual(["u1", "tmp:2"]);
  });
});

describe("cards", () => {
  it("finds a running card", () => {
    expect(hasRunning([msg("a1", 1, "assistant", "", { runs: [run("r1", { status: "RUNNING" })] })])).toBe(true);
    expect(hasRunning([msg("a1", 1, "assistant", "", { runs: [run("r1", { status: "DONE" })] })])).toBe(false);
  });

  it("counts the minutes left, rounded up, and 0 once the time has passed", () => {
    expect(minutesLeft(new Date(NOW + 61_000).toISOString(), NOW)).toBe(2);
    expect(minutesLeft(new Date(NOW + 20_000).toISOString(), NOW)).toBe(1);
    expect(minutesLeft(new Date(NOW - 1).toISOString(), NOW)).toBe(0);
    expect(minutesLeft("nonsense", NOW)).toBeNull();
  });

  it("draws an unconfirmed card past its time as expired, and leaves other states alone", () => {
    expect(shownStatus({ status: "PROPOSED", expiresAt: new Date(NOW - 5).toISOString() }, NOW)).toBe("EXPIRED");
    expect(shownStatus({ status: "PROPOSED", expiresAt: new Date(NOW + 5_000).toISOString() }, NOW)).toBe("PROPOSED");
    expect(shownStatus({ status: "DONE", expiresAt: new Date(NOW - 5).toISOString() }, NOW)).toBe("DONE");
    expect(shownStatus({ status: "PROPOSED", expiresAt: "" }, NOW)).toBe("PROPOSED");
  });

  it("patchRun says whether it found the card", () => {
    const list = [msg("a1", 1, "assistant", "", { runs: [run("r1")] })];
    expect(patchRun(list, run("r2")).found).toBe(false);
    expect(patchRun(list, run("r1", { status: "CANCELLED" }))).toMatchObject({ found: true, messages: [{ runs: [{ status: "CANCELLED" }] }] });
  });
});

describe("codeFromResponse", () => {
  it("uses a code the body names, else the HTTP status", () => {
    expect(codeFromResponse(500, { code: "allowance" })).toBe("allowance");
    expect(codeFromResponse(401, null)).toBe("signin");
    expect(codeFromResponse(403, {})).toBe("forbidden");
    expect(codeFromResponse(409, undefined)).toBe("busy");
    expect(codeFromResponse(413, "")).toBe("badrequest");
    expect(codeFromResponse(504, {})).toBe("unavailable");
    expect(codeFromResponse(500, { code: "nope" })).toBe("internal");
  });
});

describe("grouping the history by day", () => {
  const th = (id: string, iso: string, pinned = false): ThreadSummary => ({ id, title: id, pinned, lastMessageAt: iso });

  it("counts days in Baghdad's time, so a late-evening UTC message is already the next day there", () => {
    // 22:30 UTC on the 18th is 01:30 on the 19th in Baghdad
    expect(dayNumber(Date.parse("2026-10-18T22:30:00Z"))).toBe(dayNumber(Date.parse("2026-10-19T08:00:00Z")));
    expect(dayNumber(Date.parse("2026-10-18T20:30:00Z"))).toBe(dayNumber(Date.parse("2026-10-18T12:00:00Z")));
    expect(dayNumber(Date.parse("2026-10-19T08:00:00Z")) - dayNumber(Date.parse("2026-10-18T08:00:00Z"))).toBe(1);
    expect(dayNumber(NaN)).toBeNaN();
  });

  it("puts a thread in today, yesterday, the previous 7 days, the previous 30 days or older", () => {
    const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
    expect(groupOf(at(0), NOW)).toBe("today");
    expect(groupOf(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe("today"); // a clock a little ahead
    expect(groupOf(at(1), NOW)).toBe("yesterday");
    expect(groupOf(at(2), NOW)).toBe("week");
    expect(groupOf(at(7), NOW)).toBe("week");
    expect(groupOf(at(8), NOW)).toBe("month");
    expect(groupOf(at(30), NOW)).toBe("month");
    expect(groupOf(at(31), NOW)).toBe("older");
    expect(groupOf("garbage", NOW)).toBe("older");
  });

  it("lists pinned first, then the groups in order, newest first, and leaves empty groups out", () => {
    const at = (daysAgo: number, h = 0) => new Date(NOW - daysAgo * 86_400_000 - h * 3_600_000).toISOString();
    const groups = groupThreads(
      [th("old", at(90)), th("t2", at(0, 2)), th("pin", at(40), true), th("t1", at(0, 1)), th("y", at(1)), th("w", at(5)), th("m", at(20))],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual(["pinned", "today", "yesterday", "week", "month", "older"]);
    expect(groups.find((g) => g.key === "today")!.threads.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(groups[0].threads.map((t) => t.id)).toEqual(["pin"]);
    expect(groupThreads([th("only", at(0))], NOW).map((g) => g.key)).toEqual(["today"]);
    expect(groupThreads([], NOW)).toEqual([]);
  });

  it("upsertThread adds a new chat on top and updates an existing one in place", () => {
    const a = th("a", "2026-10-19T09:00:00.000Z");
    const b = th("b", "2026-10-18T09:00:00.000Z");
    expect(upsertThread([a, b], th("c", "2026-10-19T10:00:00.000Z")).map((t) => t.id)).toEqual(["c", "a", "b"]);
    const renamed = upsertThread([a, b], { ...b, title: "Renamed" });
    expect(renamed.map((t) => t.id)).toEqual(["a", "b"]);
    expect(renamed[1].title).toBe("Renamed");
  });
});

describe("text", () => {
  it("makes https addresses into links and keeps the full stop out of them", () => {
    expect(splitLinks("Open https://gituas.com/app/orders. Then reply.")).toEqual(["Open ", { url: "https://gituas.com/app/orders" }, ".", " Then reply."]);
  });

  it("keeps the Arabic-script punctuation that ends a sentence outside the link too", () => {
    expect(splitLinks("بیبینە https://gituas.com/app؟")).toEqual(["بیبینە ", { url: "https://gituas.com/app" }, "؟"]);
  });

  it("does not make links of http, javascript or bare domains", () => {
    expect(splitLinks("http://a.com javascript:alert(1) gituas.com")).toEqual(["http://a.com javascript:alert(1) gituas.com"]);
    expect(splitLinks("https://")).toEqual(["https://"]);
  });

  it("only allows links inside the app or https in a view block", () => {
    expect(safeHref("/app/orders")).toEqual({ href: "/app/orders", external: false });
    expect(safeHref("https://wa.me/9647710106009")).toEqual({ href: "https://wa.me/9647710106009", external: true });
    for (const bad of ["//evil.com", "/\\evil.com", "javascript:alert(1)", "http://a.com", "mailto:a@b.c", "", undefined]) expect(safeHref(bad)).toBeNull();
  });
});
