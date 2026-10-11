import { describe, it, expect } from "vitest";
import { buyerProfile, ordersByCity } from "@/lib/orders/stats";

it("buyerProfile: busiest cities, Baghdad hours, languages and products; cancelled orders don't count", () => {
  const at = (iso: string, language: string | null = "ckb") => ({ createdAt: new Date(iso), language });
  const p = buyerProfile(
    [at("2026-10-01T17:10:00Z"), at("2026-10-02T17:40:00Z"), at("2026-10-02T09:00:00Z", "ar"), at("2026-10-03T17:05:00Z", null)],
    [
      { city: "erbil", productName: "عەبا", status: "NEW" },
      { city: "erbil", productName: "عەبا", status: "DELIVERED" },
      { city: "duhok", productName: "جانتا", status: "NEW" },
      { city: "basra", productName: "جانتا", status: "CANCELLED" },
    ],
  );
  expect(p.cities).toEqual(["erbil", "duhok"]);
  expect(p.products).toEqual(["عەبا", "جانتا"]);
  expect(p.hours).toEqual([12, 20]);
  expect(p.languages).toEqual(["ckb", "ar"]);
  expect([p.orders, p.messages]).toEqual([3, 4]);
});

const o = (city: string | null, amountMinor: number, status = "NEW") => ({ city, amountMinor, status });

describe("ordersByCity", () => {
  it("counts and totals per city, busiest first", () => {
    const rows = ordersByCity([o("erbil", 10_000), o("baghdad", 5_000), o("erbil", 20_000, "DELIVERED"), o("baghdad", 1_000), o("erbil", 500, "SENT")]);
    expect(rows).toEqual([
      { city: "هەولێر", count: 3, totalMinor: 30_500 },
      { city: "بەغدا", count: 2, totalMinor: 6_000 },
    ]);
  });

  it("leaves out cancelled and returned orders", () => {
    const rows = ordersByCity([o("erbil", 10_000, "CANCELLED"), o("erbil", 10_000, "RETURNED"), o("duhok", 7_000, "CONFIRMED")]);
    expect(rows).toEqual([{ city: "دهۆک", count: 1, totalMinor: 7_000 }]);
  });

  it("labels a missing city نەزانراو", () => {
    expect(ordersByCity([o(null, 3_000), o(null, 2_000)])).toEqual([{ city: "نەزانراو", count: 2, totalMinor: 5_000 }]);
  });

  it("puts an unrecognised code with the unknown ones", () => {
    expect(ordersByCity([o(null, 1_000), o("atlantis", 2_000)])).toEqual([{ city: "نەزانراو", count: 2, totalMinor: 3_000 }]);
  });

  it("breaks a tie on count by the larger total", () => {
    const rows = ordersByCity([o("basra", 1_000), o("kirkuk", 9_000)]);
    expect(rows.map((r) => r.city)).toEqual(["کەرکووک", "بەسرە"]);
  });

  it("names cities in Arabic when asked", () => {
    const rows = ordersByCity([o("erbil", 10_000), o("baghdad", 5_000), o("erbil", 500), o(null, 1_000)], "ar");
    expect(rows).toEqual([
      { city: "أربيل", count: 2, totalMinor: 10_500 },
      { city: "بغداد", count: 1, totalMinor: 5_000 },
      { city: "غير معروف", count: 1, totalMinor: 1_000 },
    ]);
  });

  it("returns nothing for no orders", () => {
    expect(ordersByCity([])).toEqual([]);
  });
});
