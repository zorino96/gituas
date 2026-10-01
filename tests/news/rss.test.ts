import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { lookup } from "node:dns/promises";
import { conditionalHeaders, fetchFeed, fetchFeedConditional, isPrivateAddress, parseFeed } from "@/lib/news/sources/rss";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const mockLookup = lookup as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date("2026-09-26T12:00:00Z");

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>K24</title>
<item><title><![CDATA[بەغدا و کوەیت لاپەڕەیەکی نوێ]]></title><link>https://www.kurdistan24.net/ckb/story/1</link>
<description><![CDATA[<p>عێراق و کوەیت &amp; لیژنەیەک</p>]]></description><pubDate>Fri, 26 Sep 2026 08:00:00 GMT</pubDate></item>
<item><title>No link here</title><description>x</description></item>
<item><title>From the future</title><link>https://example.com/f</link><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const SINGLE = `<rss><channel><item><title>Only one</title><link>https://example.com/1</link></item></channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">UN &amp;amp; Iraq</title>
<link rel="alternate" href="https://example.com/a"/><summary>Short</summary><updated>2026-09-25T10:00:00Z</updated></entry></feed>`;

describe("parseFeed", () => {
  it("reads RSS items, stripping HTML and skipping items without a link", () => {
    const items = parseFeed(RSS, "Kurdistan24", NOW);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      url: "https://www.kurdistan24.net/ckb/story/1",
      title: "بەغدا و کوەیت لاپەڕەیەکی نوێ",
      snippet: "عێراق و کوەیت & لیژنەیەک",
      publishedAt: new Date("2026-09-26T08:00:00Z"),
      lang: "ku",
      sourceName: "Kurdistan24",
    });
  });
  it("dates a future item as now", () => {
    expect(parseFeed(RSS, "K", NOW)[1].publishedAt).toEqual(NOW);
  });
  it("handles a feed with a single item", () => {
    expect(parseFeed(SINGLE, "X", NOW).map((i) => i.title)).toEqual(["Only one"]);
  });
  it("reads Atom entries", () => {
    const [e] = parseFeed(ATOM, "A", NOW);
    expect(e.url).toBe("https://example.com/a");
    expect(e.title).toBe("UN & Iraq");
    expect(e.lang).toBe("en");
  });
  it("returns nothing for something that is not a feed", () => {
    expect(parseFeed("<html><body>hi</body></html>", "X", NOW)).toEqual([]);
    expect(parseFeed("not xml <<<", "X", NOW)).toEqual([]);
  });
  it("keeps a numeric-looking title as a string instead of a number", () => {
    const xml = `<rss><channel><item><title>0.10</title><link>https://example.com/n</link></item></channel></rss>`;
    expect(parseFeed(xml, "X", NOW).map((i) => i.title)).toEqual(["0.10"]);
  });
});

describe("isPrivateAddress", () => {
  it("flags private and reserved IPv4 ranges", () => {
    for (const ip of [
      "0.1.2.3",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });
  it("does not flag a normal public IPv4 address", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("100.63.255.255")).toBe(false);
  });
  it("flags private and reserved IPv6 ranges", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12::1", "fe80::1"]) expect(isPrivateAddress(ip)).toBe(true);
  });
  it("does not flag a normal public IPv6 address", () => {
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
  it("flags an IPv4-mapped IPv6 address only when the mapped address is private", () => {
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("fetchFeed", () => {
  beforeEach(() => mockLookup.mockReset());

  it("decodes a windows-1256 body using the charset from the Content-Type header", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const head = new TextEncoder().encode('<rss><channel><item><title>');
    // "عراق" (Iraq) encoded as windows-1256 bytes.
    const word = new Uint8Array([0xda, 0xd1, 0xc7, 0xde]);
    const tail = new TextEncoder().encode("</title><link>https://example.com/1</link></item></channel></rss>");
    const body = new Uint8Array(head.length + word.length + tail.length);
    body.set(head, 0);
    body.set(word, head.length);
    body.set(tail, head.length + word.length);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, { status: 200, headers: { "content-type": "application/rss+xml; charset=windows-1256" } }),
      ),
    );
    const items = await fetchFeed("https://example.com/feed", "Test");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("عراق");
  });

  it("refuses a feed whose host resolves to a private address, without ever fetching it", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFeed("https://internal.example/feed", "X")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses localhost outright, without a DNS lookup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFeed("http://localhost/feed", "X")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a private host, without following it", async () => {
    mockLookup.mockImplementation(async (hostname: string) =>
      hostname === "public.example" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://internal.local/feed" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFeed("https://public.example/feed", "X")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still fetches and parses a normal public feed", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const xml = `<rss><channel><item><title>Only one</title><link>https://example.com/1</link></item></channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } })),
    );
    const items = await fetchFeed("https://public.example/feed", "X");
    expect(items.map((i) => i.title)).toEqual(["Only one"]);
  });
});

