import { describe, it, expect } from "vitest";
import { GUIDE, GUIDE_IDS } from "@/lib/newsroom/guide";

describe("GUIDE", () => {
  it("has unique ids that match GUIDE_IDS in order", () => {
    expect(GUIDE.map((s) => s.id)).toEqual([...GUIDE_IDS]);
    expect(new Set(GUIDE_IDS).size).toBe(GUIDE_IDS.length);
  });
  it("gives every section a title, an intro, and steps or questions", () => {
    for (const s of GUIDE) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.intro.length).toBeGreaterThan(0);
      expect((s.steps?.length ?? 0) + (s.qa?.length ?? 0)).toBeGreaterThan(0);
    }
  });
  it("links only to same-site paths", () => {
    for (const s of GUIDE) if (s.link) expect(s.link.href).toMatch(/^\/(?![\/\\])/);
  });
});
