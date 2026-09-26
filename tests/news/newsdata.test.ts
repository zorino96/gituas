import { describe, it, expect } from "vitest";
import { newsdataUrl, parseNewsdata } from "@/lib/news/sources/newsdata";

describe("newsdataUrl", () => {
  it("builds the latest-news query and caps q at 100 characters", () => {
    const u = new URL(newsdataUrl("KEY", ["Erbil", "x".repeat(200)]));
    expect(u.origin + u.pathname).toBe("https://newsdata.io/api/1/latest");
    expect(u.searchParams.get("apikey")).toBe("KEY");
    expect(u.searchParams.get("q")!.length).toBeLessThanOrEqual(100);
    expect(u.searchParams.get("q")!.startsWith("Erbil OR ")).toBe(true);
    expect(u.searchParams.get("language")).toBe("ar,en");
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
});
