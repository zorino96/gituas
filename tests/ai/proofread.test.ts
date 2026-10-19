import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { correctionProblem, looksKurdish, polishAdRaw, polishReelSegments, proofreadLines, proofreadSorani, resetProofreadLimits } from "@/lib/ai/proofread";

const SORANI = "فڕۆکەخانەی هەولێر لە مانگی داهاتوو هێڵێکی نوێ زیاد دەکات.";

const answer = (text: string, status = 200) => new Response(JSON.stringify({ text }), { status });

beforeEach(() => {
  vi.stubEnv("PROOFREAD_ENABLED", "1"); // the test setup switches it off for every other test
  resetProofreadLimits();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("what a correction may not change", () => {
  it("accepts a plain spelling fix", () => {
    expect(correctionProblem("بادبانەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات", "چارۆکەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات")).toBeNull();
  });

  it("refuses a changed number, a changed link or handle or hashtag, and a changed or lost Latin word", () => {
    expect(correctionProblem("نرخی ٢٥ هەزار", "نرخی ٣٥ هەزار")).toBe("protected");
    expect(correctionProblem("بنووسە بۆ @myshop_iq", "بنووسە بۆ @myshop")).toBe("protected");
    expect(correctionProblem("بڕۆ بۆ https://gituas.com/a", "بڕۆ بۆ https://gituas.com/b")).toBe("protected");
    expect(correctionProblem("باشترین کاپتن #بازاڕ", "باشترین کاپتن #بازار")).toBe("protected");
    expect(correctionProblem("مەری سێلێست و Gituas", "مەری سێلێست و گیتواس")).toBe("protected");
    // a digit written in Arabic-Indic and corrected to Western is the same number
    expect(correctionProblem("٢٥ هەزار دینار", "25 هەزار دینار")).toBeNull();
  });

  it("refuses an empty answer, a very different length and a different number of lines", () => {
    expect(correctionProblem(SORANI, "  ")).toBe("empty");
    expect(correctionProblem(SORANI, "کورت")).toBe("length");
    expect(correctionProblem(SORANI, SORANI.repeat(3))).toBe("length");
    expect(correctionProblem("یەک\nدوو", "یەک دوو")).toBe("lines");
  });
});

describe("proofreadSorani", () => {
  it("returns the corrected text and says it changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer("فڕۆکەخانەی هەولێر لە مانگی داهاتوودا هێڵێکی نوێ زیاد دەکات."));
    vi.stubGlobal("fetch", fetchMock);
    const r = await proofreadSorani(SORANI);
    expect(r.changed).toBe(true);
    expect(r.text).toContain("داهاتوودا");
    expect(fetchMock.mock.calls[0][0]).toBe("https://gochan.moneger.workers.dev/v1/fix");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: SORANI });
  });

  it("keeps the text when the door is down, slow, not JSON, or refused", async () => {
    for (const f of [
      () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })),
      () => Promise.resolve(new Response("busy", { status: 503 })),
      () => Promise.resolve(new Response("not json", { status: 200 })),
      () => Promise.resolve(answer("", 200)),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(f));
      const r = await proofreadSorani(SORANI);
      expect(r).toEqual({ text: SORANI, changed: false });
    }
  });

  it("keeps the text when the correction changed a number", async () => {
    const text = "نرخەکەی ٢٥ هەزار دینارە و گەیاندن بەخۆڕاییە";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer("نرخەکەی ٣٥ هەزار دینارە و گەیاندن بەخۆڕاییە")));
    expect((await proofreadSorani(text)).changed).toBe(false);
  });

  it("does not call out for text that is not Kurdish, too long, or when switched off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer(SORANI));
    vi.stubGlobal("fetch", fetchMock);
    expect((await proofreadSorani("Hello world, this is English text")).changed).toBe(false);
    expect((await proofreadSorani("ا".repeat(4000))).changed).toBe(false);
    vi.stubEnv("PROOFREAD_ENABLED", "0");
    expect((await proofreadSorani(SORANI)).changed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(looksKurdish(SORANI)).toBe(true);
    expect(looksKurdish("Hello world")).toBe(false);
  });

  it("keeps under the door's limit of calls a minute", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => answer(SORANI));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 30; i++) await proofreadSorani(SORANI);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(18);
  });
});

describe("several lines in one call", () => {
  it("gives back the same number of lines, corrected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer("چارۆکەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات\nدوا تۆمارکردن لە ڕۆژنامەی کەشتییەکەدایە")));
    const out = await proofreadLines(["بادبانەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات", "دوا تۆمارکردن لە ڕۆژنامەی کەشتییەکەدایە"]);
    expect(out[0]).toContain("چارۆکەکانی");
    expect(out).toHaveLength(2);
  });

  it("keeps every line when the number of lines came back different", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer("چارۆکەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات")));
    const lines = ["بادبانەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات", "دوا تۆمارکردن لە ڕۆژنامەی کەشتییەکەدایە"];
    expect(await proofreadLines(lines)).toEqual(lines);
  });
});

describe("the ad video's raw JSON and the news reel's segments", () => {
  it("corrects the spoken lines and the caption, and leaves everything else in the JSON alone", async () => {
    const raw = { style: "A", scenes: [{ type: "hook", text: "x", voice: "بادبانەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات" }, { type: "cta", text: "y", voice: "" }], caption: "بادبانەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => answer("چارۆکەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات")));
    const out = (await polishAdRaw(raw)) as typeof raw;
    expect(out.scenes[0].voice).toContain("چارۆکەکانی");
    expect(out.caption).toContain("چارۆکەکانی");
    expect(out.scenes[0].text).toBe("x");
    expect(out.scenes[1].voice).toBe("");
    expect(raw.scenes[0].voice).toContain("بادبانەکانی"); // the original is not touched
  });

  it("gives the same JSON back when nothing changed or the door fails", async () => {
    const raw = { scenes: [{ voice: SORANI }], caption: SORANI };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await polishAdRaw(raw)).toBe(raw);
  });

  it("corrects the news reel's spoken sentences and keeps the other fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer("چارۆکەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات")));
    const segs = [{ kind: "headline", show: "سەردێڕ", say: "بادبانەکانی کراونەتەوە و ڕێک بەرەو پێش دەڕوات" }];
    const out = await polishReelSegments(segs);
    expect(out[0].say).toContain("چارۆکەکانی");
    expect(out[0].show).toBe("سەردێڕ");
    expect(out[0].kind).toBe("headline");
  });
});
