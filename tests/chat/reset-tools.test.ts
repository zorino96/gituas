import { beforeEach, describe, expect, it, vi } from "vitest";

// Starting again from nothing, from inside the chat: disconnect the accounts and remove the products, each only by a card the person confirms.

const db = vi.hoisted(() => ({
  oAuthCredential: { findMany: vi.fn() },
  product: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
}));
const disconnect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/actions", () => ({ disconnectAccountAction: disconnect }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({ cleanAttachments: () => [], runShopToolNamed: vi.fn(), resolveShop: vi.fn() }));
vi.mock("@/app/app/data", () => ({ loadConnections: vi.fn(), loadAccountLists: vi.fn() }));

import { RESET_VERIFIERS } from "@/lib/chat/verify/reset";
import { RESET_WRITE_TOOLS } from "@/lib/chat/tools/writes-reset";
import { decide } from "@/lib/chat/guard";
import { ToolRefusal, type ToolCtx, type WriteTool } from "@/lib/chat/types";

const ctx = (lang: "en" | "ckb" | "ar" = "en"): ToolCtx => ({ tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang, threadId: "th", attachments: [], review: false, deadline: Date.now() + 50_000 }) as ToolCtx;
const tool = (name: string): WriteTool => RESET_WRITE_TOOLS.find((t) => t.name === name)!;

const ACCOUNTS = [
  { provider: "META_FACEBOOK", providerAccountId: "fb1", providerAccountName: "The Secret File" },
  { provider: "META_INSTAGRAM", providerAccountId: "ig1", providerAccountName: "@thesecretfile26" },
  { provider: "META_FACEBOOK", providerAccountId: "act_9", providerAccountName: "an ad account" },
  { provider: "YOUTUBE", providerAccountId: "yt1", providerAccountName: "The Secret File" },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.oAuthCredential.findMany.mockResolvedValue(ACCOUNTS);
  disconnect.mockResolvedValue({ ok: true });
});

describe("the two tools", () => {
  it("are destructive, shop-only, need the configure permission and can never run by themselves", () => {
    for (const t of RESET_WRITE_TOOLS) {
      expect(t.risk).toBe("destructive");
      expect(t.kinds).toEqual(["shop"]);
      expect(t.permission).toBe("configure");
      for (const autonomy of ["ASK", "LOW", "ALL"] as const) expect(decide({ risk: t.risk, autonomy, tainted: false })).toBe("confirm");
    }
  });
});

describe("disconnect_accounts", () => {
  const t = () => tool("disconnect_accounts");

  it("lists every account that will go, by platform, with a warning, and never an ad account", async () => {
    const card = await t().card(ctx(), { which: "all" });
    const text = JSON.stringify(card.lines);
    expect(text).toContain("The Secret File");
    expect(text).toContain("@thesecretfile26");
    expect(text).not.toContain("an ad account");
    expect(card.lines.map((l) => l.label)).toEqual(["Facebook", "Instagram", "YouTube", "Heads up"]);
    expect(card.pin).toEqual({ accounts: ["META_FACEBOOK:fb1", "META_INSTAGRAM:ig1", "YOUTUBE:yt1"] });
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("can be limited to one platform", async () => {
    const card = await t().card(ctx(), { which: "instagram" });
    expect(card.pin).toEqual({ accounts: ["META_INSTAGRAM:ig1"] });
  });

  it("refuses when nothing of that kind is connected", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([]);
    await expect(t().card(ctx(), { which: "tiktok" })).rejects.toBeInstanceOf(ToolRefusal);
  });

  it("disconnects through the app's own action, only the accounts the card showed", async () => {
    // an account connected after the card is not added
    db.oAuthCredential.findMany.mockResolvedValue([...ACCOUNTS, { provider: "TIKTOK", providerAccountId: "tt-new", providerAccountName: "new" }]);
    const r = await t().execute(ctx(), { which: "all", accounts: ["META_FACEBOOK:fb1", "META_INSTAGRAM:ig1"] });
    expect(r).toMatchObject({ ok: true, text: "2 accounts were disconnected." });
    expect(disconnect.mock.calls).toEqual([["META_FACEBOOK", "fb1"], ["META_INSTAGRAM", "ig1"]]);
  });

  it("says so when only some could be disconnected, and when none could", async () => {
    disconnect.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "x" });
    const some = await t().execute(ctx(), { which: "all", accounts: ["META_FACEBOOK:fb1", "META_INSTAGRAM:ig1"] });
    expect(some).toMatchObject({ ok: true, text: "1 disconnected, but 1 could not be." });
    disconnect.mockResolvedValue({ ok: false, error: "x" });
    const none = await t().execute(ctx(), { which: "all", accounts: ["META_FACEBOOK:fb1"] });
    expect(none.ok).toBe(false);
  });

  it("speaks Sorani and Arabic without the word شاپ", async () => {
    for (const lang of ["ckb", "ar"] as const) {
      const card = await t().card(ctx(lang), { which: "all" });
      expect(JSON.stringify(card)).not.toContain("شاپ");
      expect(card.lines.at(-1)!.value.length).toBeGreaterThan(40);
    }
  });
});

