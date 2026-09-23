import { describe, it, expect } from "vitest";
import { normalizePhone, waLink } from "@/lib/merchant/phone";

describe("normalizePhone", () => {
  it("turns a local Iraqi mobile into international digits", () => {
    expect(normalizePhone("0750 123 4567")).toEqual({ ok: true, digits: "9647501234567" });
  });
  it("accepts Arabic-Indic and Persian digits", () => {
    expect(normalizePhone("٠٧٥٠١٢٣٤٥٦٧")).toEqual({ ok: true, digits: "9647501234567" });
    expect(normalizePhone("۰۷۷۰۱۲۳۴۵۶۷")).toEqual({ ok: true, digits: "9647701234567" });
  });
  it("accepts +964, 00964 and bare 7xx forms", () => {
    expect(normalizePhone("+964 750 123 4567")).toEqual({ ok: true, digits: "9647501234567" });
    expect(normalizePhone("00964-750-123-4567")).toEqual({ ok: true, digits: "9647501234567" });
    expect(normalizePhone("7501234567")).toEqual({ ok: true, digits: "9647501234567" });
  });
  it("accepts a foreign number in international form", () => {
    expect(normalizePhone("+44 7700 900123")).toEqual({ ok: true, digits: "447700900123" });
  });
  it("rejects empty, letters and wrong lengths", () => {
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("0750abc4567").ok).toBe(false);
    expect(normalizePhone("0750 123").ok).toBe(false);
    expect(normalizePhone("07501234567890").ok).toBe(false);
  });
});

describe("waLink", () => {
  it("builds a wa.me link with encoded text", () => {
    expect(waLink("9647501234567", "سڵاو 1")).toBe(
      "https://wa.me/9647501234567?text=" + encodeURIComponent("سڵاو 1"),
    );
  });
  it("omits text when none is given", () => {
    expect(waLink("9647501234567")).toBe("https://wa.me/9647501234567");
  });
});
