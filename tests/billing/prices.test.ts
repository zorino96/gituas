import { describe, expect, it } from "vitest";
import { extendPaidUntil, nextPaidUntil, PLAN_LABEL, PLAN_LABEL_AR, planLabel, priceFor } from "@/lib/billing/prices";

describe("priceFor", () => {
  it("prices shop and newsroom plans in IQD", () => {
    expect(priceFor("SHOP", "MERCHANT")).toBe(8000);
    expect(priceFor("SHOP", "PRO")).toBe(12000);
    expect(priceFor("NEWS", "LITE")).toBe(25000);
    expect(priceFor("NEWS", "MANUAL")).toBe(155000);
    expect(priceFor("NEWS", "AUTO")).toBe(390000);
    expect(priceFor("NEWS", "ENTERPRISE")).toBe(940000);
  });
  it("refuses plans that are not for sale", () => {
    expect(priceFor("SHOP", "FREE")).toBeNull();
    expect(priceFor("SHOP", "LITE")).toBeNull();
    expect(priceFor("NEWS", "PRO")).toBeNull();
    expect(priceFor("NEWS", "toString")).toBeNull();
  });
  it("labels every plan in Sorani", () => {
    for (const p of ["FREE", "MERCHANT", "PRO", "LITE", "MANUAL", "AUTO", "ENTERPRISE"]) expect(PLAN_LABEL[p]).toBeTruthy();
  });
  it("labels every plan in Arabic, with no Kurdish-only letters", () => {
    for (const p of Object.keys(PLAN_LABEL)) {
      expect(PLAN_LABEL_AR[p], p).toBeTruthy();
      expect(PLAN_LABEL_AR[p], p).not.toMatch(/[کیەێۆڕڵڤپچژگ]/);
    }
  });
  it("planLabel picks by language and shows an unknown code as it is", () => {
    expect(planLabel("MERCHANT")).toBe(PLAN_LABEL.MERCHANT);
    expect(planLabel("MERCHANT", "ckb")).toBe(PLAN_LABEL.MERCHANT);
    expect(planLabel("MERCHANT", "ar")).toBe("تاجر");
    expect(planLabel("WHATEVER", "ar")).toBe("WHATEVER");
  });
});

describe("extendPaidUntil", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("starts 30 days from now when nothing is paid or it lapsed", () => {
    expect(extendPaidUntil(null, now).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(extendPaidUntil(new Date("2026-09-01T00:00:00Z"), now).toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
  it("stacks on top of a period that is still running", () => {
    expect(extendPaidUntil(new Date("2026-10-10T00:00:00Z"), now).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("nextPaidUntil", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const DAY = 86_400_000;
  const after = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it("stacks another period on the same plan that is still running", () => {
    const current = { plan: "LITE", paidUntil: new Date("2026-10-10T00:00:00Z") };
    expect(nextPaidUntil("NEWS", current, "LITE", now).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("starts 30 days from now when no period is running", () => {
    expect(nextPaidUntil("NEWS", { plan: "LITE", paidUntil: null }, "ENTERPRISE", now).toISOString()).toBe(after(30 * DAY));
    expect(nextPaidUntil("NEWS", { plan: "LITE", paidUntil: new Date("2026-09-01T00:00:00Z") }, "ENTERPRISE", now).toISOString()).toBe(after(30 * DAY));
  });
  it("converts cheap stacked months into a few days of an expensive plan", () => {
    const remaining = 300 * DAY;
    const current = { plan: "LITE", paidUntil: new Date(now.getTime() + remaining) };
    const credit = Math.floor((remaining * 25000) / 940000);
    expect(nextPaidUntil("NEWS", current, "ENTERPRISE", now).toISOString()).toBe(after(credit + 30 * DAY));
  });
  it("lets a downgrade keep its value", () => {
    const remaining = 20 * DAY;
    const current = { plan: "AUTO", paidUntil: new Date(now.getTime() + remaining) };
    const credit = Math.floor((remaining * 390000) / 155000);
    expect(nextPaidUntil("NEWS", current, "MANUAL", now).toISOString()).toBe(after(credit + 30 * DAY));
  });
  it("gives no credit for a plan that has no price", () => {
    const current = { plan: "FREE", paidUntil: new Date("2026-12-01T00:00:00Z") };
    expect(nextPaidUntil("SHOP", current, "PRO", now).toISOString()).toBe(after(30 * DAY));
  });
});
