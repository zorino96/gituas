import { afterEach, describe, expect, it } from "vitest";

import { factText, hasLinkOrPhone, mergeFacts, PROFILE_LINES_MAX_CHARS, profileEnabled, profileLines, sanitizePatch, type Profile } from "@/lib/shop/profile-shared";

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
  interview: { step: 0, answered: [], skipped: [], doneAt: "2026-10-16T10:00:00.000Z" },
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
  it("says nothing until the owner has finished the interview", () => {
    expect(profileLines({ ...base, interview: { step: 3, answered: [], skipped: [] } }, { lang: "ckb", audience: "buyer" })).toEqual([]);
  });

  it("is empty without a profile and says only switched-on facts", () => {
    expect(profileLines(null, { lang: "ckb", audience: "buyer" })).toEqual([]);
    const text = profileLines(base, { lang: "ckb", audience: "buyer" }).join("\n");
    expect(text).toContain("clothes and fashion");
    expect(text).toContain("Erbil, Duhok");
    expect(text).toContain("Usually delivers to");
    expect(text).toContain("پارەدان لە کاتی گەیاندندا");
    expect(text).not.toContain("دەگۆڕدرێتەوە");
    expect(text).not.toContain("goal");
  });

  it("gives the goal to the owner's own tools only", () => {
    const p = { ...base, goalText: "ببمە بەناوبانگ" };
    expect(profileLines(p, { lang: "ckb", audience: "owner" }).join("\n")).toContain("ببمە بەناوبانگ");
    expect(profileLines(p, { lang: "ckb", audience: "buyer" }).join("\n")).not.toContain("ببمە بەناوبانگ");
  });

  it("tells a public caption only what the page is about, never the facts, cities or goal", () => {
    const p = { ...base, goalText: "ببمە بەناوبانگ" };
    const text = profileLines(p, { lang: "ckb", audience: "caption" }).join("\n");
    expect(text).toContain("clothes and fashion");
    expect(text).not.toContain("پارەدان");
    expect(text).not.toContain("Erbil");
    expect(text).not.toContain("ببمە بەناوبانگ");
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

describe("hardening", () => {
  it("finds a phone number or link however it is written", () => {
    for (const t of ["0750.123.4567", "0750/123/4567", "0750,123,4567", "٠٧٥٠ ١٢٣ ٤٥٦٧", "07​750123456", "https://x.com/a", "shop.iq", "@my_shop"]) expect(hasLinkOrPhone(t), t).toBe(true);
    for (const t of ["جلی ژنانەی ئەوروپی", "24 hour service", "ئەگەر کێشەی هەبوو دەگۆڕدرێتەوە"]) expect(hasLinkOrPhone(t), t).toBe(false);
  });

  it("refuses a phone or link in the offer line and the goal, not only in typed facts", () => {
    expect(sanitizePatch({ offerLine: "پەیوەندی 07701234567" }).offerLine).toBeNull();
    expect(sanitizePatch({ goalText: "www.example.com" }).goalText).toBeNull();
  });

  it("keeps ten thousand duplicate facts to a handful, quickly", () => {
    const facts = Array.from({ length: 10_000 }, (_, i) => ({ k: i % 2 ? "payment" : "returns", v: i % 2 ? "cod" : "none", on: true }));
    const t0 = Date.now();
    const out = sanitizePatch({ facts }).facts!;
    expect(out.length).toBeLessThanOrEqual(9);
    expect(out.filter((f) => f.k === "returns").length).toBe(1);
    expect(Date.now() - t0).toBeLessThan(200);
    const lines = profileLines({ ...base, facts: Array.from({ length: 9 }, (_, i) => ({ k: "custom" as const, v: "ا".repeat(160) + i, on: true })) }, { lang: "ckb", audience: "buyer" });
    expect(lines.join("\n").length).toBeLessThanOrEqual(PROFILE_LINES_MAX_CHARS);
  });

  it("keeps one returns rule", () => {
    const out = sanitizePatch({ facts: [{ k: "returns", v: "none", on: true }, { k: "returns", v: "refund", on: true }] }).facts!;
    expect(out).toEqual([{ k: "returns", v: "none", on: true }]);
  });

  it("invisible characters cannot hide a link", () => {
    expect(sanitizePatch({ offerLine: "www​.example⁠.com" }).offerLine).toBeNull();
  });
});

describe("mergeFacts", () => {
  it("keeps what was confirmed, stores new ones off, drops removed ones, ignores the client's flags", () => {
    const previous = [{ k: "payment" as const, v: "cod", on: true }, { k: "returns" as const, v: "none", on: false }];
    const incoming = [{ k: "payment" as const, v: "cod", on: false }, { k: "payment" as const, v: "pickup", on: true }];
    expect(mergeFacts(previous, incoming)).toEqual([{ k: "payment", v: "cod", on: true }, { k: "payment", v: "pickup", on: false }]);
  });
});

describe("review follow-ups", () => {
  it("finds a phone number split by the Arabic comma, the Arabic thousands separator or a zero-width non-joiner", () => {
    for (const t of ["0750،123،4567", "0750٬123٬4567", "0750‌123‌4567", "0750٫123٫4567"]) expect(hasLinkOrPhone(t), t).toBe(true);
    expect(hasLinkOrPhone("جلی ژنانە، بەرگی هاوین، ٢٤ کاتژمێر")).toBe(false);
  });
});
