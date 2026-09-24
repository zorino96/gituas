import { describe, expect, it } from "vitest";

import { codeMatches, hashCode, newCode, normalizeCode } from "@/lib/email-code";

const SECRET = "test-secret";

describe("email codes", () => {
  it("makes six digits, keeping leading zeros", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("reads Kurdish keyboard digits and pasted spaces", () => {
    expect(normalizeCode("١٢٣٤٥٦")).toBe("123456");
    expect(normalizeCode("۰۱۲ ۳۴۵")).toBe("012345");
    expect(normalizeCode(" 048 213 ")).toBe("048213");
    expect(normalizeCode("048-213")).toBe("048213");
  });

  it("refuses anything that is not six digits", () => {
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("1234567")).toBeNull();
    expect(normalizeCode("12a456")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });

  it("matches only the same code for the same address", () => {
    const stored = hashCode("a@b.co", "123456", SECRET);
    expect(stored).not.toContain("123456");
    expect(codeMatches("a@b.co", "123456", stored, SECRET)).toBe(true);
    expect(codeMatches("a@b.co", "123457", stored, SECRET)).toBe(false);
    expect(codeMatches("x@b.co", "123456", stored, SECRET)).toBe(false);
    expect(codeMatches("a@b.co", "123456", stored, "other-secret")).toBe(false);
  });

  it("fails closed on a malformed stored hash", () => {
    expect(codeMatches("a@b.co", "123456", "", SECRET)).toBe(false);
    expect(codeMatches("a@b.co", "123456", "not-hex", SECRET)).toBe(false);
  });
});
