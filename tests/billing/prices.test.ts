import { describe, expect, it } from "vitest";
import { extendPaidUntil, PLAN_LABEL, priceFor } from "@/lib/billing/prices";

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
