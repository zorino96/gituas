import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    usage: { findUnique: vi.fn() },
  },
}));

import { assertWithin, LimitReached, limitMessage, monthKey } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { db } from "@/lib/db";

// The mocked db is untyped (a plain vi.fn() per method); this local view avoids
// fighting Prisma's generic, select-narrowed return types in a test file.
const mockDb = db as unknown as {
  tenant: { findUnique: ReturnType<typeof vi.fn> };
  usage: { findUnique: ReturnType<typeof vi.fn> };
};

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
  it("names the class as its Error name", () => {
    expect(new LimitReached("draft", 300).name).toBe("LimitReached");
  });
});

describe("assertWithin", () => {
  beforeEach(() => vi.resetAllMocks());

  it("throws LimitReached(metric, 0) when the tenant does not exist, instead of falling back to MANUAL limits", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null);
    mockDb.usage.findUnique.mockResolvedValue(null);
    await expect(assertWithin("missing-tenant", "draft")).rejects.toMatchObject({ metric: "draft", limit: 0 });
  });

  it("uses the tenant's own plan limit when the tenant exists", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ plan: "MANUAL" });
    mockDb.usage.findUnique.mockResolvedValue({ count: NEWS_LIMITS.MANUAL.draft });
    await expect(assertWithin("real-tenant", "draft")).rejects.toMatchObject({ metric: "draft", limit: NEWS_LIMITS.MANUAL.draft });
  });
});
