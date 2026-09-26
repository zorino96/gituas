import { describe, it, expect } from "vitest";
import { gdeltUrl, parseGdelt } from "@/lib/news/sources/gdelt";

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
});
