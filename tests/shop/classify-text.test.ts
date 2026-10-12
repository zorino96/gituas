import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

import { completeJson } from "@/lib/ai/provider";
import { classifyText } from "@/lib/shop/classify";

beforeEach(() => vi.resetAllMocks());

describe("classifyText", () => {
  it("labels a reaction and a plain price question without calling the model", async () => {
    expect(await classifyText("😍😍", { channel: "comment" })).toMatchObject({ type: "PRAISE" });
    expect(await classifyText("بە چەندە؟", { channel: "dm" })).toMatchObject({ type: "QUESTION", intent: "price", language: "ckb" });
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("asks Haiku for everything else, counted against the store, with a short answer cap", async () => {
    vi.mocked(completeJson).mockResolvedValue({ data: { type: "ORDER", intent: "none", language: "ckb", confidence: 0.9 }, model: "m" });
    const meter = { scope: "t1" };
    const c = await classifyText("دەمەوێت دوو دانە بکڕم و بۆ سلێمانی بنێرن", { channel: "dm", ai: { tier: "opus", meter } });
    expect(c).toMatchObject({ type: "ORDER" });
    // A label is Haiku even when the store's plan has Opus.
    expect(vi.mocked(completeJson).mock.calls[0][0]).toMatchObject({ tier: "haiku", meter, maxTokens: 160 });
  });

  it("gives null when the model cannot answer and no rule fits (the message goes to the owner)", async () => {
    vi.mocked(completeJson).mockRejectedValue(new Error("this month's AI allowance is used up"));
    expect(await classifyText("ئایا ئەم کەلوپەلە ڕەسەنە و گەرەنتی هەیە؟", { channel: "comment" })).toBeNull();
  });
});