describe("conditionalHeaders", () => {
  it("sends If-None-Match and If-Modified-Since from the stored validators", () => {
    expect(conditionalHeaders({ etag: '"abc"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" })).toEqual({
      "If-None-Match": '"abc"',
      "If-Modified-Since": "Wed, 01 Jan 2026 00:00:00 GMT",
    });
  });
  it("sends only what is known, and nothing for a feed never seen", () => {
    expect(conditionalHeaders({ etag: '"abc"', lastModified: null })).toEqual({ "If-None-Match": '"abc"' });
    expect(conditionalHeaders({ etag: null, lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" })).toEqual({ "If-Modified-Since": "Wed, 01 Jan 2026 00:00:00 GMT" });
    expect(conditionalHeaders({ etag: null, lastModified: null })).toEqual({});
    expect(conditionalHeaders(null)).toEqual({});
    expect(conditionalHeaders(undefined)).toEqual({});
  });
});

describe("fetchFeedConditional", () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  const headersOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>;

  it("sends the validators it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(SINGLE, { status: 200, headers: { "content-type": "application/rss+xml" } }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchFeedConditional("https://public.example/feed", "X", { etag: '"v1"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" });
    expect(headersOf(fetchMock)["If-None-Match"]).toBe('"v1"');
    expect(headersOf(fetchMock)["If-Modified-Since"]).toBe("Wed, 01 Jan 2026 00:00:00 GMT");
  });

  it("sends no conditional headers without validators", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(SINGLE, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchFeedConditional("https://public.example/feed", "X");
    expect(headersOf(fetchMock)).not.toHaveProperty("If-None-Match");
    expect(headersOf(fetchMock)).not.toHaveProperty("If-Modified-Since");
  });

  it("on a 200 returns the items with the new validators", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(SINGLE, { status: 200, headers: { etag: '"v2"', "last-modified": "Thu, 02 Jan 2026 00:00:00 GMT" } })),
    );
    const r = await fetchFeedConditional("https://public.example/feed", "X", { etag: '"v1"', lastModified: null });
    expect(r.items?.map((i) => i.title)).toEqual(["Only one"]);
    expect(r.etag).toBe('"v2"');
    expect(r.lastModified).toBe("Thu, 02 Jan 2026 00:00:00 GMT");
  });

  it("on a 304 returns no items and keeps the validators", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 304 })));
    const r = await fetchFeedConditional("https://public.example/feed", "X", { etag: '"v1"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" });
    expect(r).toEqual({ items: null, etag: '"v1"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" });
  });

  it("takes refreshed validators from a 304", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"v1b"' } })));
    const r = await fetchFeedConditional("https://public.example/feed", "X", { etag: '"v1"', lastModified: null });
    expect(r).toEqual({ items: null, etag: '"v1b"', lastModified: null });
  });

  it("still refuses a private host before sending anything", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFeedConditional("https://internal.example/feed", "X", { etag: '"v1"', lastModified: null })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still fails on any other error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(fetchFeedConditional("https://public.example/feed", "X", { etag: '"v1"', lastModified: null })).rejects.toThrow("HTTP 500");
  });

  it("fetchFeed itself stays unconditional and returns the items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(SINGLE, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const items = await fetchFeed("https://public.example/feed", "X");
    expect(items.map((i) => i.title)).toEqual(["Only one"]);
    expect(headersOf(fetchMock)).not.toHaveProperty("If-None-Match");
  });
});
