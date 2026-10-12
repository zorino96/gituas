import { describe, expect, it, vi } from "vitest";

import { ASSUMPTIONS, costShare, netRevenueUsd, worstCaseCostUsd, worstCaseStraddleUsd } from "@/lib/billing/economics";
import { checkoutPrice, maxPlanOpen, planLabel, priceFor, SHOP_PRICES } from "@/lib/billing/prices";
import { SHOP_LIMITS, STORE_PLANS, VIDEOS_PER_DAY, planUsesOpus, tenantLimits } from "@/lib/shop/plans";

describe("a store that uses every limit of its plan", () => {
  it("leaves a margin on every paid plan", () => {
    for (const plan of STORE_PLANS) {
      if (!SHOP_PRICES[plan]) continue;
      const share = costShare(plan);
      expect(share, `${plan}: ${(share * 100).toFixed(0)}% of the net price`).toBeLessThanOrEqual(ASSUMPTIONS.maxCostShare);
    }
  });

  it("costs a free store next to nothing", () => {
    expect(worstCaseCostUsd("FREE").total).toBeLessThanOrEqual(ASSUMPTIONS.maxFreeUsd);
  });

  it("is still above water when a paid period straddles two calendar months", () => {
    for (const plan of ["MERCHANT", "PRO", "MAX"] as const) expect(worstCaseStraddleUsd(plan), plan).toBeLessThan(netRevenueUsd(plan));
  });

  it("is paid for: the net price is above the worst case on every paid plan", () => {
    for (const plan of ["MERCHANT", "PRO", "MAX"] as const) expect(netRevenueUsd(plan)).toBeGreaterThan(worstCaseCostUsd(plan).total * 2);
  });
});

describe("the plans' limits", () => {
  it("grow with the plan", () => {
    const L = SHOP_LIMITS;
    expect(L.MERCHANT.aiUsd).toBeGreaterThan(L.FREE.aiUsd);
    expect(L.PRO.aiUsd).toBeGreaterThan(L.MERCHANT.aiUsd);
    expect(L.MAX.aiUsd).toBeGreaterThan(L.PRO.aiUsd);
    expect(L.PRO.smartPerMonth).toBeGreaterThan(L.MERCHANT.smartPerMonth);
    expect(L.MAX.smartPerMonth).toBeGreaterThan(L.PRO.smartPerMonth);
  });

  it("never allow more videos a month than three a day", () => {
    for (const plan of STORE_PLANS) expect(SHOP_LIMITS[plan].videosPerMonth).toBeLessThanOrEqual(VIDEOS_PER_DAY * 30);
  });

  it("give Opus to one plan only, and never more Opus than the whole allowance", () => {
    expect(STORE_PLANS.filter(planUsesOpus)).toEqual(["MAX"]);
    for (const plan of STORE_PLANS) expect(SHOP_LIMITS[plan].aiOpusUsd).toBeLessThanOrEqual(SHOP_LIMITS[plan].aiUsd);
  });
});

describe("what a workspace gets from several stores", () => {
  it("is the sum of its paid stores' plans, and one free allowance only when there is no paid store", () => {
    const one = tenantLimits(["PRO"]);
    expect(tenantLimits(["PRO", "FREE", "FREE", "FREE", "FREE"])).toEqual(one);
    const two = tenantLimits(["PRO", "MERCHANT"]);
    expect(two.aiUsd).toBeCloseTo(SHOP_LIMITS.PRO.aiUsd + SHOP_LIMITS.MERCHANT.aiUsd);
    expect(two.videos.LITE).toBe(SHOP_LIMITS.PRO.videosPerMonth + SHOP_LIMITS.MERCHANT.videosPerMonth);
    expect(two.videosPerDay).toBe(2 * VIDEOS_PER_DAY);
    const free = tenantLimits(["FREE", "FREE", "FREE"]);
    expect(free.aiUsd).toBe(SHOP_LIMITS.FREE.aiUsd);
    // No shop at all: nothing to spend a free allowance on.
    expect(tenantLimits([]).aiUsd).toBe(0);
    expect(tenantLimits([]).images).toBe(0);
    expect(tenantLimits([]).videosPerDay).toBe(0);
  });

  it("puts the Opus plan's videos in the Opus tier", () => {
    const l = tenantLimits(["MAX", "MERCHANT"]);
    expect(l.videos.PRO).toBe(SHOP_LIMITS.MAX.videosPerMonth);
    expect(l.videos.LITE).toBe(SHOP_LIMITS.MERCHANT.videosPerMonth);
    expect(l.aiOpusUsd).toBe(SHOP_LIMITS.MAX.aiOpusUsd);
  });
});

describe("the Opus plan's price", () => {
  it("is 59,000 dinars a month and is named Max", () => {
    expect(SHOP_PRICES.MAX).toBe(59_000);
    expect(priceFor("SHOP", "MAX")).toBe(59_000);
    expect(planLabel("MAX", "en")).toBe("Max");
    expect(planLabel("MAX", "ckb")).toBe("ماکس");
  });

  it("cannot be bought until the owner switches it on", () => {
    vi.stubEnv("MAX_PLAN_ENABLED", "");
    expect(maxPlanOpen()).toBe(false);
    expect(checkoutPrice("SHOP", "MAX")).toBeNull();
    expect(checkoutPrice("SHOP", "PRO")).toBe(25_000);
    vi.stubEnv("MAX_PLAN_ENABLED", "1");
    expect(maxPlanOpen()).toBe(true);
    expect(checkoutPrice("SHOP", "MAX")).toBe(59_000);
    vi.unstubAllEnvs();
  });

  it("can still be renewed by a store that is on it, before and after the switch", () => {
    vi.stubEnv("MAX_PLAN_ENABLED", "");
    expect(checkoutPrice("SHOP", "MAX", "MAX")).toBe(59_000);
    expect(checkoutPrice("SHOP", "MAX", "PRO")).toBeNull();
    vi.unstubAllEnvs();
  });
});
