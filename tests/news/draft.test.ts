import { describe, it, expect } from "vitest";
import { buildUserPrompt, validateDraft } from "@/lib/news/draft";

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
  it("downgrades STAT without a number and QUOTE without a speaker", () => {
    expect(validateDraft({ ...base, cardKind: "STAT" })!.cardKind).toBe("STANDARD");
    expect(validateDraft({ ...base, cardKind: "QUOTE", quote: "وتە" })!.cardKind).toBe("STANDARD");
    const q = validateDraft({ ...base, cardKind: "QUOTE", quote: "وتە", speaker: "وەزارەت" })!;
    expect(q).toMatchObject({ cardKind: "QUOTE", quote: "وتە", speaker: "وەزارەت", stat: null });
  });
});

describe("buildUserPrompt", () => {
  it("says when there is no snippet", () => {
    expect(buildUserPrompt({ sourceName: "GDELT", title: "T", snippet: "" })).toBe("Source: GDELT\nHeadline: T\nSnippet: (none)");
  });
});
