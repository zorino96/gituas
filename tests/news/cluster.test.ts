import { describe, it, expect } from "vitest";
import { clusterKeyFor, groupByCluster } from "@/lib/news/cluster";

const t0 = new Date("2026-09-26T10:00:00Z");

describe("clusterKeyFor", () => {
  const recent = [{ title: "Earthquake of 4.2 hits Duhok border area", lang: "en", publishedAt: t0, clusterKey: "cA" }];

  it("joins the same story told with nearly the same words", () => {
    const item = { url: "https://b.example/x", title: "Earthquake of 4.2 hits Duhok border", lang: "en", publishedAt: new Date(t0.getTime() + 3600_000) };
    expect(clusterKeyFor(item, recent)).toBe("cA");
  });
  it("keeps other languages apart", () => {
    const item = { url: "https://b.example/y", title: "Earthquake of 4.2 hits Duhok border area", lang: "ar", publishedAt: t0 };
    expect(clusterKeyFor(item, recent)).not.toBe("cA");
  });
  it("keeps stories two days apart apart", () => {
    const item = { url: "https://b.example/z", title: "Earthquake of 4.2 hits Duhok border area", lang: "en", publishedAt: new Date(t0.getTime() + 49 * 3600_000) };
    expect(clusterKeyFor(item, recent)).not.toBe("cA");
  });
  it("gives a new story a stable key from its URL", () => {
    const item = { url: "https://c.example/new", title: "Something else entirely", lang: "en", publishedAt: t0 };
    expect(clusterKeyFor(item, recent)).toBe(clusterKeyFor(item, []));
  });
});

describe("groupByCluster", () => {
  it("keeps the first item of each cluster as its lead and counts the rest", () => {
    const g = groupByCluster([
      { id: 1, clusterKey: "a" },
      { id: 2, clusterKey: "b" },
      { id: 3, clusterKey: "a" },
    ]);
    expect(g).toEqual([
      { lead: { id: 1, clusterKey: "a" }, count: 2 },
      { lead: { id: 2, clusterKey: "b" }, count: 1 },
    ]);
  });
});
