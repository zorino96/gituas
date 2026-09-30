import { describe, expect, it } from "vitest";
import { answerText, COPY, DEFAULT_SAMPLES, dmText, fbCardElements, truncate, waText, type CardProduct, type CardStore } from "@/lib/shop/compose";
import { LANGS } from "@/lib/shop/money";
import { hasDigit } from "@/lib/shop/digits";

const hoodie: CardProduct = {
  name: "Hoodie",
  photos: ["https://x/1.jpg", "https://x/2.jpg"],
  variants: [
    { label: "M", amountMinor: 25000, currency: "IQD", inStock: true },
    { label: "L", amountMinor: 27000, currency: "IQD", inStock: false },
  ],
};
const oneprice: CardProduct = { name: "Bag", photos: [], variants: [{ label: "", amountMinor: 15000, currency: "IQD", inStock: true }] };
const store: CardStore = { deliveryFeeMinor: 5000, deliveryCurrency: "IQD", deliveryTime: "1-2 days" };
const WA = "https://gituas.com/w/s?t=x";

describe("dmText", () => {
  it("lists variants, delivery and the order link", () => {
    expect(dmText({ greeting: "Hi!", product: hoodie, store, lang: "en", waUrl: WA })).toBe(
      "Hi!\nHoodie\n• M: 25,000 IQD\n• L: Sold out\nDelivery: 5,000 IQD — 1-2 days\nTo order: https://gituas.com/w/s?t=x",
    );
  });
  it("writes one price without a bullet, free delivery, and no link", () => {
    expect(dmText({ greeting: "Hi!", product: oneprice, store: { ...store, deliveryFeeMinor: 0, deliveryTime: null }, lang: "en", waUrl: null })).toBe(
      "Hi!\nBag\nPrice: 15,000 IQD\nFree delivery",
    );
  });
  it("writes Sorani with Arabic-Indic digits", () => {
    expect(dmText({ greeting: COPY.ckb.hello, product: hoodie, store, lang: "ckb", waUrl: null })).toMatch(/• M: ٢٥.٠٠٠ د\.ع/);
  });
});

describe("answerText", () => {
  it("answers price, delivery and sizes from the card", () => {
    expect(answerText("price", hoodie, store, "en", null)).toBe("Hoodie\n• M: 25,000 IQD\n• L: Sold out");
    expect(answerText("delivery", hoodie, store, "en", null)).toBe("Delivery: 5,000 IQD — 1-2 days");
    expect(answerText("size_colour", hoodie, store, "en", null)).toBe("Available: M");
  });
  it("adds the order link, and returns null when there is nothing to say", () => {
    expect(answerText("none", hoodie, store, "en", WA)).toBe("To order: https://gituas.com/w/s?t=x");
    expect(answerText("delivery", hoodie, { deliveryFeeMinor: null, deliveryCurrency: "IQD", deliveryTime: null }, "en", null)).toBeNull();
  });
});

describe("fbCardElements", () => {
  it("makes one element per variant, cycling photos, with the order button", () => {
    const els = fbCardElements(hoodie, store, "en", WA);
    expect(els).toHaveLength(2);
    expect(els[0]).toEqual({
      title: "Hoodie — M",
      subtitle: "25,000 IQD · Delivery: 5,000 IQD — 1-2 days",
      image_url: "https://x/1.jpg",
      buttons: [{ type: "web_url", url: WA, title: "Order now" }],
    });
    expect(els[1]).toMatchObject({ title: "Hoodie — L", subtitle: "Sold out · Delivery: 5,000 IQD — 1-2 days", image_url: "https://x/2.jpg" });
  });
  it("makes one element per photo for a single-price product, capped at 10", () => {
    const many = { ...oneprice, photos: Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`) };
    const els = fbCardElements(many, store, "en", null);
    expect(els).toHaveLength(10);
    expect(els[0].buttons).toBeUndefined();
  });
  it("keeps subtitles within Meta's 80 characters", () => {
    const long = { ...store, deliveryTime: "x".repeat(200) };
    for (const el of fbCardElements(hoodie, long, "en", WA)) expect(el.subtitle!.length).toBeLessThanOrEqual(80);
  });
});

describe("helpers", () => {
  it("truncates at a word boundary with an ellipsis", () => {
    expect(truncate("short", 80)).toBe("short");
    const t = truncate("word ".repeat(30), 20);
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t.endsWith("…")).toBe(true);
  });
  it("names the product and first in-stock price for WhatsApp", () => {
    expect(waText(hoodie, "en")).toBe("Hoodie — 25,000 IQD");
  });
  it("ships default samples and greetings for every language, none with digits", () => {
    for (const lang of LANGS) {
      expect(DEFAULT_SAMPLES.answer[lang].length).toBeGreaterThan(0);
      expect(DEFAULT_SAMPLES.thanks[lang].length).toBeGreaterThan(0);
      for (const s of [...DEFAULT_SAMPLES.answer[lang], ...DEFAULT_SAMPLES.thanks[lang], COPY[lang].hello]) expect(hasDigit(s)).toBe(false);
    }
  });
});
