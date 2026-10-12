import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ list: [] as { plan: string; planPaidUntil: Date | null }[] }));
vi.mock("@/lib/db", () => ({ db: { store: { findMany: vi.fn(async () => rows.list) } } }));

import { limitsOf, plansOf } from "@/lib/shop/tenant-plans";

const DAY = 86_400_000;

beforeEach(() => {
  rows.list = [];
});

describe("plansOf", () => {
  it("counts a paid plan until its date, and as FREE once the date has passed (before the daily sweep runs)", async () => {
    rows.list = [
      { plan: "MERCHANT", planPaidUntil: new Date(Date.now() + DAY) },
      { plan: "PRO", planPaidUntil: new Date(Date.now() - 1000) },
      { plan: "MAX", planPaidUntil: null },
      { plan: "NOT_A_PLAN", planPaidUntil: null },
    ];
    expect(await plansOf("t1")).toEqual(["MERCHANT", "FREE", "MAX", "FREE"]);
  });

  it("gives a lapsed workspace the free allowance and no pictures or videos", async () => {
    rows.list = [{ plan: "MAX", planPaidUntil: new Date(Date.now() - DAY) }];
    const l = await limitsOf("t1");
    expect(l.images).toBe(0);
    expect(l.videos.LITE + l.videos.PRO).toBe(0);
    expect(l.aiOpusUsd).toBe(0);
  });
});
