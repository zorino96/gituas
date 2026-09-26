import { describe, it, expect } from "vitest";
import { attributionFor, captionFor, captionWithAttribution, checkDraft, overlapRatio, sequenceRatio } from "@/lib/news/rules";

const SRC = {
  title: "بەغدا و کوەیت لاپەڕەیەکی نوێ",
  snippet: "عێراق و کوەیت لەسەر پێکهێنانی لیژنەیەکی هاوبەش بۆ یەکلاکردنەوەی دۆسیە هەڵپەسێردراوەکان رێککەوتن",
};

describe("overlapRatio", () => {
  it("is 1 for a copy and 0 for unrelated text", () => {
    expect(overlapRatio(SRC.snippet, SRC.snippet)).toBe(1);
    expect(overlapRatio("Gold prices rose in Erbil markets this week", SRC.snippet)).toBe(0);
  });
  it("compares whole words in the short-text branch, not a substring", () => {
    // "ئاو" is a substring of "ئاوارەکان" but is not the same word.
    expect(overlapRatio("ئاو", "کەمپی ئاوارەکان")).toBe(0);
    expect(overlapRatio("ئاوارەکان", "کەمپی ئاوارەکان")).toBe(1);
  });
});

describe("sequenceRatio", () => {
  it("is the longest common subsequence over the text's word count", () => {
    expect(sequenceRatio(SRC.title, SRC.title)).toBe(1);
    expect(sequenceRatio("Gold prices rose", SRC.snippet)).toBe(0);
  });
  it("is 0 when either side is empty", () => {
    expect(sequenceRatio("", SRC.title)).toBe(0);
    expect(sequenceRatio(SRC.title, "")).toBe(0);
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
  it("blocks a headline copied verbatim from the source title, even with an own body", () => {
    const d = {
      headline: SRC.title,
      body: "هەولێر شارێکی زۆر کۆن و مێژووییە کە هەزاران گەشتیار ساڵانە سەردانی ئەم شارە بەناوبانگە دەکەن",
    };
    expect(checkDraft(d, SRC).map((p) => p.code)).toContain("COPY");
  });
  it("blocks a near-copy body that only changes a few words", () => {
    const d = {
      headline: "هەواڵێکی گرنگ لە هەرێم",
      body: "عێراق و کوەیت لەبارەی پێکهێنانی لیژنەیەکی هاوبەش بۆ چارەسەرکردنی دۆسیە هەڵپەسێردراوەکان ڕێککەوتوون",
    };
    expect(checkDraft(d, SRC).map((p) => p.code)).toContain("COPY");
  });
  it("passes a genuinely restated Kurdish draft of the same story", () => {
    const d = {
      headline: "عێراق و کوەیت لەسەر دۆسیەی ئاوارەکان ڕێککەوتن",
      body: "وەزارەتی دەرەوەی عێراق ڕایگەیاند کە لەگەڵ کوەیت لیژنەیەکی هاوبەشیان پێکهێناوە بۆ چارەسەرکردنی کێشە کۆنەکانی نێوان هەردوو وڵات",
    };
    expect(checkDraft(d, SRC).map((p) => p.code)).not.toContain("COPY");
  });
  it("does not flag a short draft as COPY from a partial-word match in the source", () => {
    const d = { headline: "هەولێر ئاو", body: "هەولێر ئاو" };
    const src = { title: "دۆزینەوەی کەمپی ئاوارەکان", snippet: "" };
    expect(checkDraft(d, src).map((p) => p.code)).not.toContain("COPY");
  });
});

describe("captionFor", () => {
  it("ends every caption with the source and its link", () => {
    expect(captionFor({ headline: " سەردێڕ ", body: "دەق " }, { name: "ڕووداو", url: "https://example.com/a" })).toBe(
      "سەردێڕ\n\nدەق\n\nسەرچاوە: ڕووداو\nhttps://example.com/a",
    );
  });
});

describe("attributionFor", () => {
  it("is the source name and its link, on their own lines", () => {
    expect(attributionFor({ name: "ڕووداو", url: "https://example.com/a" })).toBe("سەرچاوە: ڕووداو\nhttps://example.com/a");
  });
});

describe("captionWithAttribution", () => {
  it("appends the attribution to the typed caption, trimmed", () => {
    expect(captionWithAttribution("  دەقێکی نوێ  ", { name: "ڕووداو", url: "https://example.com/a" })).toBe(
      "دەقێکی نوێ\n\nسەرچاوە: ڕووداو\nhttps://example.com/a",
    );
  });
  it("ignores whatever the client typed as its own suffix — it only ever appends the server's own line", () => {
    const withFakeSuffix = "دەقێک\n\nسەرچاوە: هەڵە\nhttps://evil.example";
    expect(captionWithAttribution(withFakeSuffix, { name: "ڕاستەقینە", url: "https://example.com/real" })).toBe(
      `${withFakeSuffix}\n\nسەرچاوە: ڕاستەقینە\nhttps://example.com/real`,
    );
  });
});
