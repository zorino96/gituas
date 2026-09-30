import { describe, expect, it } from "vitest";
import { jitterMs, startOfUtcDay } from "@/lib/shop/pipeline";

describe("pipeline helpers", () => {
  it("waits between 8 and 30 seconds", () => {
    expect(jitterMs(() => 0)).toBe(8_000);
    expect(jitterMs(() => 0.9999)).toBeLessThanOrEqual(30_000);
  });
  it("counts the day in UTC", () => {
    expect(startOfUtcDay(new Date("2026-10-01T23:30:00+03:00")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
