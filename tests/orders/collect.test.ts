import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

const { isYes, missingFields, nextStep, parseDetails } = await import("@/lib/orders/collect");

const inStock = [
  { label: "M", amountMinor: 25_000, currency: "IQD" },
  { label: "L", amountMinor: 27_000, currency: "IQD" },
];
const store = { deliveryFeeMinor: 5_000, deliveryCurrency: "IQD", deliveryTime: null, deliveryCityFees: { erbil: 3_000 } };
const fresh = { customerName: "ari.shop", phone: null, city: null, address: null, productName: "عەبا", variantLabel: "M", amountMinor: 25_000, currency: "IQD", collect: null };
const ctx = { handle: "ari.shop", inStock, store, lang: "en" as const };

describe("parseDetails", () => {
  it("keeps valid AI fields and normalises the phone", () => {
    const d = parseDetails({ name: "Aram", phone: "0750 123 4567", city: "erbil", address: "Ankawa, near the church", variant: "l" }, "", inStock);
    expect(d).toEqual({ name: "Aram", phone: "9647501234567", city: "erbil", address: "Ankawa, near the church", variant: "L" });
  });
  it("finds phone, city and size without the AI", () => {
    expect(parseDetails(null, "٠٧٥٠١٢٣٤٥٦٧ هەولێر قیاس L", inStock)).toEqual({ phone: "9647501234567", city: "erbil", variant: "L" });
  });
  it("flags a phone that is not a mobile, and ignores an unknown city code", () => {
    expect(parseDetails({ phone: "12345", city: "paris" }, "", inStock)).toEqual({ badPhone: true });
  });
});

describe("nextStep", () => {
  it("asks for everything a new order lacks, including the size when there are several", () => {
    const r = nextStep(fresh, {}, "I want it", ctx);
    expect(r.step).toBe("ask");
    expect(missingFields(r.order, "ari.shop", inStock)).toEqual(["name", "phone", "city", "address", "variant"]);
    expect(r.order.amountMinor).toBe(0);
    expect(r.reply).toContain("• Mobile number");
  });
  it("shows the summary with the city's fee once all is given, then confirms on yes", () => {
    const d = { name: "Aram", phone: "9647501234567", city: "erbil", address: "Ankawa", variant: "L" };
    const r = nextStep({ ...fresh, collect: "ask" }, d, "...", ctx);
    expect(r.step).toBe("confirm");
    expect(r.reply).toContain("Delivery: 3,000 IQD");
    expect(r.reply).toContain("Total: 30,000 IQD");
    const done = nextStep(r.order, {}, "yes", ctx);
    expect(done.step).toBe("done");
    expect(done.order.collect).toBe("done");
  });
  it("updates and shows the summary again when the buyer corrects a detail instead of saying yes", () => {
    const ready = { ...fresh, customerName: "Aram", phone: "9647501234567", city: "erbil", address: "Ankawa", variantLabel: "L", amountMinor: 27_000, collect: "confirm" };
    const r = nextStep(ready, { city: "duhok" }, "yes, but Duhok", ctx);
    expect(r.step).toBe("confirm");
    expect(r.reply).toContain("Delivery: 5,000 IQD");
  });
  it("says why when the phone is wrong", () => {
    expect(nextStep(fresh, { badPhone: true }, "123", ctx).reply).toMatch(/^That mobile number isn't valid/);
  });
});

it("knows yes in every language the shop answers in", () => {
  for (const y of ["بەڵێ", "باشە 🌷", "نعم", "تمام", "yes", "ok!", "👍"]) expect(isYes(y)).toBe(true);
  for (const n of ["نەخێر", "no", "بەڵێ بەڵام ناونیشانەکە گۆڕا"]) expect(isYes(n)).toBe(false);
});
