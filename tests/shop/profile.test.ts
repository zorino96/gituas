import { afterEach, describe, expect, it } from "vitest";

import { factText, PROFILE_LINES_MAX_CHARS, profileEnabled, profileLines, sanitizePatch, type Profile } from "@/lib/shop/profile";

const base: Profile = {
  storeId: "s1",
  goal: "sell",
  goalText: null,
  category: "fashion",
  offerLine: "جلی ژنانەی ئەوروپی",
  customer: ["women"],
  sellsTo: ["erbil", "duhok"],
  language: "ckb",
  tone: "friendly",
  facts: [
    { k: "payment", v: "cod", on: true },
    { k: "returns", v: "exchange", on: false },
  ],
  interview: { step: 0, answered: [], skipped: [] },
};

afterEach(() => {
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("sanitizePatch", () => {
  it("keeps only known ids and cleans typed lines", () => {
    const p = sanitizePatch({ goal: "grow", category: "content", customer: ["women", "aliens"], tone: "pirate", offerLine: "  جل‏   و بەرگ \n ", sellsTo: ["erbil", "mars"] });
    expect(p).toEqual({ goal: "grow", category: "content", customer: ["women"], tone: null, offerLine: "جل و بەرگ", sellsTo: ["erbil"] });
  });

  it("touches only the fields that are sent", () => {
    expect(sanitizePatch({ tone: "formal" })).toEqual({ tone: "formal" });
    expect(sanitizePatch(null)).toEqual({});
  });

  it("cuts a typed line to its length", () => {
    expect(sanitizePatch({ offerLine: "ا".repeat(500) }).offerLine?.length).toBe(140);
  });

  it("refuses a typed fact with a link, a handle or a phone number, and keeps three typed facts at most", () => {
    const facts = [
      { k: "custom", v: "هەموو شتێک بە گەرەنتییە", on: true },
      { k: "custom", v: "پەیوەندی: 0770 123 4567", on: true },
      { k: "custom", v: "https://example.com/offer", on: true },
      { k: "custom", v: "@myshop_iq", on: true },
      { k: "custom", v: "گەیاندن بێ بەرامبەر بۆ هەولێر", on: false },
      { k: "custom", v: "یەک", on: true },
      { k: "custom", v: "دوو", on: true },
      { k: "payment", v: "cod", on: true },
      { k: "payment", v: "bitcoin", on: true },
    ];
    const out = sanitizePatch({ facts }).facts!;
    expect(out.filter((f) => f.k === "custom").map((f) => f.v)).toEqual(["هەموو شتێک بە گەرەنتییە", "گەیاندن بێ بەرامبەر بۆ هەولێر", "یەک"]);
    expect(out.filter((f) => f.k === "payment")).toEqual([{ k: "payment", v: "cod", on: true }]);
  });

  it("a fact is off unless the owner switched it on", () => {
    expect(sanitizePatch({ facts: [{ k: "returns", v: "none" }] }).facts).toEqual([{ k: "returns", v: "none", on: false }]);
  });
});

describe("facts in the buyer's language", () => {
  it("writes a chip fact in the language asked for", () => {
    expect(factText({ k: "payment", v: "cod", on: true }, "ar")).toContain("عند الاستلام");
    expect(factText({ k: "payment", v: "cod", on: true }, "ckb")).toContain("گەیاندن");
    expect(factText({ k: "payment", v: "cod", on: true }, "kmr")).toContain("گەیاندن");
    expect(factText({ k: "returns", v: "unknown", on: true }, "en")).toBeNull();
  });
});

describe("profileLines", () => {
  it("is empty without a profile and says only switched-on facts", () => {
    expect(profileLines(null, { lang: "ckb", audience: "buyer" })).toEqual([]);
    const text = profileLines(base, { lang: "ckb", audience: "buyer" }).join("\n");
    expect(text).toContain("clothes and fashion");
    expect(text).toContain("Erbil, Duhok");
    expect(text).toContain("پارەدان لە کاتی گەیاندندا");
    expect(text).not.toContain("دەگۆڕدرێتەوە");
    expect(text).not.toContain("goal");
  });

  it("gives the goal to the owner's own tools only", () => {
    const p = { ...base, goalText: "ببمە بەناوبانگ" };
    expect(profileLines(p, { lang: "ckb", audience: "owner" }).join("\n")).toContain("ببمە بەناوبانگ");
    expect(profileLines(p, { lang: "ckb", audience: "buyer" }).join("\n")).not.toContain("ببمە بەناوبانگ");
  });

  it("stays under the cap, cutting the description before the facts", () => {
    const p: Profile = { ...base, offerLine: "ب".repeat(140), facts: [{ k: "custom", v: "پ".repeat(160), on: true }, { k: "custom", v: "ت".repeat(160), on: true }, { k: "custom", v: "ث".repeat(160), on: true }, { k: "payment", v: "cod", on: true }] };
    const lines = profileLines(p, { lang: "ckb", audience: "buyer" });
    expect(lines.join("\n").length).toBeLessThanOrEqual(PROFILE_LINES_MAX_CHARS);
    expect(lines.some((l) => l.startsWith("The owner confirmed"))).toBe(true);
  });
});

describe("the switch", () => {
  it("is off unless BUSINESS_PROFILE_ENABLED=1", () => {
    expect(profileEnabled()).toBe(false);
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    expect(profileEnabled()).toBe(true);
  });
});
