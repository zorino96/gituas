import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sourceCache: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    newsSettings: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    newsSource: { findMany: vi.fn(), updateMany: vi.fn() },
    newsItem: { findMany: vi.fn(), createMany: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/news/classify", () => ({ classifyPending: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/news/sources/rss", () => ({ fetchFeedConditional: vi.fn() }));

import { cached, ingest, pickNew, rssTtl } from "@/lib/news/ingest";
import { fetchFeedConditional } from "@/lib/news/sources/rss";
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

  it("passes the stored validators to the loader and stores the new ones from a 200", async () => {
    mockDb.sourceCache.findUnique.mockResolvedValue({ key: "k", items: [], fetchedAt: new Date(0), etag: '"v1"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" });
    const items: RawItem[] = [item("https://x", new Date("2026-01-01T00:00:00.000Z"))];
    const load = vi.fn().mockResolvedValue({ items, etag: '"v2"', lastModified: null });
    const r = await cached("k", 60_000, load);
    expect(load).toHaveBeenCalledWith({ etag: '"v1"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" });
    expect(r).toEqual({ items, error: null });
    const data = mockDb.sourceCache.upsert.mock.calls[0][0].update;
    expect(data).toMatchObject({ etag: '"v2"', lastModified: null });
  });

  it("asks with no validators when nothing is cached", async () => {
    mockDb.sourceCache.findUnique.mockResolvedValue(null);
    const load = vi.fn().mockResolvedValue([]);
    await cached("k", 60_000, load);
    expect(load).toHaveBeenCalledWith({ etag: null, lastModified: null });
  });

  it("on a 304 keeps the cached items, bumps fetchedAt and keeps the validators", async () => {
    const stored = [{ url: "https://x", title: "t", snippet: "s", publishedAt: "2026-01-01T00:00:00.000Z", lang: "en", sourceName: "X" }];
    mockDb.sourceCache.findUnique.mockResolvedValue({ key: "k", items: stored, fetchedAt: new Date(0), etag: '"v1"', lastModified: null });
    const load = vi.fn().mockResolvedValue({ items: null, etag: '"v1"', lastModified: null });
    const before = Date.now();
    const r = await cached("k", 60_000, load);
    expect(r.error).toBeNull();
    expect(r.items).toEqual([{ ...stored[0], publishedAt: new Date(stored[0].publishedAt) }]);
    expect(mockDb.sourceCache.upsert).not.toHaveBeenCalled();
    const call = mockDb.sourceCache.update.mock.calls[0][0];
    expect(call.where).toEqual({ key: "k" });
    expect(call.data.etag).toBe('"v1"');
    expect(call.data.fetchedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("throws when the fetch fails and there is no stale row", async () => {
    mockDb.sourceCache.findUnique.mockResolvedValue(null);
    const load = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(cached("k", 60_000, load)).rejects.toThrow("boom");
    expect(mockDb.sourceCache.update).not.toHaveBeenCalled();
  });
});

describe("rssTtl", () => {
  it("follows the plan interval but never goes under 30 seconds", () => {
    expect(rssTtl(300)).toBe(300_000);
    expect(rssTtl(120)).toBe(120_000);
    expect(rssTtl(30)).toBe(30_000);
    expect(rssTtl(5)).toBe(30_000);
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
    m.tenant.findUnique.mockResolvedValue({ plan: "MANUAL" });
    m.newsSettings.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(fetchFeedConditional).mockResolvedValue({
      items: [fresh("https://x/1", "خبر عن أربيل"), fresh("https://x/2", "خبر رياضي")],
      etag: null,
      lastModified: null,
    });
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
    expect(vi.mocked(fetchFeedConditional)).toHaveBeenCalledWith("https://feeds.bbci.co.uk/arabic/rss.xml", "BBC عربي", { etag: null, lastModified: null });
  });

  it("reports a catalog entry that no longer exists instead of fetching anything", async () => {
    setup({ keywordFilter: false, sources: [{ id: "s3", name: "Gone", catalogId: "no-such-feed", rssUrl: null }] });
    const r = await ingest("t1", { force: true });
    expect(vi.mocked(fetchFeedConditional)).not.toHaveBeenCalled();
    expect(r.failed).toEqual(["Gone"]);
  });

  describe("throttle", () => {
    const own = [{ id: "s1", name: "Own", catalogId: null, rssUrl: "https://own.example/rss" }];
    const NOW = 1_800_000_000_000;
    /** The cut-off the conditional claim compares lastFetchedAt against. */
    const cutoff = () => {
      const where = m.newsSettings.updateMany.mock.calls[0][0].where;
      return (where.OR[1].lastFetchedAt.lt as Date).getTime();
    };

    async function claimFor(plan: string | null, opts: { graceMs?: number } = {}) {
      setup({ keywordFilter: false, sources: own });
      m.tenant.findUnique.mockResolvedValue(plan === null ? null : { plan });
      const spy = vi.spyOn(Date, "now").mockReturnValue(NOW);
      try {
        await ingest("t1", opts);
      } finally {
        spy.mockRestore();
      }
      return cutoff();
    }

    it("lets a page be fetched again after its plan interval", async () => {
      expect(await claimFor("ENTERPRISE")).toBe(NOW - 30_000);
      expect(await claimFor("AUTO")).toBe(NOW - 60_000);
      expect(await claimFor("MANUAL")).toBe(NOW - 120_000);
      expect(await claimFor("LITE")).toBe(NOW - 300_000);
    });

    it("treats a missing tenant like MANUAL", async () => {
      expect(await claimFor(null)).toBe(NOW - 120_000);
    });

    it("shortens the interval by the grace the background clock asks for", async () => {
      expect(await claimFor("LITE", { graceMs: 20_000 })).toBe(NOW - 280_000);
      expect(await claimFor("ENTERPRISE", { graceMs: 60_000 })).toBe(NOW);
    });

    it("skips the fetch when another caller already claimed it", async () => {
      setup({ keywordFilter: false, sources: own });
      m.newsSettings.updateMany.mockResolvedValue({ count: 0 });
      const r = await ingest("t1");
      expect(r).toEqual({ added: 0, failed: [], skipped: true });
      expect(vi.mocked(fetchFeedConditional)).not.toHaveBeenCalled();
    });

    it("a forced refresh ignores the interval and claims unconditionally", async () => {
      setup({ keywordFilter: false, sources: own });
      await ingest("t1", { force: true });
      expect(m.newsSettings.updateMany).not.toHaveBeenCalled();
      expect(m.newsSettings.update).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetchFeedConditional)).toHaveBeenCalledTimes(1);
    });

    it("gives the feed cache the plan interval as its time to live", async () => {
      setup({ keywordFilter: false, sources: own });
      m.tenant.findUnique.mockResolvedValue({ plan: "LITE" });
      // A cache row 200 s old: fresh for a 300 s plan, so nothing is fetched.
      m.sourceCache.findUnique.mockResolvedValue({ key: "rss:https://own.example/rss", items: [], fetchedAt: new Date(Date.now() - 200_000), etag: null, lastModified: null });
      await ingest("t1", { force: true });
      expect(vi.mocked(fetchFeedConditional)).not.toHaveBeenCalled();
      // The same row is stale for a 60 s plan.
      m.tenant.findUnique.mockResolvedValue({ plan: "AUTO" });
      await ingest("t1", { force: true });
      expect(vi.mocked(fetchFeedConditional)).toHaveBeenCalledTimes(1);
    });
  });
});
