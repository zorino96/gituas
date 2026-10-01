import { afterEach, describe, expect, it, vi } from "vitest";

import { RENDER_TOKEN_TTL_SEC, signRenderToken, verifyRenderToken } from "@/lib/cards/render-token";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("render token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs as <expiry>.<hex>, five minutes ahead", () => {
    const token = signRenderToken("draft1", NOW, SECRET);
    expect(token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(Number(token.split(".")[0])).toBe(NOW / 1000 + RENDER_TOKEN_TTL_SEC);
    expect(RENDER_TOKEN_TTL_SEC).toBe(300);
  });

  it("verifies its own token, for that draft only", () => {
    const token = signRenderToken("draft1", NOW, SECRET);
    expect(verifyRenderToken("draft1", token, NOW, SECRET)).toBe(true);
    expect(verifyRenderToken("draft1", token, NOW + 299_000, SECRET)).toBe(true);
    expect(verifyRenderToken("draft2", token, NOW, SECRET)).toBe(false);
  });

  it("stops working when it runs out", () => {
    const token = signRenderToken("draft1", NOW, SECRET);
    expect(verifyRenderToken("draft1", token, NOW + 300_000, SECRET)).toBe(false);
    expect(verifyRenderToken("draft1", token, NOW + 3_600_000, SECRET)).toBe(false);
  });

  it("refuses a tampered token", () => {
    const token = signRenderToken("draft1", NOW, SECRET);
    const [expiry, hex] = token.split(".");
    const flipped = hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0");
    expect(verifyRenderToken("draft1", `${expiry}.${flipped}`, NOW, SECRET)).toBe(false);
    // A later expiry with the old signature.
    expect(verifyRenderToken("draft1", `${Number(expiry) + 60}.${hex}`, NOW, SECRET)).toBe(false);
    expect(verifyRenderToken("draft1", signRenderToken("draft1", NOW, "another-secret"), NOW, SECRET)).toBe(false);
  });

  it("refuses an expiry further away than a token can be issued for, even when signed", () => {
    const farFuture = signRenderToken("draft1", NOW + 3_600_000, SECRET);
    expect(verifyRenderToken("draft1", farFuture, NOW, SECRET)).toBe(false);
  });

  it("refuses anything malformed", () => {
    for (const bad of [undefined, null, "", "abc", "123", "123.", ".abc", "12.zz", ["a"], `${NOW}.${"g".repeat(64)}`]) {
      expect(verifyRenderToken("draft1", bad, NOW, SECRET)).toBe(false);
    }
    expect(verifyRenderToken("", signRenderToken("", NOW, SECRET), NOW, SECRET)).toBe(false);
  });

  it("fails closed without AUTH_SECRET", () => {
    const token = signRenderToken("draft1", NOW, SECRET);
    vi.stubEnv("AUTH_SECRET", "");
    expect(verifyRenderToken("draft1", token, NOW)).toBe(false);
    expect(verifyRenderToken("draft1", token, NOW, "")).toBe(false);
    expect(() => signRenderToken("draft1", NOW)).toThrow(/AUTH_SECRET/);
  });

  it("uses AUTH_SECRET when no secret is passed", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    expect(verifyRenderToken("draft1", signRenderToken("draft1", NOW), NOW)).toBe(true);
  });
});
