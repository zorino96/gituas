import { expect, it } from "vitest";
import { effectiveMode, isDue, pickProduct, slotHours } from "@/lib/shop/autopilot-plan";

const DAY = 86_400_000;
// 17:00 UTC = 20:00 Baghdad.
const now = Date.parse("2026-10-11T17:10:00Z");
const p = (id: string, name: string, postedDaysAgo: number | null, extra: Partial<{ photos: string[]; inStock: boolean }> = {}) => ({
  id,
  name,
  photos: ["x.jpg"],
  inStock: true,
  autoPostedAt: postedDaysAgo == null ? null : new Date(now - postedDaysAgo * DAY),
  ...extra,
});

it("autopilot: free shops only prepare; paid shops may publish; junk is off", () => {
  expect(effectiveMode("PUBLISH", "FREE")).toBe("DRAFT");
  expect(effectiveMode("PUBLISH", "MERCHANT")).toBe("PUBLISH");
  expect(effectiveMode("PUBLISH", "PRO")).toBe("PUBLISH");
  expect(effectiveMode("nope", "PRO")).toBe("OFF");
});

it("autopilot: slots use buyer hours, filled with evening defaults, capped at 3", () => {
  expect(slotHours([], 1)).toEqual([20]);
  expect(slotHours([18], 2)).toEqual([18, 20]);
  expect(slotHours([9, 18, 21, 23], 9)).toEqual([9, 18, 21]);
});

it("autopilot: due only inside a slot hour and once per slot", () => {
  expect(isDue(null, [20], now)).toBe(true);
  expect(isDue(null, [13], now)).toBe(false);
  expect(isDue(new Date(now - 30 * 60_000), [20], now)).toBe(false);
  expect(isDue(new Date(now - DAY), [20], now)).toBe(true);
});

it("autopilot: best seller first, skips no-photo, out-of-stock and posted within 7 days", () => {
  const list = [
    p("a", "جانتا", null),
    p("b", "عەبا", 8),
    p("c", "کڵاو", 2),
    p("d", "پێڵاو", null, { photos: [] }),
    p("e", "تیشێرت", null, { inStock: false }),
  ];
  expect(pickProduct(list, ["عەبا"], now)?.id).toBe("b");
  expect(pickProduct(list, [], now)?.id).toBe("a");
  expect(pickProduct([p("c", "کڵاو", 2)], [], now)).toBeNull();
});
