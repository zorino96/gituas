import { expect, it } from "vitest";
import { alternativeLine } from "@/lib/shop/compose";
import { courierSheets, weekReport } from "@/lib/orders/stats";

const DAY = 86_400_000;
const now = Date.parse("2026-10-11T12:00:00Z");

it("weekReport: this week vs last, cancelled apart, best seller", () => {
  const o = (daysAgo: number, status = "NEW", productName = "عەبا", amountMinor = 10000) => ({ createdAt: new Date(now - daysAgo * DAY), amountMinor, currency: "IQD", status, productName });
  const r = weekReport([o(1), o(2, "DELIVERED", "جانتا"), o(3), o(4, "CANCELLED"), o(8), o(20)], now);
  expect(r).toEqual({ orders: 3, prevOrders: 1, totals: { IQD: 30000 }, topProduct: "عەبا", cancelled: 1 });
});

it("courierSheets: one list per city, COD amount includes delivery", () => {
  const base = { customerName: "ئاران", phone: "9647501234567", address: "شەقامی ١٠٠", productName: "عەبا", variantLabel: "L", amountMinor: 25000, deliveryFeeMinor: 5000, currency: "IQD", cod: true };
  const s = courierSheets([{ ...base, city: "erbil" }, { ...base, city: "erbil", cod: false }, { ...base, city: null }], (m) => `${m}`, { collect: "وەرگرتن", paid: "دراوە" }, "en");
  expect(s.map((x) => x.count)).toEqual([2, 1]);
  expect(s[0].text).toContain("وەرگرتن: 30000");
  expect(s[0].text).toContain("دراوە");
  expect(s[1].city).toBe("Unknown");
});

it("alternativeLine: price from the card", () => {
  expect(alternativeLine({ name: "جانتا", photos: [], variants: [{ label: "", amountMinor: 15000, currency: "IQD", inStock: true }] }, "en")).toBe("We also have: جانتا — 15,000 IQD");
});
