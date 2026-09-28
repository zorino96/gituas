import { afterEach, describe, expect, it, vi } from "vitest";
import { CATALOG, catalogAvailable, catalogEntry, GROUPS } from "@/lib/news/catalog";

afterEach(() => vi.unstubAllEnvs());

describe("catalog", () => {
  it("has unique ids and known groups", () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    const groups = GROUPS.map((g) => g.id);
    for (const c of CATALOG) expect(groups).toContain(c.group);
  });
  it("gives every outlet feed an https RSS address and a language", () => {
    for (const c of CATALOG.filter((x) => x.group !== "api")) {
      expect(c.rss).toMatch(/^https:\/\//);
      expect(c.lang).not.toBeNull();
    }
  });
  it("keeps GDELT's required citation", () => {
    expect(catalogEntry("gdelt")?.attribution?.url).toBe("https://www.gdeltproject.org/");
  });
  it("offers NewsData only when its key is set", () => {
    vi.stubEnv("NEWSDATA_API_KEY", "");
    expect(catalogAvailable().some((c) => c.id === "newsdata")).toBe(false);
    vi.stubEnv("NEWSDATA_API_KEY", "k");
    expect(catalogAvailable().some((c) => c.id === "newsdata")).toBe(true);
  });
  it("offers every outlet feed without any key", () => {
    vi.stubEnv("NEWSDATA_API_KEY", "");
    expect(catalogAvailable().filter((c) => c.group !== "api").length).toBe(CATALOG.filter((c) => c.group !== "api").length);
  });
});
