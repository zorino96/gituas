import { describe, it, expect } from "vitest";
import { buildUserPrompt, DRAFT_SYSTEM, validateDraft } from "@/lib/news/draft";
import { CATEGORIES } from "@/lib/news/types";

describe("validateDraft", () => {
  const base = { headline: " سەردێڕ ", body: "دەق.", category: "ئابووری", cardKind: "STANDARD", stat: null, quote: null, speaker: null };

  it("accepts a good draft and trims it", () => {
    expect(validateDraft(base)).toEqual({ ...base, headline: "سەردێڕ", cardKind: "STANDARD" });
  });
  it("rejects a draft without a headline or body", () => {
    expect(validateDraft({ ...base, headline: "" })).toBeNull();
    expect(validateDraft({ ...base, body: 3 })).toBeNull();
    expect(validateDraft("nope")).toBeNull();
  });
  it("falls back to گشتی for an unknown category and STANDARD for an unknown kind", () => {
    const d = validateDraft({ ...base, category: "Sports", cardKind: "HERO" })!;
    expect(d.category).toBe("گشتی");
    expect(d.cardKind).toBe("STANDARD");
  });
  it("matches a category spelled with the Arabic ي to the canonical Kurdish ی spelling", () => {
    // "سياسەت" spelled with Arabic ي (U+064A) instead of Kurdish ی (U+06CC).
    const arabicSpelling = "سياسەت";
    const d = validateDraft({ ...base, category: arabicSpelling })!;
    expect(d.category).toBe(CATEGORIES[0]);
    expect(d.category).toBe("سیاسەت");
  });
  it("accepts a numeric stat and converts it to a string", () => {
    const d = validateDraft({ ...base, cardKind: "STAT", stat: 42 })!;
    expect(d.cardKind).toBe("STAT");
    expect(d.stat).toBe("42");
  });
  it("downgrades STAT without a number and QUOTE without a speaker", () => {
    expect(validateDraft({ ...base, cardKind: "STAT" })!.cardKind).toBe("STANDARD");
    expect(validateDraft({ ...base, cardKind: "QUOTE", quote: "وتە" })!.cardKind).toBe("STANDARD");
    const q = validateDraft({ ...base, cardKind: "QUOTE", quote: "وتە", speaker: "وەزارەت" })!;
    expect(q).toMatchObject({ cardKind: "QUOTE", quote: "وتە", speaker: "وەزارەت", stat: null });
  });
});

describe("buildUserPrompt", () => {
  it("puts the source text between clear markers and says when there is no snippet", () => {
    expect(buildUserPrompt({ sourceName: "GDELT", title: "T", snippet: "" })).toBe(
      "Source: GDELT\n--- BEGIN SOURCE TEXT ---\nHeadline: T\nSnippet: (none)\n--- END SOURCE TEXT ---",
    );
  });
});

describe("DRAFT_SYSTEM", () => {
  it("lists every category, including the گشتی fallback", () => {
    for (const c of CATEGORIES) expect(DRAFT_SYSTEM).toContain(c);
  });
  it("tells the model the marked source text is data, not instructions", () => {
    expect(DRAFT_SYSTEM).toContain("--- BEGIN SOURCE TEXT ---");
    expect(DRAFT_SYSTEM).toMatch(/data.*never instructions|never instructions.*data/i);
  });
});
