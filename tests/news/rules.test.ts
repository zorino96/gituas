import { describe, it, expect } from "vitest";
import { captionFor, checkDraft, overlapRatio } from "@/lib/news/rules";

const SRC = {
  title: "بەغدا و کوەیت لاپەڕەیەکی نوێ",
  snippet: "عێراق و کوەیت لەسەر پێکهێنانی لیژنەیەکی هاوبەش بۆ یەکلاکردنەوەی دۆسیە هەڵپەسێردراوەکان رێککەوتن",
};

describe("overlapRatio", () => {
  it("is 1 for a copy and 0 for unrelated text", () => {
    expect(overlapRatio(SRC.snippet, SRC.snippet)).toBe(1);
    expect(overlapRatio("Gold prices rose in Erbil markets this week", SRC.snippet)).toBe(0);
  });
});

describe("checkDraft", () => {
  it("blocks a Kurdish draft that copies the source", () => {
    const d = { headline: "عێراق و کوەیت لەسەر پێکهێنانی", body: SRC.snippet };
    expect(checkDraft(d, SRC).map((p) => p.code)).toContain("COPY");
  });
  it("passes a restated draft of a foreign-language source", () => {
    const src = { title: "مجلس الأمن يدين هجمات الحوثيين على الرياض", snippet: "دان مجلس الأمن تصاعد هجمات جماعة أنصار الله" };
    const d = { headline: "ئەنجومەنی ئاسایش هێرشەکانی حوسییەکانی ئیدانە کرد", body: "ئەنجومەنی ئاسایشی نەتەوە یەکگرتووەکان هێرشەکانی بۆ سەر ڕیاز ئیدانە کرد." };
    expect(checkDraft(d, src)).toEqual([]);
  });
  it("flags empty and too-long text", () => {
    expect(checkDraft({ headline: "", body: "x" }, SRC).map((p) => p.code)).toContain("EMPTY");
    expect(checkDraft({ headline: "ا".repeat(121), body: "x" }, SRC).map((p) => p.code)).toContain("HEADLINE_LONG");
    expect(checkDraft({ headline: "x", body: "ب".repeat(601) }, SRC).map((p) => p.code)).toContain("BODY_LONG");
  });
});

describe("captionFor", () => {
  it("ends every caption with the source and its link", () => {
    expect(captionFor({ headline: " سەردێڕ ", body: "دەق " }, { name: "ڕووداو", url: "https://example.com/a" })).toBe(
      "سەردێڕ\n\nدەق\n\nسەرچاوە: ڕووداو\nhttps://example.com/a",
    );
  });
});
