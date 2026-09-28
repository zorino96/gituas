import { describe, expect, it } from "vitest";
import { categoryLabel, categoryWhere, normalizeChoice, parseClassification, REGIONS, TAXONOMY } from "@/lib/news/taxonomy";

describe("taxonomy", () => {
  it("has unique category ids and unique sub ids inside each", () => {
    expect(new Set(TAXONOMY.map((c) => c.id)).size).toBe(TAXONOMY.length);
    for (const c of TAXONOMY) expect(new Set(c.subs.map((s) => s.id)).size).toBe(c.subs.length);
    expect(REGIONS.map((r) => r.id)).toEqual(["kurdistan", "iraq", "region", "world"]);
  });
});

describe("parseClassification", () => {
  it("accepts a known category, sub and region", () => {
    expect(parseClassification({ category: "economy", subcategory: "energy", region: "kurdistan" })).toEqual({
      category: "economy",
      subcategory: "energy",
      region: "kurdistan",
    });
  });
  it("drops a sub that doesn't belong to the category", () => {
    expect(parseClassification({ category: "sports", subcategory: "energy", region: "world" })?.subcategory).toBeNull();
  });
  it("falls back to 'other' and 'world' for unknown codes", () => {
    expect(parseClassification({ category: "weather", region: "mars" })).toEqual({ category: "other", subcategory: null, region: "world" });
  });
  it("rejects anything that isn't an object", () => {
    expect(parseClassification(null)).toBeNull();
    expect(parseClassification("economy")).toBeNull();
  });
});

describe("normalizeChoice", () => {
  it("keeps known entries, drops unknown ones and subs of a whole-chosen category", () => {
    expect(normalizeChoice(["economy", "economy/energy", "sports/football", "nope", "sports/nope"])).toEqual(["economy", "sports/football"]);
  });
});

describe("categoryWhere", () => {
  it("is empty when nothing is chosen (everything passes)", () => {
    expect(categoryWhere([])).toEqual({});
  });
  it("keeps unclassified stories and matches whole categories and subs", () => {
    expect(categoryWhere(["economy", "sports/football"])).toEqual({
      OR: [{ category: null }, { category: { in: ["economy"] } }, { category: "sports", subcategory: "football" }],
    });
  });
});

describe("categoryLabel", () => {
  it("names a category and its sub in Kurdish", () => {
    expect(categoryLabel("economy", "energy")).toBe("ئابووری · نەوت و وزە");
    expect(categoryLabel("health", null)).toBe("تەندروستی");
    expect(categoryLabel(null, null)).toBeNull();
  });
});
