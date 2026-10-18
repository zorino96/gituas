import { afterEach, describe, expect, it, vi } from "vitest";

import { extractJson } from "@/lib/ai/kurdgg";
import { DAILY_ANALYSES } from "@/lib/boost/cache";
import { buildKnowledge } from "@/lib/assistant/knowledge";
import { kurdishLetters, validateDraft } from "@/lib/news/draft";
import { planUsesOpus, SHOP_LIMITS, STORE_PLANS, tenantLimits } from "@/lib/shop/plans";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a reply that is not JSON", () => {
  it("never carries a piece of the reply in the error", () => {
    // V8's own message would quote about ten characters around the bad token ("sorry, the buyer Aso 0750 ...")
    expect(() => extractJson(`{"reply": 'call Aso on 0750 1234567'}`)).toThrowError(/^the reply was not JSON$/);
  });

  it("goes through kurdggJson as KurdggReplyError with the same plain message", async () => {
    const { kurdggJson, KurdggReplyError } = await import("@/lib/ai/kurdgg");
    vi.stubEnv("KURDGG_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: `{"reply": 'call Aso on 0750 1234567'}` } }] }), { status: 200 })));
    try {
      await kurdggJson({ system: "s", user: "u", strength: "fast" }, 5000);
      throw new Error("expected it to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(KurdggReplyError);
      expect((e as Error).message).toBe("the reply was not JSON");
    }
  });
});

describe("a news draft with the Arabic letters ي ك ى ة", () => {
  const base = { headline: "سەردێڕ", body: "دەق.", category: "ئابووری", cardKind: "STANDARD", stat: null, quote: null, speaker: null };

  it("maps them to the Kurdish ones one for one instead of throwing the story away", () => {
    expect(kurdishLetters("كوردستان ي ى ة")).toBe("کوردستان ی ی ە");
    const d = validateDraft({ ...base, headline: "كوردستان", body: "ئەم مدرسة باشە" })!;
    expect(d.headline).toBe("کوردستان");
    expect(d.body).toBe("ئەم مدرسە باشە");
    expect(kurdishLetters(null)).toBeNull();
  });

  it("still rejects a Latin letter inside a Kurdish word and a doubled alef", () => {
    expect(validateDraft({ ...base, body: "باranی" })).toBeNull();
    expect(validateDraft({ ...base, body: "مندااڵن" })).toBeNull();
  });
});

describe("Opus switched off (AI_OPUS_ENABLED=0): no Opus promises", () => {
  it("has no plan that uses Opus, and every video is a Lite video", () => {
    expect(planUsesOpus("MAX")).toBe(true);
    const max = tenantLimits(["MAX"]);
    expect(max.videos.PRO).toBeGreaterThan(0);
    vi.stubEnv("AI_OPUS_ENABLED", "0");
    for (const p of [...STORE_PLANS, "UNLIMITED" as const]) expect(planUsesOpus(p)).toBe(false);
    const off = tenantLimits(["MAX"]);
    expect(off.videos.PRO).toBe(0);
    expect(off.videos.LITE).toBe(SHOP_LIMITS.MAX.videosPerMonth);
    // a test workspace's videos are counted once, not twice
    const unl = tenantLimits(["UNLIMITED"]);
    expect(unl.videos.PRO).toBe(0);
    expect(unl.videos.LITE).toBe(SHOP_LIMITS.UNLIMITED.videosPerMonth);
  });

  it("does not make the assistant talk about a Pro video tier unless Max is on offer", () => {
    expect(buildKnowledge({ max: true, video: true, pictures: true })).toContain("Pro (script by the strongest model");
    const text = buildKnowledge({ max: false, video: true, pictures: true });
    expect(text).not.toContain("Pro (script by the strongest model");
    expect(text).toContain("The script is written by the fast model.");
  });
});

describe("a test account's daily Boost analyses", () => {
  it("are above every sold plan's", () => {
    for (const p of STORE_PLANS) expect(DAILY_ANALYSES.UNLIMITED).toBeGreaterThan(DAILY_ANALYSES[p]);
  });
});
