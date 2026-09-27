import { describe, it, expect } from "vitest";
import { hashInviteToken, INVITE_TTL_MS, inviteLink, inviteState, newInviteToken, normalizeEmail } from "@/lib/newsroom/invite";

describe("invite tokens", () => {
  it("makes a long random token and stores only its hash", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.tokenHash).toBe(hashInviteToken(a.token));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });
  it("lasts seven days", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("inviteState", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("is ok while unused and unexpired", () => {
    expect(inviteState({ acceptedAt: null, expiresAt: new Date("2026-09-29T00:00:00Z") }, now)).toBe("ok");
  });
  it("is used once accepted, even if also expired", () => {
    expect(inviteState({ acceptedAt: now, expiresAt: new Date("2026-09-01T00:00:00Z") }, now)).toBe("used");
  });
  it("is expired at or after its expiry", () => {
    expect(inviteState({ acceptedAt: null, expiresAt: now }, now)).toBe("expired");
  });
});

describe("normalizeEmail and inviteLink", () => {
  it("lower-cases and trims a valid email", () => {
    expect(normalizeEmail("  Ali@Rudaw.NET ")).toBe("ali@rudaw.net");
  });
  it("rejects anything that is not an email", () => {
    expect(normalizeEmail("ali")).toBeNull();
    expect(normalizeEmail("a b@c.d")).toBeNull();
    expect(normalizeEmail(`${"a".repeat(250)}@x.io`)).toBeNull();
  });
  it("builds the join link without a double slash", () => {
    expect(inviteLink("https://gituas.vercel.app/", "tok")).toBe("https://gituas.vercel.app/newsroom/join/tok");
  });
});
