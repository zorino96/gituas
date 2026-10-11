import { expect, it } from "vitest";
import { adLibraryUrl, marketSignals } from "@/lib/orders/market";

it("marketSignals: flags asked-but-not-bought, haggling and the top question", () => {
  const q = (id: string | null, type: string, intent = "price") => ({ boundProductId: id, commentType: type, intent });
  const messages = [
    ...Array.from({ length: 12 }, () => q("a", "QUESTION")),
    ...Array.from({ length: 4 }, () => q("a", "NEGOTIATION", "none")),
    ...Array.from({ length: 10 }, () => q("b", "QUESTION", "delivery")),
    q("gone", "QUESTION"),
  ];
  const orders = [{ productId: "b", status: "NEW" }, { productId: "b", status: "DELIVERED" }, { productId: "a", status: "CANCELLED" }];
  const r = marketSignals(messages, orders, { a: "عەبا", b: "جانتا" });
  expect(r.products.map((p) => [p.name, p.asks, p.orders, p.haggles])).toEqual([["عەبا", 12, 0, 4], ["جانتا", 10, 2, 0]]);
  expect(r.advice).toEqual([
    { kind: "lowConversion", name: "عەبا", asks: 12, orders: 0 },
    { kind: "priceHigh", name: "عەبا", pct: 25 },
    { kind: "topIntent", intent: "price", pct: 57 },
  ]);
  expect(adLibraryUrl("عەبا ژنانە")).toContain("country=IQ&");
});
