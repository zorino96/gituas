import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sourceCache: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    newsSettings: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    newsSource: { findMany: vi.fn(), updateMany: vi.fn() },
    newsItem: { findMany: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock("@/lib/news/classify", () => ({ classifyPending: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/news/sources/rss", () => ({ fetchFeed: vi.fn() }));

import { cached, ingest, pickNew } from "@/lib/news/ingest";
import { fetchFeed } from "@/lib/news/sources/rss";
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

describe("ingest", () => {
  const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  const fresh = (url: string, title: string): RawItem => ({ url, title, snippet: "", publishedAt: new Date(), lang: "ar", sourceName: "feed" });

  function setup(opts: { keywordFilter: boolean; sources: Array<{ id: string; name: string; catalogId: string | null; rssUrl: string | null }> }) {
    vi.clearAllMocks();
    m.newsSettings.upsert.mockResolvedValue({ keywords: ["أربيل"], keywordFilter: opts.keywordFilter });
    m.newsSettings.update.mockResolvedValue({});
    m.newsSource.findMany.mockResolvedValue(opts.sources.map((s) => ({ ...s, enabled: true, lastError: null })));
    m.newsSource.updateMany.mockResolvedValue({ count: 1 });
    m.sourceCache.findUnique.mockResolvedValue(null);
    m.sourceCache.upsert.mockResolvedValue({});
    m.newsItem.findMany.mockResolvedValue([]);
    m.newsItem.createMany.mockResolvedValue({ count: 1 });
    vi.mocked(fetchFeed).mockResolvedValue([fresh("https://x/1", "خبر عن أربيل"), fresh("https://x/2", "خبر رياضي")]);
  }
  const stored = () => m.newsItem.createMany.mock.calls.map((c) => c[0].data[0].title);

  it("keeps every RSS story when the keyword filter is off", async () => {
    setup({ keywordFilter: false, sources: [{ id: "s1", name: "Own", catalogId: null, rssUrl: "https://own.example/rss" }] });
    await ingest("t1", { force: true });
    expect(stored().sort()).toEqual(["خبر رياضي", "خبر عن أربيل"].sort());
  });

  it("keeps only keyword matches when the keyword filter is on", async () => {
    setup({ keywordFilter: true, sources: [{ id: "s1", name: "Own", catalogId: null, rssUrl: "https://own.example/rss" }] });
    await ingest("t1", { force: true });
    expect(stored()).toEqual(["خبر عن أربيل"]);
  });

  it("fetches a catalog feed from the catalog's address", async () => {
    setup({ keywordFilter: false, sources: [{ id: "s2", name: "BBC عربي", catalogId: "bbc-ar", rssUrl: null }] });
    await ingest("t1", { force: true });
    expect(vi.mocked(fetchFeed)).toHaveBeenCalledWith("https://feeds.bbci.co.uk/arabic/rss.xml", "BBC عربي");
  });

  it("reports a catalog entry that no longer exists instead of fetching anything", async () => {
    setup({ keywordFilter: false, sources: [{ id: "s3", name: "Gone", catalogId: "no-such-feed", rssUrl: null }] });
    const r = await ingest("t1", { force: true });
    expect(vi.mocked(fetchFeed)).not.toHaveBeenCalled();
    expect(r.failed).toEqual(["Gone"]);
  });
});
