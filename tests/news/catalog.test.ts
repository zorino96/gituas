import { afterEach, describe, it, expect } from "vitest";
import { catalogAvailable, CATALOG } from "@/lib/news/catalog";

const saved = process.env.NEWSDATA_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.NEWSDATA_API_KEY;
  else process.env.NEWSDATA_API_KEY = saved;
});

describe("catalog", () => {
  it("always offers GDELT, with its required citation", () => {
    const g = CATALOG.find((c) => c.id === "gdelt")!;
    expect(g.attribution.url).toBe("https://www.gdeltproject.org/");
  });
  it("offers NewsData only when its key is set", () => {
    delete process.env.NEWSDATA_API_KEY;
    expect(catalogAvailable().map((c) => c.id)).toEqual(["gdelt"]);
    process.env.NEWSDATA_API_KEY = "k";
    expect(catalogAvailable().map((c) => c.id)).toEqual(["gdelt", "newsdata"]);
  });
});
