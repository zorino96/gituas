import { describe, expect, it } from "vitest";
import { canAutoPublish, NEWS_LIMITS, refreshSecFor } from "@/lib/billing/plans";

describe("refreshSecFor", () => {
  it("gives each plan its speed", () => {
    expect(refreshSecFor("ENTERPRISE")).toBe(30);
    expect(refreshSecFor("AUTO")).toBe(60);
    expect(refreshSecFor("MANUAL")).toBe(120);
    expect(refreshSecFor("LITE")).toBe(300);
  });
  it("serves an unknown, missing or inherited plan like MANUAL", () => {
    expect(refreshSecFor(undefined)).toBe(120);
    expect(refreshSecFor(null)).toBe(120);
    expect(refreshSecFor("FREE")).toBe(120);
    expect(refreshSecFor("toString")).toBe(120);
  });
  it("is faster on every step up", () => {
    expect(NEWS_LIMITS.ENTERPRISE.refreshSec).toBeLessThan(NEWS_LIMITS.AUTO.refreshSec);
    expect(NEWS_LIMITS.AUTO.refreshSec).toBeLessThan(NEWS_LIMITS.MANUAL.refreshSec);
    expect(NEWS_LIMITS.MANUAL.refreshSec).toBeLessThan(NEWS_LIMITS.LITE.refreshSec);
  });
});

describe("canAutoPublish", () => {
  it("is on for AUTO and ENTERPRISE only", () => {
    expect(canAutoPublish("ENTERPRISE")).toBe(true);
    expect(canAutoPublish("AUTO")).toBe(true);
    expect(canAutoPublish("MANUAL")).toBe(false);
    expect(canAutoPublish("LITE")).toBe(false);
  });
  it("is off for an unknown or missing plan", () => {
    expect(canAutoPublish(undefined)).toBe(false);
    expect(canAutoPublish(null)).toBe(false);
    expect(canAutoPublish("PRO")).toBe(false);
    expect(canAutoPublish("toString")).toBe(false);
  });
});
