import { describe, it, expect } from "vitest";
import { CITIES, cityLabel, isCityCode } from "@/lib/orders/cities";

describe("CITIES", () => {
  it("has a unique code for every governorate", () => {
    const codes = CITIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]+$/);
  });

  it("has a Sorani and an Arabic label for every code, and no label is repeated", () => {
    for (const c of CITIES) {
      expect(c.ckb.trim().length).toBeGreaterThan(0);
      expect(c.ar.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(CITIES.map((c) => c.ckb)).size).toBe(CITIES.length);
    expect(new Set(CITIES.map((c) => c.ar)).size).toBe(CITIES.length);
  });

  it("lists the Kurdistan Region first, in the agreed order", () => {
    expect(CITIES.slice(0, 5).map((c) => c.code)).toEqual(["erbil", "sulaymaniyah", "duhok", "halabja", "kirkuk"]);
  });

  it("covers the other governorates the plan names", () => {
    const codes = CITIES.map((c) => c.code);
    for (const code of ["baghdad", "basra", "nineveh", "anbar", "babil", "karbala", "najaf", "diyala", "wasit", "maysan", "dhiqar", "muthanna", "qadisiyah", "salahaddin"]) {
      expect(codes).toContain(code);
    }
  });
});

describe("cityLabel", () => {
  it("returns the label in the asked language, Sorani by default", () => {
    expect(cityLabel("erbil", "ckb")).toBe("هەولێر");
    expect(cityLabel("erbil", "ar")).toBe("أربيل");
    expect(cityLabel("nineveh")).toBe("نەینەوا (مووسڵ)");
  });

  it("returns an empty string for an empty or unknown code", () => {
    expect(cityLabel(null)).toBe("");
    expect(cityLabel("")).toBe("");
    expect(cityLabel("atlantis", "ar")).toBe("");
  });
});

describe("isCityCode", () => {
  it("accepts only known codes", () => {
    expect(isCityCode("duhok")).toBe(true);
    expect(isCityCode("Duhok")).toBe(false);
    expect(isCityCode("")).toBe(false);
  });
});
