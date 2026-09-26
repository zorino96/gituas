import { describe, it, expect } from "vitest";
import { LimitReached, limitMessage, monthKey } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";

describe("monthKey", () => {
  it("is the UTC year and month", () => {
    expect(monthKey(new Date("2026-09-30T23:30:00Z"))).toBe("2026-09");
    expect(monthKey(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
  });
});

describe("limits", () => {
  it("names the limit in Kurdish", () => {
    expect(limitMessage(new LimitReached("draft", 300))).toContain("٣٠٠");
  });
  it("gives every plan a number for every metric", () => {
    for (const plan of Object.values(NEWS_LIMITS)) {
      for (const m of ["draft", "improve", "publish", "sources"] as const) expect(plan[m]).toBeGreaterThan(0);
    }
  });
});
