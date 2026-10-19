import { describe, expect, it } from "vitest";

import type { ChatAttachment, MessageDto } from "@/lib/chat/types";
import {
  CATCH_UP_EVERY_MS,
  CATCH_UP_FIRST_MS,
  CATCH_UP_GIVE_UP_MS,
  CATCH_UP_LANDING_MS,
  catchUpDelay,
  chatReducer,
  failTurn,
  beginTurn,
  initialChatState,
  keptUserMessages,
  menuTarget,
  nextCatchUp,
  retryPlan,
  valueDir,
} from "@/app/app/assistant/chat-model";

const msg = (id: string, seq: number, role: "user" | "assistant", text: string): MessageDto => ({
  id, seq, role, text, blocks: [], runs: [], followups: [], attachments: [], createdAt: "2026-10-19T09:00:00.000Z",
});

describe("catching up with the server after a Stop, a lost connection or a reload", () => {
  it("keeps asking while the server says a turn is running, however many messages have already arrived", () => {
    // An intermediate assistant message (a tool step) is on the server, the closing answer is not: still busy, so ask again.
    expect(nextCatchUp({ busy: true }, 4_000)).toBe("again");
    expect(nextCatchUp({ busy: true }, 60_000)).toBe("again");
  });

  it("is done as soon as the server says it is not busy", () => {
    expect(nextCatchUp({ busy: false }, 1_500)).toBe("done");
  });

  it("asks again after a look that failed, and gives up after about three minutes", () => {
    expect(nextCatchUp(null, 10_000)).toBe("again");
    expect(nextCatchUp(null, CATCH_UP_GIVE_UP_MS)).toBe("giveUp");
    expect(nextCatchUp({ busy: true }, CATCH_UP_GIVE_UP_MS + 1)).toBe("giveUp");
    expect(CATCH_UP_GIVE_UP_MS).toBeGreaterThanOrEqual(150_000);
    expect(CATCH_UP_GIVE_UP_MS).toBeLessThanOrEqual(200_000);
  });

  it("does not believe 'not busy' at first when the message just sent has not reached the server yet", () => {
    expect(nextCatchUp({ busy: false, landing: true }, 2_000)).toBe("again");
    expect(nextCatchUp({ busy: false, landing: true }, CATCH_UP_LANDING_MS)).toBe("done");
    expect(nextCatchUp({ busy: false, landing: false }, 2_000)).toBe("done");
  });

  it("looks soon the first time and at a calmer pace after that", () => {
    expect(catchUpDelay(0)).toBe(CATCH_UP_FIRST_MS);
    expect(catchUpDelay(1)).toBe(CATCH_UP_EVERY_MS);
    expect(catchUpDelay(7)).toBe(CATCH_UP_EVERY_MS);
    expect(CATCH_UP_FIRST_MS).toBeLessThan(CATCH_UP_EVERY_MS);
  });

  it("counts only the messages of the person's own that the server kept", () => {
    expect(keptUserMessages([msg("u1", 1, "user", "a"), msg("a1", 2, "assistant", "b"), msg("tmp:1", 3, "user", "c")])).toBe(1);
    expect(keptUserMessages([])).toBe(0);
  });

  it("takes the server's list on a sync, and clears the stale 'connection broke' line once the answer is in", () => {
    let s = failTurn(beginTurn(initialChatState({ threadId: "t1" }), { id: "tmp:1", text: "orders", attachments: [], quick: false, createdAt: "2026-10-19T09:00:00.000Z" }), "network");
    expect(s.error?.code).toBe("network");
    const answer = [msg("u1", 1, "user", "orders"), msg("a1", 2, "assistant", "You have 3 orders.")];
    // Not finished yet: the line stays.
    expect(chatReducer(s, { type: "sync", messages: answer }).error?.code).toBe("network");
    // Finished, and the last message is the assistant's: the line goes.
    s = chatReducer(s, { type: "sync", messages: answer, done: true });
    expect(s.error).toBeNull();
    expect(s.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("keeps the error when the turn is over but produced no answer, and never clears a different error", () => {
    const base = failTurn(beginTurn(initialChatState({ threadId: "t1" }), { id: "tmp:1", text: "orders", attachments: [], quick: false, createdAt: "2026-10-19T09:00:00.000Z" }), "network");
    expect(chatReducer(base, { type: "sync", messages: [msg("u1", 1, "user", "orders")], done: true }).error?.code).toBe("network");
    const other = failTurn(base, "unavailable");
    expect(chatReducer(other, { type: "sync", messages: [msg("u1", 1, "user", "orders"), msg("a1", 2, "assistant", "ok")], done: true }).error?.code).toBe("unavailable");
  });
});

describe("Retry after a failure", () => {
  const files: ChatAttachment[] = [{ id: "a1", url: "https://x/a.jpg", pathname: "merchant/w/a.jpg", kind: "image", name: "a.jpg" }];

  it("sends the words in the box when there are any", () => {
    expect(retryPlan("show orders", { text: "older", files: [] })).toEqual({ again: false });
    expect(retryPlan("  hi ", null)).toEqual({ again: false });
  });

  it("sends the last message again, with its files, when the box is empty (the server had kept it)", () => {
    expect(retryPlan("", { text: "post this", files })).toEqual({ again: true, text: "post this", files });
    expect(retryPlan("   ", { text: "Orders", quick: "orders", files: [] })).toEqual({ again: true, text: "Orders", quick: "orders", files: [] });
  });

  it("has nothing to retry with an empty box and nothing sent", () => {
    expect(retryPlan("", null)).toBeNull();
    expect(retryPlan("", { text: "  ", files: [] })).toBeNull();
  });
});

describe("figures in right-to-left cards", () => {
  it("lets a value with letters work out its own direction, and a bare figure take the page's", () => {
    expect(valueDir("٣")).toBeUndefined();
    expect(valueDir("٩٥,٠٠٠")).toBeUndefined();
    expect(valueDir("9:00")).toBeUndefined();
    expect(valueDir("+٩٦٤ ٧٧٠ ١٢٣ ٤٥٦٧")).toBeUndefined();
    expect(valueDir("٩٥,٠٠٠ دینار")).toBe("auto");
    expect(valueDir("95,000 IQD")).toBe("auto");
    expect(valueDir("Sara Ahmed")).toBe("auto");
    expect(valueDir("")).toBeUndefined();
  });
});

describe("the keyboard in the row menu", () => {
  const items = ["rename", "pin", "delete"];
  it("moves to the next and previous item, wrapping at both ends", () => {
    expect(menuTarget("ArrowDown", items, "rename")).toBe("pin");
    expect(menuTarget("ArrowDown", items, "delete")).toBe("rename");
    expect(menuTarget("ArrowUp", items, "pin")).toBe("rename");
    expect(menuTarget("ArrowUp", items, "rename")).toBe("delete");
  });
  it("jumps to the first and last with Home and End, and starts from the ends when nothing is focused", () => {
    expect(menuTarget("Home", items, "delete")).toBe("rename");
    expect(menuTarget("End", items, "rename")).toBe("delete");
    expect(menuTarget("ArrowDown", items, null)).toBe("rename");
    expect(menuTarget("ArrowUp", items, null)).toBe("delete");
  });
  it("leaves every other key, and an empty menu, alone", () => {
    expect(menuTarget("a", items, "pin")).toBeNull();
    expect(menuTarget("Tab", items, "pin")).toBeNull();
    expect(menuTarget("ArrowDown", [], null)).toBeNull();
  });
});
