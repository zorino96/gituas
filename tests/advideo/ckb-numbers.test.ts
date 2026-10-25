import { describe, expect, it } from "vitest";
import { ckbNumber, ckbSpokenNumbers, normalizeSpec } from "@/lib/advideo/spec";

describe("Sorani numbers said by the code", () => {
  it("says years and counts right", () => {
    expect(ckbNumber("2025")).toBe("دوو هەزار و بیست و پێنج");
    expect(ckbNumber("1922")).toBe("هەزار و نۆسەد و بیست و دوو");
    expect(ckbNumber("1859")).toBe("هەزار و هەشتسەد و پەنجا و نۆ");
    expect(ckbNumber("2008")).toBe("دوو هەزار و هەشت");
    expect(ckbNumber("100")).toBe("سەد");
    expect(ckbNumber("15")).toBe("پازدە");
    expect(ckbNumber("3000000")).toBe("سێ ملیۆن");
  });
  it("rewrites a spoken line, Arabic-Indic digits, commas, decimals and percentages too", () => {
    expect(ckbSpokenNumbers("لە ساڵی ٢٠٢٥دا")).toBe("لە ساڵی دوو هەزار و بیست و پێنجدا");
    expect(ckbSpokenNumbers("1,200 بەرمیل")).toBe("هەزار و دووسەد بەرمیل");
    expect(ckbSpokenNumbers("50% نەوت")).toBe("لەسەدا پەنجا نەوت");
    expect(ckbSpokenNumbers("3.5 ملیار")).toBe("سێ پۆینت پێنج ملیار");
    expect(ckbSpokenNumbers("بێ ژمارە")).toBe("بێ ژمارە");
  });
  it("lets a Sorani story's writer give digits, and the spec carries words", () => {
    const raw = { scenes: [
      { type: "hook", text: "نەوت", voice: "لە ساڵی 2025دا نەوت گران بوو." },
      { type: "story", text: "دواتر", voice: "دواتر هەموو شتێک گۆڕا." },
      { type: "story", text: "ئەمڕۆ", voice: "ئەمڕۆ جیهان بە شێوەیەکی تر دەژی." },
      { type: "cta", text: "سەبسکرایب", voice: "سەبسکرایب بکە." },
    ], caption: "نەوت" };
    const n = normalizeSpec(raw, { photos: 0, hasTopic: true, maxScenes: 8, lang: "ckb", kind: "story", mode: "real" } as never);
    expect(n.ok ? "" : n.errors.join(" | ")).toBe("");
    if (n.ok) expect(n.spec.scenes[0].voice).toContain("دوو هەزار و بیست و پێنج");
  });
});
