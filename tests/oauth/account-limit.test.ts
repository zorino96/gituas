import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    tenant: { findUnique: vi.fn() },
    store: { findMany: vi.fn() },
    oAuthCredential: { findMany: vi.fn() },
  },
}));

import type { OAuthProvider } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AccountLimitError, accountCap, accountRoom, NEWS_ACCOUNT_CAP, SHOP_ACCOUNT_CAP } from "@/lib/oauth/account-limit";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("accountCap", () => {
  it("gives a shop workspace the cap of its best store's plan", () => {
    expect(accountCap("MERCHANT", ["FREE"])).toBe(SHOP_ACCOUNT_CAP.FREE);
    expect(accountCap("MERCHANT", ["FREE", "MERCHANT"])).toBe(SHOP_ACCOUNT_CAP.MERCHANT);
    expect(accountCap("MERCHANT", ["MERCHANT", "PRO", "FREE"])).toBe(SHOP_ACCOUNT_CAP.PRO);
  });

  it("never gives a shop workspace less than the free cap, even with no stores or an unknown plan", () => {
    expect(accountCap("MERCHANT", [])).toBe(SHOP_ACCOUNT_CAP.FREE);
    expect(accountCap("MERCHANT", ["SOMETHING_NEW"])).toBe(SHOP_ACCOUNT_CAP.FREE);
  });

  it("gives a newsroom the cap of its plan, and the manual plan's for one it does not know", () => {
    expect(accountCap("NEWS", ["LITE"])).toBe(NEWS_ACCOUNT_CAP.LITE);
    expect(accountCap("NEWS", ["AUTO"])).toBe(NEWS_ACCOUNT_CAP.AUTO);
    expect(accountCap("NEWS", ["ENTERPRISE"])).toBe(NEWS_ACCOUNT_CAP.ENTERPRISE);
    expect(accountCap("NEWS", ["FUTURE_PLAN"])).toBe(NEWS_ACCOUNT_CAP.MANUAL);
    expect(accountCap("NEWS", [])).toBe(NEWS_ACCOUNT_CAP.MANUAL);
  });

  it("has no cap for any other kind of workspace", () => {
    expect(accountCap("AGENCY", ["PRO"])).toBeNull();
    expect(accountCap("", [])).toBeNull();
  });

  it("rises with the plan, in both products", () => {
    const shop = ["FREE", "MERCHANT", "PRO"].map((p) => SHOP_ACCOUNT_CAP[p]);
    const news = ["LITE", "MANUAL", "AUTO", "ENTERPRISE"].map((p) => NEWS_ACCOUNT_CAP[p]);
    expect([...shop].sort((a, b) => a - b)).toEqual(shop);
    expect([...news].sort((a, b) => a - b)).toEqual(news);
  });
});

describe("AccountLimitError", () => {
  it("carries its cap and a message the connect screens map to a sentence", () => {
    const e = new AccountLimitError(5);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("account_limit");
    expect(e.cap).toBe(5);
  });
});

describe("accountRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const table of Object.values(m)) for (const fn of Object.values(table)) fn.mockReset();
  });

  const have = (...ids: string[]) => m.oAuthCredential.findMany.mockResolvedValue(ids.map((providerAccountId) => ({ providerAccountId })));
  const newsDesk = (plan: string) => m.tenant.findUnique.mockResolvedValue({ kind: "NEWS", plan });
  const shop = (...plans: string[]) => {
    m.tenant.findUnique.mockResolvedValue({ kind: "MERCHANT", plan: "FREE" });
    m.store.findMany.mockResolvedValue(plans.map((plan) => ({ plan })));
  };

  it("lets a new account in while there is room", async () => {
    newsDesk("MANUAL");
    have("p1", "p2");
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p3"])).toEqual({ ok: true });
  });

  it("refuses a new account once the plan's cap is full, and says which cap", async () => {
    newsDesk("MANUAL");
    have("p1", "p2", "p3");
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p4"])).toEqual({ ok: false, cap: NEWS_ACCOUNT_CAP.MANUAL, have: 3 });
  });

  it("always lets an account that is already connected be connected again", async () => {
    newsDesk("MANUAL");
    have("p1", "p2", "p3");
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p2"])).toEqual({ ok: true });
  });

  it("counts only the new accounts of a batch: all or nothing", async () => {
    newsDesk("MANUAL");
    have("p1", "p2");
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p2", "p3"])).toEqual({ ok: true });
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p3", "p4"])).toMatchObject({ ok: false, have: 2 });
  });

  it("counts a repeated id once", async () => {
    newsDesk("MANUAL");
    have("p1", "p2");
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p3", "p3", "p3"])).toEqual({ ok: true });
  });

  it("does not count the placeholder or ad-account rows as accounts", async () => {
    newsDesk("MANUAL");
    have("unknown", "act_123", "act_456", "p1");
    expect(await accountRoom("t1", "META_FACEBOOK" as OAuthProvider, ["p2", "p3"])).toEqual({ ok: true });
  });

  it("reads a shop's cap from its best store", async () => {
    shop("FREE", "PRO");
    have("p1", "p2", "p3", "p4");
    expect(await accountRoom("t1", "YOUTUBE" as OAuthProvider, ["p5"])).toEqual({ ok: true });
    shop("FREE");
    have("p1", "p2");
    expect(await accountRoom("t1", "YOUTUBE" as OAuthProvider, ["p3"])).toEqual({ ok: false, cap: SHOP_ACCOUNT_CAP.FREE, have: 2 });
  });

  it("leaves providers that are not accounts of a platform alone, without asking the database", async () => {
    expect(await accountRoom("t1", "WHATSAPP" as OAuthProvider, ["a", "b", "c", "d", "e", "f", "g", "h"])).toEqual({ ok: true });
    expect(m.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("lets an unknown workspace through (the connect itself fails elsewhere)", async () => {
    m.tenant.findUnique.mockResolvedValue(null);
    expect(await accountRoom("gone", "META_FACEBOOK" as OAuthProvider, ["p1"])).toEqual({ ok: true });
  });
});
