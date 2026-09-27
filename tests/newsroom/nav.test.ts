import { describe, it, expect } from "vitest";
import { activeItem, NAV, NAV_GROUPS } from "@/lib/newsroom/nav";
import { GUIDE_IDS } from "@/lib/newsroom/guide";

describe("NAV", () => {
  it("has unique keys and hrefs under /newsroom", () => {
    expect(new Set(NAV.map((i) => i.key)).size).toBe(NAV.length);
    for (const i of NAV) expect(i.href.startsWith("/newsroom/")).toBe(true);
  });
  it("puts every item in a known group", () => {
    const groups = NAV_GROUPS.map((g) => g.key);
    for (const i of NAV) expect(groups).toContain(i.group);
  });
  it("points every item at a guide section", () => {
    for (const i of NAV) expect(GUIDE_IDS).toContain(i.guide);
  });
  it("shows exactly four items in the phone bar (the fifth slot is 'more')", () => {
    expect(NAV.filter((i) => i.mobile)).toHaveLength(4);
  });
});

describe("activeItem", () => {
  it("matches a section and its sub-pages", () => {
    expect(activeItem("/newsroom/news")?.key).toBe("news");
    expect(activeItem("/newsroom/news/abc123")?.key).toBe("news");
    expect(activeItem("/newsroom/settings")?.key).toBe("settings");
  });
  it("does not match a longer sibling name", () => {
    expect(activeItem("/newsroom/newsletter")).toBeUndefined();
  });
  it("returns undefined off the desk", () => {
    expect(activeItem("/newsroom")).toBeUndefined();
    expect(activeItem("/app/news")).toBeUndefined();
  });
});
