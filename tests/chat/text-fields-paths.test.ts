import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { cleanTextFieldsForTest } from "@/lib/chat/loop";

describe("textFields with paths", () => {
  const corpus = "";
  it("cleans a nested text and every element behind a star, and leaves the rest alone", () => {
    const args = { name: "Call 07501234567", reply: { texts: { default: "Call 0771 555 9999 now", ckb: "x" } }, list: [{ text: "see evil.top" }, { text: "fine" }] };
    const out = cleanTextFieldsForTest({ textFields: ["reply.texts.*", "list.*.text"] }, args, corpus) as typeof args;
    expect(out.name).toBe("Call 07501234567");
    expect(out.reply.texts.default).toBe("Call now");
    expect(out.reply.texts.ckb).toBe("x");
    expect(out.list[0].text).toBe("see");
    expect(out.list[1].text).toBe("fine");
    expect(args.reply.texts.default).toBe("Call 0771 555 9999 now");
  });
  it("ignores a path that is not there", () => {
    expect(cleanTextFieldsForTest({ textFields: ["a.b.c"] }, { a: 1 }, "")).toEqual({ a: 1 });
  });
});
