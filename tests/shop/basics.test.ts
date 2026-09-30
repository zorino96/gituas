import { describe, expect, it } from "vitest";
import { dailyCap, SHOP_LIMITS } from "@/lib/shop/plans";
import { hasDigit } from "@/lib/shop/digits";
import { formatMoney } from "@/lib/shop/money";

describe("shop plans", () => {
  it("automates the newest 3 / 25 / all posts", () => {
    expect(SHOP_LIMITS.FREE.posts).toBe(3);
    expect(SHOP_LIMITS.MERCHANT.posts).toBe(25);
    expect(SHOP_LIMITS.PRO.posts).toBeNull();
  });
  it("lets a store cap itself below its plan, never above", () => {
    expect(dailyCap("FREE", null)).toBe(100);
    expect(dailyCap("MERCHANT", 200)).toBe(200);
    expect(dailyCap("FREE", 500)).toBe(100);
  });
});

describe("hasDigit", () => {
  it("finds Western, Arabic-Indic and Persian digits", () => {
    expect(hasDigit("25 هەزار")).toBe(true);
    expect(hasDigit("٢٥ هەزار")).toBe(true);
    expect(hasDigit("۲۵")).toBe(true);
  });
  it("passes text without numbers", () => {
    expect(hasDigit("نرخی چەندە؟")).toBe(false);
    expect(hasDigit("زۆر سوپاس 🌷")).toBe(false);
  });
});

describe("formatMoney", () => {
  it("writes IQD without decimals", () => {
    expect(formatMoney(25000, "IQD", "en")).toBe("25,000 IQD");
    expect(formatMoney(25000, "IQD", "ckb")).toMatch(/^٢٥.٠٠٠ د\.ع$/);
    expect(formatMoney(25000, "IQD", "kmr")).toMatch(/^٢٥.٠٠٠ د\.ع$/);
  });
  it("writes USD with cents only when there are cents", () => {
    expect(formatMoney(1999, "USD", "en")).toBe("$19.99");
    expect(formatMoney(2000, "USD", "en")).toBe("$20");
    expect(formatMoney(1250, "USD", "ar")).toMatch(/^١٢.٥٠ \$$/);
  });
  it("uses Western digits for Kurdish in Latin letters", () => {
    expect(formatMoney(5000, "IQD", "ku_latn")).toBe("5,000 IQD");
  });
});
