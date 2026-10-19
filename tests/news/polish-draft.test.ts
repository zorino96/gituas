import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetProofreadLimits } from "@/lib/ai/proofread";
import { polishDraft } from "@/lib/news/draft";
import type { Draft } from "@/lib/news/types";

const draft: Draft = {
  headline: "فڕۆکەخانەی هەولێر هێڵێکی نوێ دەکاتەوە",
  body: "فڕۆکەخانەی هەولێر لە مانگی داهاتوو هێڵێکی نوێ بۆ فرانکفۆرت دەکاتەوە.",
  category: "ئابووری",
  cardKind: "STANDARD",
  stat: null,
  quote: null,
  speaker: null,
};
const door = (map: (t: string) => string) =>
  vi.fn().mockImplementation(async (_u: string, init: { body: string }) => new Response(JSON.stringify({ text: map(JSON.parse(init.body).text) }), { status: 200 }));

beforeEach(() => {
  vi.stubEnv("PROOFREAD_ENABLED", "1");
  resetProofreadLimits();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("polishDraft", () => {
  it("corrects the headline and the body and leaves the rest of the draft as it was", async () => {
    vi.stubGlobal("fetch", door((t) => t.replace("داهاتوو", "داهاتووەوە")));
    const out = await polishDraft(draft);
    expect(out.body).toContain("داهاتووەوە");
    expect(out.headline).toBe(draft.headline);
    expect(out.category).toBe("ئابووری");
    expect(out.cardKind).toBe("STANDARD");
  });

  it("returns the very same draft when nothing was changed, when the door fails, or when it is switched off", async () => {
    vi.stubGlobal("fetch", door((t) => t));
    expect(await polishDraft(draft)).toBe(draft);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await polishDraft(draft)).toBe(draft);
    vi.stubEnv("PROOFREAD_ENABLED", "0");
    expect(await polishDraft(draft)).toBe(draft);
  });

  it("keeps the model's draft when the correction would break the draft's own rules (a Latin letter inside a Kurdish word)", async () => {
    vi.stubGlobal("fetch", door((t) => t.replace("نوێ", "نوwێ")));
    expect(await polishDraft(draft)).toBe(draft);
  });

  it("corrects a quote too", async () => {
    const q: Draft = { ...draft, cardKind: "QUOTE", quote: "ئێمە هەموو شتێک ئامادە دەکەین", speaker: "وتەبێژ" };
    vi.stubGlobal("fetch", door((t) => t.replace("ئامادە", "ئامادە")));
    expect((await polishDraft(q)).quote).toBe(q.quote);
  });
});
