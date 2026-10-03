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
import { nrNewsAr } from "@/lib/i18n/nr/news.ar";

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
  it("keeps the Sorani wording for every metric and answers in Arabic when given the Arabic text", () => {
    // The formula limitMessage used before the wording moved to the dictionary.
    const old = (label: string) => `سنووری ${label}ی ئەم مانگە (${new Intl.NumberFormat("ar-IQ").format(1200)}) تەواو بوو. بۆ زیاتر، پاکێجەکەت بەرز بکەرەوە.`;
    expect(limitMessage(new LimitReached("draft", 1200))).toBe(old("ئامادەکردنی هەواڵ"));
    expect(limitMessage(new LimitReached("improve", 1200))).toBe(old("باشترکردن"));
    expect(limitMessage(new LimitReached("publish", 1200))).toBe(old("بڵاوکردنەوە"));
    expect(limitMessage(new LimitReached("publish", 30), nrNewsAr.actions)).toBe("انتهى حد النشر لهذا الشهر (٣٠). للمزيد، قم بترقية باقتك.");
    expect(limitMessage(new LimitReached("publish", 0, true), nrNewsAr.actions)).toBe(nrNewsAr.actions.frozen);
  });
  it("gives every plan a number for every metric", () => {
    for (const plan of Object.values(NEWS_LIMITS)) {
      for (const m of ["draft", "improve", "publish", "sources"] as const) expect(plan[m]).toBeGreaterThan(0);
    }
  });
  it("names the class as its Error name", () => {
    expect(new LimitReached("draft", 300).name).toBe("LimitReached");
  });
  it("says the trial is over when frozen, instead of naming a limit", () => {
    const e = new LimitReached("draft", 0, true);
    expect(e.frozen).toBe(true);
    expect(limitMessage(e)).toBe("ماوەی تاقیکردنەوە تەواو بووە — بۆ بەردەوامبوون لە «پلان و پارەدان» پلانێک هەڵبژێرە.");
    expect(new LimitReached("draft", 300).frozen).toBe(false);
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
    mockDb.tenant.findUnique.mockResolvedValue({ plan: "MANUAL", kind: "NEWS", planPaidUntil: null, trialEndsAt: null });
    mockDb.usage.findUnique.mockResolvedValue({ count: NEWS_LIMITS.MANUAL.draft });
    await expect(assertWithin("real-tenant", "draft")).rejects.toMatchObject({ metric: "draft", limit: NEWS_LIMITS.MANUAL.draft, frozen: false });
  });

  it("refuses a newsroom whose trial is over and that is not paid, as frozen, even with quota left", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ plan: "MANUAL", kind: "NEWS", planPaidUntil: null, trialEndsAt: new Date(Date.now() - 1000) });
    mockDb.usage.findUnique.mockResolvedValue({ count: 0 });
    await expect(assertWithin("t", "publish")).rejects.toMatchObject({ metric: "publish", limit: 0, frozen: true });
  });

  it("lets a newsroom in its trial, or with a running paid plan, use its quota", async () => {
    mockDb.usage.findUnique.mockResolvedValue({ count: 0 });
    mockDb.tenant.findUnique.mockResolvedValue({ plan: "MANUAL", kind: "NEWS", planPaidUntil: null, trialEndsAt: new Date(Date.now() + 86_400_000) });
    await expect(assertWithin("t", "draft")).resolves.toBeUndefined();
    mockDb.tenant.findUnique.mockResolvedValue({ plan: "AUTO", kind: "NEWS", planPaidUntil: new Date(Date.now() + 86_400_000), trialEndsAt: new Date(Date.now() - 86_400_000) });
    await expect(assertWithin("t", "draft")).resolves.toBeUndefined();
  });
});
