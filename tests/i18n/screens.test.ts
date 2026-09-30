import { describe, expect, it } from "vitest";

import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";

// The settings, automation, products, billing and orders screens take their text from the dictionaries.
// dictionaries.test.ts checks the key sets; these pin down the text that has a variable in it.
describe("billing text", () => {
  it("keeps the Sorani wording exactly as it was", () => {
    expect(ckb.billing.plan("پرۆ")).toBe("پلان: پرۆ");
    expect(ckb.billing.activeUntil("٣٠ی ئەیلوول ٢٠٢٦")).toBe("چالاکە تا ٣٠ی ئەیلوول ٢٠٢٦");
    expect(ckb.billing.trialLeft(14)).toBe("تاقیکردنەوە: 14 ڕۆژ ماوە");
    expect(ckb.billing.buy("پرۆ", "١٢٬٠٠٠ د.ع")).toBe("کڕین پرۆ — ١٢٬٠٠٠ د.ع بۆ مانگێک");
    expect(ckb.billing.renew("بازرگان", "٨٬٠٠٠ د.ع")).toBe("نوێکردنەوە بازرگان — ٨٬٠٠٠ د.ع بۆ مانگێک");
  });

  it("counts the trial days in Arabic", () => {
    expect(ar.billing.trialLeft(1)).toBe("المتبقي من التجربة: يوم واحد");
    expect(ar.billing.trialLeft(2)).toBe("المتبقي من التجربة: يومان");
    expect(ar.billing.trialLeft(5)).toBe("المتبقي من التجربة: ٥ أيام");
    expect(ar.billing.trialLeft(14)).toBe("المتبقي من التجربة: ١٤ يوماً");
  });

  it("words the buy and renew buttons with the plan and the price", () => {
    expect(ar.billing.buy("تاجر", "٨٬٠٠٠ د.ع")).toBe("شراء باقة تاجر — ٨٬٠٠٠ د.ع شهرياً");
    expect(ar.billing.renew("تاجر", "٨٬٠٠٠ د.ع")).toBe("تجديد باقة تاجر — ٨٬٠٠٠ د.ع شهرياً");
  });
});

describe("orders text", () => {
  it("counts orders in each language", () => {
    expect(ckb.orders.count(3)).toBe("٣ داواکاری");
    expect(ar.orders.count(1)).toBe("طلب واحد");
    expect(ar.orders.count(2)).toBe("طلبان");
    expect(ar.orders.count(7)).toBe("٧ طلبات");
    expect(ar.orders.count(12)).toBe("١٢ طلباً");
  });

  it("names every order status and source in both languages", () => {
    for (const key of ["NEW", "CONFIRMED", "SENT", "DELIVERED", "RETURNED", "CANCELLED"] as const) {
      expect(ckb.orders.status[key]).toBeTruthy();
      expect(ar.orders.status[key]).toBeTruthy();
    }
    expect(Object.keys(ar.orders.source)).toEqual(Object.keys(ckb.orders.source));
  });
});

describe("settings text", () => {
  it("has a message for every OAuth error the settings page can show", () => {
    expect(Object.keys(ar.settings.connectErrors).sort()).toEqual(["access_denied", "provider_mismatch", "state_expired", "token_exchange_failed"]);
    expect(Object.keys(ar.settings.connNote)).toEqual(["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"]);
  });
});
