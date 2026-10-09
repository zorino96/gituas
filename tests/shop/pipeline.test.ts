import { describe, expect, it } from "vitest";
import { jitterMs, startOfShopDay, startOfUtcDay } from "@/lib/shop/pipeline";

describe("pipeline helpers", () => {
  it("waits between 8 and 30 seconds", () => {
    expect(jitterMs(() => 0)).toBe(8_000);
    expect(jitterMs(() => 0.9999)).toBeLessThanOrEqual(30_000);
  });
  it("counts the day in UTC", () => {
    expect(startOfUtcDay(new Date("2026-10-01T23:30:00+03:00")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // A shop's day starts at midnight in Baghdad: 02:00 there is still the same day, 23:30 too.
    expect(startOfShopDay(new Date("2026-10-02T02:00:00+03:00")).toISOString()).toBe("2026-10-01T21:00:00.000Z");
    expect(startOfShopDay(new Date("2026-10-01T23:30:00+03:00")).toISOString()).toBe("2026-09-30T21:00:00.000Z");
  });
});
