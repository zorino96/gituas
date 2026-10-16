import { describe, expect, it } from "vitest";

import { SHOP_ACCOUNT_CAP } from "@/lib/oauth/account-limit";
import { SHOP_LIMITS, STORE_PLANS, tenantLimits } from "@/lib/shop/plans";
import { codeProblem, hashCode, looksLikeCode, makeCode, normalizeCode } from "@/lib/shop/redeem-code";

const NOW = new Date("2026-10-16T12:00:00Z");
const open = { maxUses: 2, uses: 0, expiresAt: null, revokedAt: null };

describe("a test code", () => {
  it("is read the same however it was typed", () => {
    const a = "GT-ABCD-EFGH-JKMN-PQRS";
    for (const typed of [a, a.toLowerCase(), " gt abcd efgh jkmn pqrs ", "GT_ABCD.EFGH-JKMN-PQRS", "GT-ABCD-EFGH-JKMN-PQRS​"]) {
      expect(normalizeCode(typed)).toBe("GTABCDEFGHJKMNPQRS");
      expect(hashCode(typed)).toBe(hashCode(a));
    }
    // The private script gituas-private/codes.cjs hashes the same way: if this digest changes, a code it minted stops working.
    expect(hashCode(a)).toBe("30a7d66f7e08de3fc53dc233bea4b3883a19f92202b278f09592cbafadab5143");
    expect(hashCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(a)).not.toContain("ABCD");
  });

  it("is made of 16 clear characters in groups, and every new one is different", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = makeCode();
      expect(c).toMatch(/^GT-[A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4}-[A-HJKMN-Z2-9]{4}$/);
      expect(looksLikeCode(c)).toBe(true);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
  });

  it("is not accepted when it does not look like one (nothing reaches the database)", () => {
    for (const bad of ["", "hello", "GT-ABCD", "XX-ABCD-EFGH-JKMN-PQRS", "GT-ABCD-EFGH-JKMN-PQRS-TUVW", "GT-ABC!-EFGH-JKMN-PQRS"]) expect(looksLikeCode(bad), bad).toBe(false);
  });
});

describe("codeProblem", () => {
  it("lets an open code through", () => {
    expect(codeProblem(open, NOW)).toBeNull();
    expect(codeProblem({ ...open, uses: 1 }, NOW)).toBeNull();
    expect(codeProblem({ ...open, expiresAt: new Date(NOW.getTime() + 1000) }, NOW)).toBeNull();
  });

  it("refuses an unknown, revoked, expired or used-up code", () => {
    expect(codeProblem(null, NOW)).toBe("unknown");
    expect(codeProblem({ ...open, revokedAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("revoked");
    expect(codeProblem({ ...open, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("expired");
    expect(codeProblem({ ...open, expiresAt: NOW }, NOW)).toBe("expired");
    expect(codeProblem({ ...open, uses: 2 }, NOW)).toBe("used");
  });
});

describe("the UNLIMITED plan", () => {
  it("is never sold, and is above every sold plan in every allowance", () => {
    expect(STORE_PLANS).not.toContain("UNLIMITED");
    const u = SHOP_LIMITS.UNLIMITED;
    for (const p of STORE_PLANS) {
      const l = SHOP_LIMITS[p];
      expect(u.repliesPerDay).toBeGreaterThan(l.repliesPerDay);
      expect(u.aiVaryPerMonth).toBeGreaterThan(l.aiVaryPerMonth);
      expect(u.smartPerMonth).toBeGreaterThan(l.smartPerMonth);
      expect(u.voiceNotesPerDay).toBeGreaterThan(l.voiceNotesPerDay);
      expect(u.aiUsd).toBeGreaterThan(l.aiUsd);
      expect(u.aiOpusUsd).toBeGreaterThan(l.aiOpusUsd);
      expect(u.videosPerMonth).toBeGreaterThan(l.videosPerMonth);
      expect(u.imagesPerMonth).toBeGreaterThan(l.imagesPerMonth);
      expect(SHOP_ACCOUNT_CAP.UNLIMITED).toBeGreaterThan(SHOP_ACCOUNT_CAP[p]);
    }
    expect(u.posts).toBeNull();
  });

  it("counts once per workspace however many shops it has, with both kinds of video open", () => {
    const one = tenantLimits(["UNLIMITED"]);
    const many = tenantLimits(["UNLIMITED", "UNLIMITED", "UNLIMITED"]);
    expect(many.aiUsd).toBe(one.aiUsd);
    expect(many.aiOpusUsd).toBe(one.aiOpusUsd);
    expect(many.imagesPerDay).toBe(one.imagesPerDay);
    expect(one.videos.LITE).toBeGreaterThan(0);
    expect(one.videos.PRO).toBeGreaterThan(0);
    expect(one.aiOpusUsd).toBeGreaterThan(0);
  });
});
