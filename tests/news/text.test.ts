import { describe, it, expect } from "vitest";
import { guessLang, jaccard, matchesKeywords, normalizeForMatch, shingles, stripHtml, words } from "@/lib/news/text";

describe("stripHtml", () => {
  it("removes tags, decodes entities and collapses space", () => {
    expect(stripHtml('<p>عاجل: &quot;خبر&quot; &amp; تفاصيل</p>\n<img src="x">')).toBe('عاجل: "خبر" & تفاصيل');
  });
  it("decodes numeric entities", () => {
    expect(stripHtml("A&#39;s &#x41;")).toBe("A's A");
  });
  it("does not throw on an out-of-range numeric entity, and leaves it alone", () => {
    expect(() => stripHtml("x &#99999999; y")).not.toThrow();
    expect(stripHtml("x &#99999999; y")).toBe("x &#99999999; y");
  });
  it("does not let a decimal entity absorb a stray hex letter", () => {
    // "&#3f;" is only valid as hex with an x-prefix; it must not be parsed as decimal "3".
    expect(stripHtml("value &#3f; end")).toBe("value &#3f; end");
  });
  it("decodes the additional named entities", () => {
    expect(stripHtml("&lsquo;hi&rsquo; &ldquo;yo&rdquo; &laquo;x&raquo; A&ndash;B A&mdash;B&hellip;")).toBe(
      "‘hi’ “yo” «x» A–B A—B…",
    );
  });
});

describe("normalizeForMatch", () => {
  it("makes Arabic and Kurdish letter variants meet", () => {
    expect(normalizeForMatch("علي")).toBe(normalizeForMatch("علی"));
    expect(normalizeForMatch("ڕووداو")).toBe(normalizeForMatch("رووداو"));
  });
  it("turns Eastern Arabic digits into ASCII and drops punctuation", () => {
    expect(normalizeForMatch("٢٠٢٦، هەولێر!")).toBe(normalizeForMatch("2026 هەولێر"));
  });
  it("removes zero-width joiners so a suffixed word stays one word", () => {
    expect(normalizeForMatch("کوردستان‌ی")).toBe(normalizeForMatch("کوردستانی"));
    expect(normalizeForMatch("کورد‍ستان")).toBe(normalizeForMatch("کوردستان"));
  });
});

describe("guessLang", () => {
  it("tells Kurdish, Arabic and English apart", () => {
    expect(guessLang("هەواڵی هەولێر")).toBe("ku");
    expect(guessLang("أخبار العراق")).toBe("ar");
    expect(guessLang("Iraq news")).toBe("en");
  });
});

describe("jaccard and shingles", () => {
  it("measures word overlap", () => {
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBe(0.5);
    expect(jaccard([], [])).toBe(0);
  });
  it("builds n-grams", () => {
    expect([...shingles(["a", "b", "c", "d"], 3)]).toEqual(["a b c", "b c d"]);
    expect(words("  Hello, World ")).toEqual(["hello", "world"]);
  });
});

describe("matchesKeywords", () => {
  it("matches any keyword, including inside Kurdish suffixed words", () => {
    expect(matchesKeywords("نرخی ئاڵتوون لە هەولێری پایتەخت", ["هەولێر"])).toBe(true);
    expect(matchesKeywords("نرخی ئاڵتوون", ["دهۆک"])).toBe(false);
    expect(matchesKeywords("anything", [])).toBe(true);
  });
  it("requires an all-ASCII keyword to match at a word start", () => {
    expect(matchesKeywords("this is our business plan", ["us"])).toBe(false);
    expect(matchesKeywords("the US embassy said", ["us"])).toBe(true);
  });
});
