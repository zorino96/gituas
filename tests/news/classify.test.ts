import { describe, expect, it } from "vitest";
import { classifyPrompt, parseBatch } from "@/lib/news/classify";

describe("classifyPrompt", () => {
  it("numbers every headline and lists the taxonomy", () => {
    const p = classifyPrompt([{ title: "Oil exports resume", snippet: "Erbil and Baghdad agree" }, { title: "هەولێر یاری دەباتەوە", snippet: "" }]);
    expect(p.user).toContain("0. Oil exports resume — Erbil and Baghdad agree");
    expect(p.user).toContain("1. هەولێر یاری دەباتەوە");
    expect(p.system).toContain("economy (energy, salaries, markets, trade)");
    expect(p.system).toContain("kurdistan");
  });
});

describe("parseBatch", () => {
  it("maps answers back by index and marks missing ones 'other'", () => {
    const out = parseBatch({ items: [{ i: 1, category: "sports", subcategory: "football", region: "world" }] }, 2);
    expect(out).toEqual([
      { category: "other", subcategory: null, region: "world" },
      { category: "sports", subcategory: "football", region: "world" },
    ]);
  });
  it("ignores out-of-range indexes", () => {
    const out = parseBatch({ items: [{ i: 5, category: "sports", region: "world" }, { i: 0, category: "health", region: "iraq" }] }, 1);
    expect(out).toEqual([{ category: "health", subcategory: null, region: "iraq" }]);
  });
  it("rejects a reply with no usable entry, so the call is retried", () => {
    expect(parseBatch({ items: [] }, 2)).toBeNull();
    expect(parseBatch({ nope: 1 }, 2)).toBeNull();
  });
});
