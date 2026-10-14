import { describe, expect, it } from "vitest";

import { parseFeed } from "@/lib/news/sources/rss";

const feed = (item: string) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>سەرنووس</title><link>https://example.com/a</link><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate>${item}</item></channel></rss>`;

describe("feed pictures", () => {
  it("reads an image enclosure", () => {
    const [it] = parseFeed(feed(`<enclosure url="https://example.com/p.jpg" type="image/jpeg" length="1"/>`), "S");
    expect(it.imageUrl).toBe("https://example.com/p.jpg");
  });
  it("reads media:content and ignores video", () => {
    expect(parseFeed(feed(`<media:content url="https://example.com/m.jpg" medium="image"/>`), "S")[0].imageUrl).toBe("https://example.com/m.jpg");
    expect(parseFeed(feed(`<enclosure url="https://example.com/v.mp4" type="video/mp4"/>`), "S")[0].imageUrl).toBeUndefined();
  });
  it("falls back to the first <img> in the html", () => {
    const [it] = parseFeed(feed(`<description><![CDATA[<p><img src="https://example.com/i.png"/> text</p>]]></description>`), "S");
    expect(it.imageUrl).toBe("https://example.com/i.png");
  });
  it("has none when the feed gave none", () => {
    expect(parseFeed(feed(""), "S")[0].imageUrl).toBeUndefined();
  });
});
