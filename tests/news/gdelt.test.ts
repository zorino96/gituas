import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimited, fetchGdelt, gdeltUrl, parseGdelt } from "@/lib/news/sources/gdelt";

afterEach(() => vi.unstubAllGlobals());

describe("gdeltUrl", () => {
  it("ORs the keywords and quotes phrases", () => {
    const u = new URL(gdeltUrl(["هەولێر", "oil price"]));
    expect(u.origin + u.pathname).toBe("https://api.gdeltproject.org/api/v2/doc/doc");
    expect(u.searchParams.get("query")).toBe('(هەولێر OR "oil price")');
    expect(u.searchParams.get("mode")).toBe("artlist");
    expect(u.searchParams.get("format")).toBe("json");
    expect(u.searchParams.get("timespan")).toBe("24h");
  });
  it("uses a single keyword bare", () => {
    expect(new URL(gdeltUrl(["Kurdistan"])).searchParams.get("query")).toBe("Kurdistan");
  });
});

describe("parseGdelt", () => {
  it("maps articles and skips ones without a URL", () => {
    const items = parseGdelt({
      articles: [
        { url: "https://www.rudaw.net/sorani/x", title: "Title &amp; more", seendate: "20260926T101500Z", domain: "rudaw.net", language: "Kurdish" },
        { url: "", title: "bad" },
      ],
    });
    expect(items).toEqual([
      {
        url: "https://www.rudaw.net/sorani/x",
        title: "Title & more",
        snippet: "",
        publishedAt: new Date("2026-09-26T10:15:00Z"),
        lang: "ku",
        sourceName: "rudaw.net",
      },
    ]);
  });
  it("returns nothing for an empty answer", () => {
    expect(parseGdelt({})).toEqual([]);
    expect(parseGdelt(null)).toEqual([]);
  });
  it("drops an item whose URL is not http(s), without throwing", () => {
    expect(() => parseGdelt({ articles: [{ url: "javascript:alert(1)", title: "bad" }] })).not.toThrow();
    expect(parseGdelt({ articles: [{ url: "javascript:alert(1)", title: "bad" }] })).toEqual([]);
  });
  it("never throws deriving a hostname from a URL that passes the prefix check but fails to parse", () => {
    const items = parseGdelt({ articles: [{ url: "https://", title: "weird", domain: "" }] });
    expect(items).toHaveLength(1);
    expect(items[0].sourceName).toBe("");
  });
});

describe("fetchGdelt", () => {
  it("gives RateLimited the name RateLimited", () => {
    expect(new RateLimited("slow down").name).toBe("RateLimited");
  });
  it("throws the body snippet when the reply is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Invalid query syntax", { status: 200 })));
    await expect(fetchGdelt(["x"])).rejects.toThrow("Invalid query syntax");
  });
  it("lets a parseGdelt error propagate as itself, instead of being swallowed as a JSON.parse failure", async () => {
    // Valid JSON, but a shape parseGdelt cannot handle: articles.filter throws a TypeError.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ articles: "oops" }), { status: 200 })));
    await expect(fetchGdelt(["x"])).rejects.toThrow(/is not a function/);
  });
});
