import { describe, it, expect } from "vitest";
import { deskLimit, NEWS_LIMITS, seatsLeft } from "@/lib/billing/plans";

describe("seats", () => {
  it("counts members and live invites against the plan's seats", () => {
    expect(seatsLeft(5, 2, 1)).toBe(2);
    expect(seatsLeft(2, 2, 0)).toBe(0);
    expect(seatsLeft(2, 3, 1)).toBe(0);
  });
  it("gives each plan more seats than the last", () => {
    expect(NEWS_LIMITS.MANUAL.seats).toBe(2);
    expect(NEWS_LIMITS.AUTO.seats).toBe(5);
    expect(NEWS_LIMITS.ENTERPRISE.seats).toBeGreaterThan(NEWS_LIMITS.AUTO.seats);
  });
});

describe("deskLimit", () => {
  it("allows the manual plan's desks for someone who owns none", () => {
    expect(deskLimit([])).toBe(NEWS_LIMITS.MANUAL.desks);
  });
  it("uses the best plan among the desks already owned", () => {
    expect(deskLimit(["MANUAL", "AUTO"])).toBe(NEWS_LIMITS.AUTO.desks);
  });
});
