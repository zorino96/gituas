import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  conversationMessage: { findMany: vi.fn(), count: vi.fn() },
  auditLog: { count: vi.fn() },
  businessProfile: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { collectFacts, factsText, hasActivity } from "@/lib/coach/facts";

const NOW = Date.parse("2026-10-25T07:00:00Z"); // Sunday 10:00 in Baghdad
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY);

/** Words a buyer or a staff member typed: none of them may reach the facts. */
const SECRETS = ["SECRET-BUYER-NAME", "SECRET-NOTE call 07501234567", "SECRET-ADDRESS Gulan street", "SECRET-MESSAGE text", "SECRET-PHONE"];
const FREE_TEXT_COLUMNS = ["content", "note", "customerName", "phone", "address", "authorName", "authorHandle", "transcript", "generatedReply", "reasoning", "variantLabel", "lastError"];

const order = (over: Record<string, unknown>) => ({
  createdAt: ago(1),
  amountMinor: 25_000,
  currency: "IQD",
  status: "NEW",
  productId: "p1",
  city: "erbil",
  // columns the code must never ask for; a careless query would bring them in
  customerName: SECRETS[0],
  note: SECRETS[1],
  address: SECRETS[2],
  phone: SECRETS[4],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BUSINESS_PROFILE_ENABLED;
  db.store.findMany.mockResolvedValue([{ id: "s1" }]);
  db.product.findMany.mockResolvedValue([
    { id: "p1", name: "Red bag" },
    { id: "p2", name: "Blue shoe" },
  ]);
  db.order.findMany.mockResolvedValue([
    order({ createdAt: ago(1) }),
    order({ createdAt: ago(2), status: "DELIVERED" }),
    order({ createdAt: ago(3), productId: "p2", amountMinor: 40_000, city: "duhok" }),
    order({ createdAt: ago(4), status: "CANCELLED" }),
    order({ createdAt: ago(9) }),
    order({ createdAt: ago(10), amountMinor: 30_000 }),
    order({ createdAt: ago(20) }),
  ]);
  db.conversationMessage.findMany.mockImplementation(async ({ where }: { where: { commentType?: unknown; channelType?: string } }) => {
    if (where.commentType) {
      return [
        ...Array.from({ length: 12 }, () => ({ boundProductId: "p1", commentType: "QUESTION", intent: "price", content: SECRETS[3] })),
        ...Array.from({ length: 2 }, () => ({ boundProductId: "p1", commentType: "NEGOTIATION", intent: null, content: SECRETS[3] })),
      ];
    }
    return Array.from({ length: 12 }, (_, i) => ({ createdAt: new Date(NOW - i * 3_600_000), language: "ckb", content: SECRETS[3] }));
  });
  db.conversationMessage.count.mockImplementation(async ({ where }: { where: { outcome?: string; channelType?: string; createdAt: { lte?: Date } } }) => {
    if (where.outcome === "FLAGGED") return 4;
    const before = !!where.createdAt.lte;
    if (where.channelType === "DM") return before ? 40 : 55;
    return before ? 100 : 120;
  });
  db.auditLog.count.mockImplementation(async ({ where }: { where: { action: string } }) => (where.action === "app.publish" ? 3 : 2));
  db.businessProfile.findMany.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("collectFacts", () => {
  it("counts this week's orders against the week before, cancelled ones apart", async () => {
    const f = await collectFacts("t1", NOW);
    expect(f.v).toBe(1);
    expect(f.week).toBe("2026-W43");
    expect(f.orders.week).toBe(3);
    expect(f.orders.before).toBe(2);
    expect(f.orders.cancelled).toBe(1);
    expect(f.orders.sales).toEqual({ IQD: 90_000 });
    expect(f.orders.salesBefore).toEqual({ IQD: 55_000 });
    // the week before had fewer than ten orders: no percentage
    expect(f.orders.changePct).toBeNull();
    expect(f.orders.byStatus).toEqual({ NEW: 2, DELIVERED: 1, CANCELLED: 1 });
    expect(f.orders.top).toEqual([
      { name: "Red bag", orders: 2 },
      { name: "Blue shoe", orders: 1 },
    ]);
  });

  it("gives a percentage only when the week before has ten orders or more", async () => {
    db.order.findMany.mockResolvedValue([
      ...Array.from({ length: 15 }, () => order({ createdAt: ago(1) })),
      ...Array.from({ length: 10 }, () => order({ createdAt: ago(9) })),
    ]);
    expect((await collectFacts("t1", NOW)).orders.changePct).toBe(50);
  });

  it("reads each product's asks, orders and bargains over 28 days", async () => {
    const f = await collectFacts("t1", NOW);
    const bag = f.interest.find((p) => p.name === "Red bag");
    expect(bag).toEqual({ name: "Red bag", asks: 12, orders: 5, haggles: 2, haggleSharePct: 14 });
  });

  it("keeps money in the currency's main unit and the currencies apart", async () => {
    db.order.findMany.mockResolvedValue([order({ createdAt: ago(1), amountMinor: 1_250, currency: "USD" }), order({ createdAt: ago(1), amountMinor: 50_000 })]);
    const f = await collectFacts("t1", NOW);
    expect(f.orders.sales).toEqual({ USD: 12.5, IQD: 50_000 });
  });

  it("counts the messages, the comments, the pile waiting for the owner and the posts", async () => {
    const f = await collectFacts("t1", NOW);
    expect(f.messages).toEqual({ dm: 55, dmBefore: 40, comments: 120, commentsBefore: 100 });
    expect(f.waiting).toBe(4);
    expect(f.posts).toEqual({ published: 3, byAutopilot: 2 });
  });

  it("finds where and when buyers are, from order cities and message hours", async () => {
    const f = await collectFacts("t1", NOW);
    expect(f.buyers.cities).toEqual(["erbil", "duhok"]);
    expect(f.buyers.messages).toBe(12);
    expect(f.buyers.hours.length).toBeGreaterThan(0);
    expect(f.buyers.hours.every((h) => h >= 0 && h <= 23)).toBe(true);
  });

  it("leaves an unknown city code out", async () => {
    db.order.findMany.mockResolvedValue([order({ createdAt: ago(1), city: "Atlantis" }), order({ createdAt: ago(1), city: "erbil" })]);
    expect((await collectFacts("t1", NOW)).buyers.cities).toEqual(["erbil"]);
  });

  it("asks only for numbers, codes and ids: never a name, a note, a phone, an address or a message", async () => {
    await collectFacts("t1", NOW);
    for (const call of [...db.order.findMany.mock.calls, ...db.conversationMessage.findMany.mock.calls, ...db.product.findMany.mock.calls, ...db.store.findMany.mock.calls]) {
      const select = call[0].select as Record<string, boolean>;
      expect(select, "every query lists its columns").toBeTruthy();
      for (const column of FREE_TEXT_COLUMNS) expect(Object.keys(select), column).not.toContain(column);
    }
    // every query is scoped to the workspace
    expect(db.order.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t1" });
    expect(db.conversationMessage.findMany.mock.calls[0][0].where).toMatchObject({ store: { tenantId: "t1" }, direction: "INBOUND" });
    expect(db.auditLog.count.mock.calls[0][0].where).toMatchObject({ tenantId: "t1" });
  });

  it("carries none of the words a buyer or a staff member wrote, even when the rows hold them", async () => {
    const f = await collectFacts("t1", NOW);
    const text = JSON.stringify(f) + factsText(f);
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(text).not.toMatch(/07501234567|Gulan/);
  });

  it("has no owner's words and no goal while the setup interview is off", async () => {
    const f = await collectFacts("t1", NOW);
    expect(f.goal).toEqual({ kind: null, text: null });
    expect(f.profile).toEqual([]);
    expect(f.lang).toBe("ckb");
    expect(db.businessProfile.findMany).not.toHaveBeenCalled();
  });

  it("brings in the owner's goal, language and profile lines from the setup interview when it is on", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockResolvedValue([
      {
        storeId: "s1",
        goal: "grow",
        goalText: "more followers",
        category: "fashion",
        offerLine: "Leather bags",
        customer: ["women"],
        sellsTo: [],
        language: "ar",
        tone: "friendly",
        facts: [],
        interview: { step: 5, answered: [], skipped: [], doneAt: "2026-10-16T10:00:00.000Z" },
      },
    ]);
    const f = await collectFacts("t1", NOW);
    expect(f.goal).toEqual({ kind: "grow", text: "more followers" });
    expect(f.lang).toBe("ar");
    expect(f.profile).toContain("What they offer: Leather bags");
    expect(f.profile).toContain("The owner's goal with Gituas: more followers.");
  });

  it("falls back to the goal-less shop when the profile table cannot be read", async () => {
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockRejectedValue(new Error("relation does not exist"));
    const f = await collectFacts("t1", NOW);
    expect(f.goal.kind).toBeNull();
    expect(f.profile).toEqual([]);
  });
});

describe("hasActivity and factsText", () => {
  it("is false for a shop with nothing counted", async () => {
    db.order.findMany.mockResolvedValue([]);
    db.conversationMessage.findMany.mockResolvedValue([]);
    db.conversationMessage.count.mockResolvedValue(0);
    db.auditLog.count.mockResolvedValue(0);
    expect(hasActivity(await collectFacts("t1", NOW))).toBe(false);
  });

  it("is true when anything was counted", async () => {
    expect(hasActivity(await collectFacts("t1", NOW))).toBe(true);
  });

  it("leaves the week key and the version out of the text a wording may quote", async () => {
    const f = await collectFacts("t1", NOW);
    expect(factsText(f)).not.toContain("2026-W43");
    expect(factsText(f)).not.toContain('"v":1');
    expect(factsText(f)).toContain('"waiting":4');
  });
});