describe("remove_all_products", () => {
  const t = () => tool("remove_all_products");

  it("shows how many and which, scoped by the workspace", async () => {
    db.product.count.mockResolvedValue(7);
    db.product.findMany.mockResolvedValue([{ name: "Shampoo" }, { name: "Minoxidil" }]);
    const card = await t().card(ctx(), { all: true });
    expect(card.lines[0]).toEqual({ label: "Products", value: "7" });
    expect(card.lines[1].value).toContain("Shampoo");
    expect(card.lines[1].value).toContain("…");
    expect(db.product.count.mock.calls[0][0].where).toEqual({ active: true, store: { tenantId: "t1" } });
  });

  it("refuses when there is nothing to remove", async () => {
    db.product.count.mockResolvedValue(0);
    db.product.findMany.mockResolvedValue([]);
    await expect(t().card(ctx(), { all: true })).rejects.toBeInstanceOf(ToolRefusal);
  });

  it("takes them off the screen (active false), only this workspace's", async () => {
    db.product.updateMany.mockResolvedValue({ count: 7 });
    const r = await t().execute(ctx(), { all: true });
    expect(r).toMatchObject({ ok: true, text: "7 products were removed." });
    expect(db.product.updateMany.mock.calls[0][0]).toEqual({ where: { active: true, store: { tenantId: "t1" } }, data: { active: false } });
  });

  it("needs all: true in the arguments", () => {
    expect(t().schema.safeParse({}).success).toBe(false);
    expect(t().schema.safeParse({ all: false }).success).toBe(false);
    expect(t().schema.safeParse({ all: true }).success).toBe(true);
  });
});

describe("the read-backs", () => {
  it("disconnect: ok when none of the shown accounts is left, a problem when one is", async () => {
    db.oAuthCredential.findMany.mockResolvedValue([{ provider: "TIKTOK", providerAccountId: "other" }]);
    const ok = await RESET_VERIFIERS.disconnect_accounts(ctx(), { which: "all", accounts: ["META_FACEBOOK:fb1", "META_INSTAGRAM:ig1"] }, { text: "", runId: "r" });
    expect(ok).toEqual({ status: "ok", checked: ["2 accounts are no longer connected."], problems: [] });
    db.oAuthCredential.findMany.mockResolvedValue([{ provider: "META_FACEBOOK", providerAccountId: "fb1" }]);
    const bad = await RESET_VERIFIERS.disconnect_accounts(ctx(), { which: "all", accounts: ["META_FACEBOOK:fb1", "META_INSTAGRAM:ig1"] }, { text: "", runId: "r" });
    expect(bad?.status).toBe("problem");
    expect(bad?.problems[0]).toContain("still connected");
    expect(db.oAuthCredential.findMany.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("disconnect: says nothing when it does not know which accounts were meant", async () => {
    expect(await RESET_VERIFIERS.disconnect_accounts(ctx(), { which: "all" }, { text: "", runId: "r" })).toBeNull();
  });

  it("products: ok when none is active, a problem otherwise", async () => {
    db.product.count.mockResolvedValue(0);
    expect((await RESET_VERIFIERS.remove_all_products(ctx(), { all: true }, { text: "", runId: "r" }))?.status).toBe("ok");
    db.product.count.mockResolvedValue(3);
    const bad = await RESET_VERIFIERS.remove_all_products(ctx(), { all: true }, { text: "", runId: "r" });
    expect(bad?.status).toBe("problem");
    expect(bad?.problems[0]).toContain("3 products are still");
  });
});
