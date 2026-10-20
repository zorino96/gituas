import { describe, expect, it } from "vitest";

import { waitingToConfirm } from "@/app/app/assistant/chat-model";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { RunDto } from "@/lib/chat/types";

// "Confirm all": the cards of one answer that wait for the person, confirmed with one press; each still runs as its own card.

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const run = (id: string, over: Partial<RunDto> = {}): RunDto => ({
  id,
  tool: "set_daily_video",
  risk: "standing",
  title: id,
  lines: [],
  status: "PROPOSED",
  decidedBy: null,
  tainted: false,
  expiresAt: new Date(NOW + 20 * 60_000).toISOString(),
  long: false,
  ...over,
});

describe("waitingToConfirm", () => {
  it("lists the cards that wait", () => {
    expect(waitingToConfirm([run("a"), run("b")], NOW).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("leaves out a card that is decided, expired, being decided now, or came after customers' words", () => {
    const list = [
      run("done", { status: "DONE" }),
      run("old", { expiresAt: new Date(NOW - 60_000).toISOString() }),
      run("busy"),
      run("tainted", { tainted: true }),
      run("ok"),
    ];
    expect(waitingToConfirm(list, NOW, { busy: "confirm" }).map((r) => r.id)).toEqual(["ok"]);
  });
  it("offers nothing before the browser knows the time (the first paint of the server)", () => {
    expect(waitingToConfirm([run("a"), run("b")], null)).toEqual([]);
  });
});

describe("the words", () => {
  it("name how many cards the press confirms, in every language", () => {
    expect(en.chat.runs.confirmAll(3)).toBe("Confirm all (3)");
    expect(ckb.chat.runs.confirmAll(3)).toMatch(/[؀-ۿ]/);
    expect(ar.chat.runs.confirmAll(3)).toMatch(/[؀-ۿ]/);
  });
});
