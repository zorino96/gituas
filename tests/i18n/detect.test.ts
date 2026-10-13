import { describe, expect, it } from "vitest";

import { acceptedLanguages, detectLang } from "@/lib/i18n/detect";

describe("acceptedLanguages", () => {
  it("orders by q and keeps the base language", () => {
    expect(acceptedLanguages("de-DE,de;q=0.9,en;q=0.8")).toEqual(["de", "de", "en"]);
    expect(acceptedLanguages("en;q=0.5, ku;q=0.9, ar")).toEqual(["ar", "ku", "en"]);
    expect(acceptedLanguages("*, en;q=0")).toEqual([]);
    expect(acceptedLanguages(null)).toEqual([]);
  });
});

describe("detectLang", () => {
  it("gives the English-speaking world English, whatever else is in the header", () => {
    for (const country of ["US", "GB", "AU", "CA", "NZ", "IE", "DE", "SE", "TR"]) {
      expect(detectLang({ acceptLanguage: "en-US,en;q=0.9", country })).toBe("en");
    }
    expect(detectLang({ acceptLanguage: "de-DE,de;q=0.9,en;q=0.8", country: "DE" })).toBe("en");
  });

  it("gives a language we have nothing for, and a crawler with no header, English", () => {
    expect(detectLang({ acceptLanguage: "fa-IR,fa", country: "IR" })).toBe("en");
    expect(detectLang({ acceptLanguage: null, country: "US" })).toBe("en");
    expect(detectLang({ acceptLanguage: "", country: "us" })).toBe("en");
  });

  it("gives Kurdish and Arabic browsers outside Iraq their own language", () => {
    expect(detectLang({ acceptLanguage: "ckb,en;q=0.5", country: "DE" })).toBe("ckb");
    expect(detectLang({ acceptLanguage: "ku-Arab-IQ,ku;q=0.9", country: "SE" })).toBe("ckb");
    expect(detectLang({ acceptLanguage: "ar-EG,ar;q=0.9,en;q=0.8", country: "EG" })).toBe("ar");
    // the visitor's own order wins
    expect(detectLang({ acceptLanguage: "en-GB,en;q=0.9,ar;q=0.5", country: "GB" })).toBe("en");
  });

  it("keeps Iraq in Sorani", () => {
    expect(detectLang({ acceptLanguage: "en-US,en;q=0.9", country: "IQ" })).toBe("ckb");
    expect(detectLang({ acceptLanguage: "ar-IQ,ar;q=0.9", country: "IQ" })).toBe("ckb");
    expect(detectLang({ acceptLanguage: null, country: "iq" })).toBe("ckb");
  });

  it("lets the public website, and only it, give Arabic browsers in Iraq Arabic", () => {
    const h = { acceptLanguage: "ar-IQ,ar;q=0.9,en;q=0.5", country: "IQ" };
    expect(detectLang({ ...h, arabicInIraq: true })).toBe("ar");
    expect(detectLang(h)).toBe("ckb");
    expect(detectLang({ acceptLanguage: "en-US,en;q=0.9,ar;q=0.5", country: "IQ", arabicInIraq: true })).toBe("ckb");
    expect(detectLang({ acceptLanguage: "ku,ar;q=0.5", country: "IQ", arabicInIraq: true })).toBe("ckb");
  });

  it("keeps the product default when there is no country at all (a local run)", () => {
    expect(detectLang({ acceptLanguage: null, country: null })).toBe("ckb");
    expect(detectLang({ acceptLanguage: "en-US,en", country: null })).toBe("en");
  });
});
