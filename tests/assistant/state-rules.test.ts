import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The account snapshot carries the count of the owner's automatic rules, but only while rules are switched on: with the switch off the
// snapshot is exactly what it was and the rules table is never read.

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  conversationMessage: { count: vi.fn() },
  shopRule: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/ai/meter", () => ({ allowanceOf: vi.fn(async () => ({ percent: 12 })), OPTIONAL_SHARE: 0.7 }));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => false) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => false) }));

import { loadAssistantState } from "@/lib/assistant/state";

const conns = { facebook: { connected: true }, instagram: { connected: false }, tiktok: { connected: false }, youtube: { connected: false } };

beforeEach(() => {
  vi.resetAllMocks();
  db.store.findMany.mockResolvedValue([{ id: "s1", name: "Shop A", plan: "FREE", planPaidUntil: null, fbPageId: "fb1", igUserId: null, igUsername: null, automationEnabled: true, pausedReason: null, aiReplies: false, autoMode: "OFF", autoPerDay: 1, videoAutoMode: "OFF" }]);
  db.product.findMany.mockResolvedValue([]);
  db.conversationMessage.count.mockResolvedValue(0);
  delete process.env.SHOP_RULES_ENABLED;
});
afterEach(() => {
  delete process.env.SHOP_RULES_ENABLED;
});

describe("the snapshot and the owner's rules", () => {
  it("says nothing about rules while they are switched off, and does not read the rules table", async () => {
    const s = await loadAssistantState("t1", conns);
    expect("automaticRules" in s).toBe(true);
    expect(s.automaticRules).toBeUndefined();
    expect(db.shopRule.groupBy).not.toHaveBeenCalled();
    // JSON drops an undefined field: the model's copy is exactly what it was before rules existed
    expect(JSON.parse(JSON.stringify(s))).not.toHaveProperty("automaticRules");
  });

  it("counts the workspace's active and paused rules in one grouped query when they are on", async () => {
    process.env.SHOP_RULES_ENABLED = "1";
    db.shopRule.groupBy.mockResolvedValue([
      { status: "ACTIVE", _count: { _all: 2 } },
      { status: "PAUSED", _count: { _all: 1 } },
      { status: "PAUSED_AUTO", _count: { _all: 2 } },
    ]);
    const s = await loadAssistantState("t1", conns);
    expect(s.automaticRules).toEqual({ active: 2, paused: 3 });
    expect(db.shopRule.groupBy).toHaveBeenCalledTimes(1);
    expect(db.shopRule.groupBy.mock.calls[0][0].where).toEqual({ tenantId: "t1", status: { in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] } });
  });

  it("shows zero counts for a workspace without rules, and leaves the line out if the count fails", async () => {
    process.env.SHOP_RULES_ENABLED = "1";
    db.shopRule.groupBy.mockResolvedValue([]);
    expect((await loadAssistantState("t1", conns)).automaticRules).toEqual({ active: 0, paused: 0 });
    db.shopRule.groupBy.mockRejectedValue(new Error("down"));
    expect((await loadAssistantState("t1", conns)).automaticRules).toBeUndefined();
  });
});
