import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "I make story videos": the owner says how their page earns and the chat writes it down, so a creator is not treated as a seller.

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn() },
  businessProfile: { upsert: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/assistant/run-shop-tool", () => ({ cleanAttachments: () => [], runShopToolNamed: vi.fn(), resolveShop: vi.fn() }));
vi.mock("@/app/app/data", () => ({ loadConnections: vi.fn(), loadAccountLists: vi.fn() }));

import { GOAL_WRITE_TOOLS } from "@/lib/chat/tools/writes-goal";
import { GOAL_VERIFIERS } from "@/lib/chat/verify/goal";
import { ToolRefusal, type ToolCtx, type WriteTool } from "@/lib/chat/types";

const ctx = (lang: "en" | "ckb" | "ar" = "en"): ToolCtx => ({ tenantId: "t1", userId: "u1", role: "OWNER", kind: "shop", lang, threadId: "th", attachments: [], review: false, deadline: Date.now() + 50_000 }) as ToolCtx;
const tool = (): WriteTool => GOAL_WRITE_TOOLS[0];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BUSINESS_PROFILE_ENABLED = "1";
  db.store.findMany.mockResolvedValue([
    { id: "g1", fbPageId: "fb1", igUserId: null },
    { id: "g2", fbPageId: null, igUserId: null },
    { id: "g3", fbPageId: null, igUserId: "ig1" },
  ]);
  db.businessProfile.upsert.mockResolvedValue({});
});
afterEach(() => {
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("set_business_goal", () => {
  it("is a small change of the owner's own answer: shop only, configure, low", () => {
    expect(tool()).toMatchObject({ name: "set_business_goal", risk: "low", permission: "configure", kinds: ["shop"], textFields: ["note"] });
    expect(tool().schema.safeParse({ goal: "monetize" }).success).toBe(true);
    expect(tool().schema.safeParse({ goal: "grow" }).success).toBe(false);
    expect(tool().schema.safeParse({ goal: "sell", extra: 1 }).success).toBe(false);
  });

  it("shows the goal in the person's words", async () => {
    const card = await tool().card(ctx(), { goal: "monetize", note: "story videos" });
    expect(card.lines[0].value).toContain("Monetizing");
    expect(card.lines[1].value).toBe("story videos");
    expect(JSON.stringify(await tool().card(ctx("ckb"), { goal: "monetize" }))).toContain("مۆنەتایز");
  });

  it("saves it for the groups that hold an account, scoped by the workspace", async () => {
    const r = await tool().execute(ctx(), { goal: "monetize", note: "I make mystery stories" });
    expect(r).toMatchObject({ ok: true, data: { goal: "monetize", groups: 2 } });
    expect(db.store.findMany.mock.calls[0][0].where).toEqual({ tenantId: "t1" });
    expect(db.businessProfile.upsert.mock.calls.map((c) => c[0].where.storeId)).toEqual(["g1", "g3"]);
    expect(db.businessProfile.upsert.mock.calls[0][0].update).toEqual({ goal: "monetize", goalText: "I make mystery stories" });
  });

  it("falls back to every group when none holds an account yet, and refuses when there is none at all", async () => {
    db.store.findMany.mockResolvedValue([{ id: "g2", fbPageId: null, igUserId: null }]);
    expect((await tool().execute(ctx(), { goal: "sell" })).ok).toBe(true);
    db.store.findMany.mockResolvedValue([]);
    await expect(tool().card(ctx(), { goal: "sell" })).rejects.toBeInstanceOf(ToolRefusal);
  });

  it("refuses while the setup questions are switched off", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    await expect(tool().card(ctx(), { goal: "sell" })).rejects.toBeInstanceOf(ToolRefusal);
    await expect(tool().execute(ctx(), { goal: "sell" })).rejects.toBeInstanceOf(ToolRefusal);
  });
});

describe("its read-back", () => {
  const run = (goal: string) => GOAL_VERIFIERS.set_business_goal(ctx(), { goal }, { text: "", runId: "r" });
  it("is ok when a group holds the goal, a problem when none does", async () => {
    db.businessProfile.findMany.mockResolvedValue([{ goal: "monetize", storeId: "g1" }, { goal: "sell", storeId: "g3" }]);
    expect(await run("monetize")).toEqual({ status: "ok", checked: ["The goal is saved in 1 group."], problems: [] });
    expect((await run("other"))?.status).toBe("problem");
    expect(db.businessProfile.findMany.mock.calls[0][0].where).toEqual({ store: { tenantId: "t1" } });
  });
});
