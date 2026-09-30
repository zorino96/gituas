import { describe, expect, it } from "vitest";
import { cleanSamples, needsYou, parsePrice, REASON_LABEL, toWesternDigits } from "@/lib/shop/forms";

describe("toWesternDigits", () => {
  it("turns Arabic-Indic and Persian digits into 0-9", () => {
    expect(toWesternDigits("٢٥٬٠٠٠ و ۱۲")).toBe("25٬000 و 12");
  });
});

describe("parsePrice", () => {
  it("reads IQD in any digits and separators", () => {
    expect(parsePrice("25,000", "IQD")).toBe(25000);
    expect(parsePrice("٢٥٬٠٠٠", "IQD")).toBe(25000);
    expect(parsePrice(" 25000 ", "IQD")).toBe(25000);
  });
  it("reads USD into cents", () => {
    expect(parsePrice("19.99", "USD")).toBe(1999);
    expect(parsePrice("20", "USD")).toBe(2000);
    expect(parsePrice("١٢٫٥", "USD")).toBe(1250);
  });
  it("rejects empty, zero, fractions of a dinar and junk", () => {
    for (const bad of ["", "0", "25.5", "abc", "-5", "1e5"]) expect(parsePrice(bad, "IQD")).toBeNull();
    expect(parsePrice("1.234", "USD")).toBeNull();
  });
});

describe("cleanSamples", () => {
  it("trims, drops empties, keeps five, caps length", () => {
    expect(cleanSamples([" a ", "", "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(cleanSamples(["x".repeat(400)])[0]).toHaveLength(300);
  });
});

describe("needsYou", () => {
  it("is true for flags meant for the merchant, false for routine skips", () => {
    for (const r of ["negotiation", "complaint", "abuse", "spam", "other", "low_confidence", "no_product", "private_window", "unclear", "needs_you", "no_action"]) {
      expect(needsYou(r)).toBe(true);
      expect(REASON_LABEL[r]).toBeTruthy();
    }
    for (const r of [null, "self", "store_off", "post_expired", "author_limit", "daily_cap", "thread_paused"]) expect(needsYou(r)).toBe(false);
  });
});
