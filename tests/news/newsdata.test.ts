import { describe, it, expect } from "vitest";
import { newsdataUrl, parseNewsdata } from "@/lib/news/sources/newsdata";

describe("newsdataUrl", () => {
  it("builds the latest-news query from whole keywords, never cutting one", () => {
    const u = new URL(newsdataUrl("KEY", ["Erbil", "x".repeat(200)]));
    expect(u.origin + u.pathname).toBe("https://newsdata.io/api/1/latest");
    expect(u.searchParams.get("apikey")).toBe("KEY");
    const q = u.searchParams.get("q")!;
    expect(q.length).toBeLessThanOrEqual(100);
    // The 200-char keyword can never fit whole, so it is dropped rather than cut.
    expect(q).toBe("Erbil");
    expect(u.searchParams.get("language")).toBe("ar,en");
  });
  it("quotes a multi-word keyword and never ends with a trailing OR", () => {
    const q = new URL(newsdataUrl("KEY", ["oil price", "Erbil"])).searchParams.get("q")!;
    expect(q).toBe('"oil price" OR Erbil');
    expect(q.endsWith(" OR")).toBe(false);
  });
  it("skips a keyword that would overflow 100 characters but keeps trying later ones", () => {
    const q = new URL(newsdataUrl("KEY", ["a".repeat(95), "b".repeat(50), "c"])).searchParams.get("q")!;
    expect(q).toBe(`${"a".repeat(95)} OR c`);
    expect(q.length).toBeLessThanOrEqual(100);
  });
});

describe("parseNewsdata", () => {
  it("maps results", () => {
    const items = parseNewsdata({
      status: "success",
      results: [
        {
          title: "Gold rises in Erbil",
          link: "https://example.com/g",
          description: "<b>Prices</b> up",
          pubDate: "2026-09-26 10:15:00",
          language: "english",
          source_name: "Example News",
        },
        { title: "", link: "https://example.com/x" },
      ],
    });
    expect(items).toEqual([
      {
        url: "https://example.com/g",
        title: "Gold rises in Erbil",
        snippet: "Prices up",
        publishedAt: new Date("2026-09-26T10:15:00Z"),
        lang: "en",
        sourceName: "Example News",
      },
    ]);
  });
  it("drops a result whose URL is not http(s), without throwing", () => {
    expect(() =>
      parseNewsdata({ results: [{ title: "bad", link: "javascript:alert(1)" }] }),
    ).not.toThrow();
    expect(parseNewsdata({ results: [{ title: "bad", link: "javascript:alert(1)" }] })).toEqual([]);
  });
  it("never throws deriving a hostname from a URL that passes the prefix check but fails to parse", () => {
    const items = parseNewsdata({ results: [{ title: "weird", link: "https://" }] });
    expect(items).toHaveLength(1);
    expect(items[0].sourceName).toBe("");
  });
});
