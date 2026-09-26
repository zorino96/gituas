import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFeed, parseFeed } from "@/lib/news/sources/rss";

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

describe("fetchFeed", () => {
  it("decodes a windows-1256 body using the charset from the Content-Type header", async () => {
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
});
