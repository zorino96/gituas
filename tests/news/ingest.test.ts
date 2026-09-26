import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sourceCache: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    newsSettings: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    newsSource: { findMany: vi.fn(), updateMany: vi.fn() },
    newsItem: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { cached, pickNew } from "@/lib/news/ingest";
import { db } from "@/lib/db";
import type { RawItem } from "@/lib/news/types";

// The mocked db is untyped (a plain vi.fn() per method); this local view avoids
// fighting Prisma's generic, select-narrowed return types in a test file.
const mockDb = db as unknown as {
  sourceCache: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const item = (url: string, publishedAt: Date): RawItem => ({
  url,
  title: "t",
  snippet: "s",
  publishedAt,
  lang: "en",
  sourceName: "X",
});

describe("cached", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the cached items without fetching when still fresh", async () => {
    mockDb.sourceCache.findUnique.mockResolvedValue({ key: "k", items: [], fetchedAt: new Date() });
    const load = vi.fn();
    const r = await cached("k", 60_000, load);
    expect(load).not.toHaveBeenCalled();
    expect(r).toEqual({ items: [], error: null });
  });

  it("fetches, stores, and returns items on a fresh fetch", async () => {
    mockDb.sourceCache.findUnique.mockResolvedValue(null);
    const items: RawItem[] = [item("https://x", new Date("2026-01-01T00:00:00.000Z"))];
    const load = vi.fn().mockResolvedValue(items);
    const r = await cached("k", 60_000, load);
    expect(r).toEqual({ items, error: null });
    expect(mockDb.sourceCache.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns stale items and the error, and backs off the retry, when the fetch fails but a row exists", async () => {
    const FIXED_NOW = 1_800_000_000_000;
    const ttl = 600_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    const stale = [{ url: "https://x", title: "t", snippet: "s", publishedAt: "2026-01-01T00:00:00.000Z", lang: "en", sourceName: "X" }];
    mockDb.sourceCache.findUnique.mockResolvedValue({ key: "k", items: stale, fetchedAt: new Date(FIXED_NOW - ttl - 1) });
    const load = vi.fn().mockRejectedValue(new Error("boom"));

    const r = await cached("k", ttl, load);

    expect(r.error).toBe("boom");
    expect(r.items).toEqual([{ ...stale[0], publishedAt: new Date(stale[0].publishedAt) }]);
    expect(mockDb.sourceCache.update).toHaveBeenCalledWith({
      where: { key: "k" },
      data: { fetchedAt: new Date(FIXED_NOW - ttl + 60_000) },
    });
    nowSpy.mockRestore();
  });

  it("throws when the fetch fails and there is no stale row", async () => {
    mockDb.sourceCache.findUnique.mockResolvedValue(null);
    const load = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(cached("k", 60_000, load)).rejects.toThrow("boom");
    expect(mockDb.sourceCache.update).not.toHaveBeenCalled();
  });
});

describe("pickNew", () => {
  const now = Date.now();

  it("drops candidates already stored for this tenant, without spending the cap on them", () => {
    const candidates = [item("https://a", new Date(now)), item("https://b", new Date(now))];
    const result = pickNew(candidates, new Set(["https://a"]), now, 1);
    expect(result.map((i) => i.url)).toEqual(["https://b"]);
  });

  it("keeps a duplicate URL within one fetch only once", () => {
    const candidates = [item("https://a", new Date(now)), item("https://a", new Date(now - 1000))];
    const result = pickNew(candidates, new Set(), now, 100);
    expect(result).toHaveLength(1);
  });

  it("drops items older than the max age", () => {
    const candidates = [item("https://old", new Date(now - 10 * 24 * 60 * 60 * 1000)), item("https://new", new Date(now))];
    const result = pickNew(candidates, new Set(), now, 100);
    expect(result.map((i) => i.url)).toEqual(["https://new"]);
  });

  it("sorts newest first and caps the result", () => {
    const candidates = [item("https://a", new Date(now - 3000)), item("https://b", new Date(now - 1000)), item("https://c", new Date(now - 2000))];
    const result = pickNew(candidates, new Set(), now, 2);
    expect(result.map((i) => i.url)).toEqual(["https://b", "https://c"]);
  });
});
