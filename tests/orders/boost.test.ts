import { describe, expect, it } from "vitest";

import { evidenceLines, sampleLines } from "@/lib/boost/analyze";
import { baghdadDay, cachePath, emptyCache, postKey, rollDay, withAnalysis, type SavedAnalysis } from "@/lib/boost/cache";
import { parseAdvice } from "@/lib/orders/post-advice";

const advice = parseAdvice({ bestPlatform: "IG", observations: ["خەڵک زۆر پرسیاری نرخ دەکەن"] }, ["SUL"], false)!;
const saved = (at: string): SavedAnalysis => ({ at, advice, basedOn: { likes: 10, comments: 2, messages: 1, orders: 0 } });

describe("boost: one post's evidence", () => {
  it("keeps distinct comments, without names, numbers or handles", () => {
    const lines = sampleLines(["@aram بە چەندە؟", "بە چەندە؟", "  ", null, "ژمارەم 0750 123 4567 ـە", "ok"], 10);
    expect(lines).toEqual(["بە چەندە؟", "ژمارەم ـە", "ok"]);
    expect(sampleLines(Array.from({ length: 40 }, (_, i) => `comment ${String.fromCharCode(97 + (i % 26))}${i}`), 5)).toHaveLength(5);
  });

  it("tells the AI what the post brought, and says when no product is linked", () => {
    const e = evidenceLines({ createdAt: "2026-10-01", likes: 120, comments: ["نرخ؟"], commentCount: 7, messages: [], messageCount: 0, orders: 3, cities: ["SUL", "EBL"], productName: null });
    expect(e[0]).toBe("PUBLISHED: 2026-10-01; LIKES: 120; COMMENTS: 7");
    expect(e).toContain("LINKED PRODUCT: none (the shop has not linked a product to this post)");
    expect(e).toContain("- نرخ؟");
    expect(e.at(-1)).toBe("ORDERS FROM THIS POST OR ITS PRODUCT (last 90 days): 3; buyer cities: SUL, EBL");
    expect(e.some((l) => l.startsWith("MESSAGES (sample"))).toBe(false);
  });

  it("reads the AI's observations, and gives none when it sends none", () => {
    expect(advice.observations).toEqual(["خەڵک زۆر پرسیاری نرخ دەکەن"]);
    expect(parseAdvice({ bestPlatform: "FB" }, [], true)!.observations).toEqual([]);
  });
});

describe("boost: saved analyses and the daily allowance", () => {
  it("counts per Baghdad day and keeps the analyses when the day turns", () => {
    const evening = Date.UTC(2026, 9, 12, 20, 30); // 23:30 in Baghdad
    expect(baghdadDay(evening)).toBe("2026-10-12");
    expect(baghdadDay(evening + 60 * 60 * 1000)).toBe("2026-10-13");
    const c = withAnalysis(emptyCache(evening), postKey("IG", "1"), saved("2026-10-12T20:00:00Z"));
    expect(c.used).toBe(1);
    const next = rollDay(c, evening + 60 * 60 * 1000);
    expect(next.used).toBe(0);
    expect(next.posts["IG:1"]).toBeDefined();
    expect(rollDay(c, evening)).toBe(c);
  });

  it("keeps only the newest analyses", () => {
    let c = emptyCache();
    for (let i = 0; i < 130; i++) c = withAnalysis(c, `FB:${i}`, saved(new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()));
    expect(Object.keys(c.posts)).toHaveLength(120);
    expect(c.posts["FB:0"]).toBeUndefined();
    expect(c.posts["FB:129"]).toBeDefined();
  });

  it("stores them at a path that cannot be guessed from the shop id", () => {
    expect(cachePath("cmshop", "s1")).toMatch(/^merchant\/cmshop\/boost\/[0-9a-f]{24}\.json$/);
    expect(cachePath("cmshop", "s1")).not.toBe(cachePath("cmshop", "s2"));
  });
});
