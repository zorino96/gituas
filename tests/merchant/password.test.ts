import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordProblem, normalizeEmail } from "@/lib/password";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const h = await hashPassword("correct horse 9");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 9", h)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const h = await hashPassword("correct horse 9");
    expect(await verifyPassword("correct horse 8", h)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("treats a malformed or empty stored hash as a failed check, never a throw", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "scrypt$bad")).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("requires at least 8 characters", () => expect(passwordProblem("short")).toBe("too-short"));
  it("caps absurd lengths", () => expect(passwordProblem("a".repeat(201))).toBe("too-long"));
  it("accepts a normal password", () => expect(passwordProblem("کوردستان2026")).toBeNull());
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => expect(normalizeEmail("  Zrng@Example.COM ")).toBe("zrng@example.com"));
  it("rejects things that are not an address", () => {
    expect(normalizeEmail("zrng")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});
