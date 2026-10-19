import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// get_business_picture reads the shop's own numbers. Here the database is replaced; what is tested is the part that is ours: the result
// holds counts and sums only, no text a buyer or a member of staff wrote can reach it, it stays inside the model's size limit, and it
// comes in the three languages.

const db = vi.hoisted(() => ({
  store: { findMany: vi.fn() },
  order: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  conversationMessage: { findMany: vi.fn(), count: vi.fn() },
  auditLog: { count: vi.fn() },
  businessProfile: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { PICTURE_TOOLS, pictureForModel } from "@/lib/chat/tools/reads-picture";
import type { ToolCtx } from "@/lib/chat/types";
import { MAX_RESULT_CHARS, wrapForModel } from "@/lib/chat/wrap";
import { collectFacts } from "@/lib/coach/facts";
import { FREE_TEXT_COLUMNS, SECRETS, busyFacts, seedShopDb } from "../coach/fixtures";

const NOW = Date.parse("2026-10-25T07:00:00Z");
const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  tenantId: "t1",
  userId: "u1",
  role: "OWNER",
  kind: "shop",
  lang: "en",
  threadId: "th1",
  attachments: [],
  review: true,
  deadline: Date.now() + 50_000,
  ...over,
});
const tool = PICTURE_TOOLS[0];
const run = (c: ToolCtx = ctx()) => tool.run(c, tool.schema.parse({}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.BUSINESS_PROFILE_ENABLED;
  seedShopDb(db, NOW);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.BUSINESS_PROFILE_ENABLED;
});

describe("the catalogue", () => {
  it("is one read tool for the shop that needs the configure permission", () => {
    expect(PICTURE_TOOLS.map((t) => t.name)).toEqual(["get_business_picture"]);
    expect(tool.risk).toBe("read");
    expect(tool.kinds).toEqual(["shop"]);
    expect(tool.permission).toBe("configure");
    expect(tool.schema.safeParse({}).success).toBe(true);
    expect(tool.schema.safeParse({ days: 3 }).success).toBe(false);
  });

  it("is NOT untrusted: it holds counts only, so a turn that uses it can still change things", () => {
    expect(tool.untrusted).toBeFalsy();
  });

  it("has a working label in every language", () => {
    for (const lang of ["ckb", "ar", "en"] as const) expect(tool.label(lang).trim().length).toBeGreaterThan(5);
  });

  it("tells the model to use it before advising, and what the numbers are not", () => {
    expect(tool.description).toMatch(/BEFORE advising/);
    expect(tool.description).toMatch(/not market prices/);
    expect(tool.description).toMatch(/not money collected/);
    expect(tool.description).toMatch(/not a lost sale/);
  });
});

describe("what it returns", () => {
  it("counts this week's orders against the week before, the products, what buyers ask and where they are", async () => {
    const r = await run();
    const d = r.data as Record<string, any>;
    expect(d.orders).toMatchObject({ thisWeek: 3, weekBefore: 2, cancelledOrReturned: 1, orderedValue: { IQD: 90_000 }, orderedValueWeekBefore: { IQD: 55_000 } });
    expect(d.orders.changePercent).toBeUndefined(); // the week before had fewer than ten orders
    expect(d.orders.topProducts[0]).toEqual({ name: "Red bag", orders: 2 });
    expect(d.productInterest[0]).toMatchObject({ product: "Red bag", asked: 12, ordered: 5, bargained: 2, bargainSharePercent: 14 });
    expect(d.buyers.topCities).toEqual(["Erbil", "Duhok"]);
    expect(d.messages).toEqual({ buyerMessagesThisWeek: 55, buyerMessagesWeekBefore: 40, commentsThisWeek: 120, commentsWeekBefore: 100, waitingForOwner: 4 });
    expect(d.posts).toEqual({ publishedThisWeek: 3, ofThemByAutopilot: 2 });
  });

  it("reminds the model what the numbers are and are not", async () => {
    const d = (await run()).data as { notes: string[] };
    const notes = d.notes.join(" ");
    expect(notes).toMatch(/not market data/);
    expect(notes).toMatch(/Predict nothing/);
    expect(notes).toMatch(/not money collected/);
    expect(notes).toMatch(/not a lost sale/);
  });

  it("carries the owner's goal and their words about their work, but only while the setup interview is on", async () => {
    const off = (await run()).data as { owner?: unknown };
    expect(off.owner).toBeUndefined();

    process.env.BUSINESS_PROFILE_ENABLED = "1";
    db.businessProfile.findMany.mockResolvedValue([
      {
        storeId: "s1",
        goal: "sell",
        goalText: "sell 300 bags this season",
        category: "fashion",
        offerLine: "Leather bags",
        customer: ["women"],
        sellsTo: ["erbil"],
        language: "ckb",
        tone: "friendly",
        facts: [],
        interview: { step: 5, answered: [], skipped: [], doneAt: "2026-10-16T10:00:00.000Z" },
      },
    ]);
    const on = (await run()).data as { owner: { goal: string; goalInTheirWords: string; aboutTheirWork: string[] } };
    expect(on.owner.goal).toBe("sell");
    expect(on.owner.goalInTheirWords).toBe("sell 300 bags this season");
    expect(on.owner.aboutTheirWork).toContain("Business type: clothes and fashion.");
    expect(on.owner.aboutTheirWork).toContain("What they offer: Leather bags");
  });

  it("gives a percentage only when the week before is big enough to say one", () => {
    const small = pictureForModel(busyFacts({ orders: { ...busyFacts().orders, week: 3, before: 2, changePct: null } })) as { orders: Record<string, unknown> };
    expect(small.orders.changePercent).toBeUndefined();
    const big = pictureForModel(busyFacts()) as { orders: Record<string, unknown> };
    expect(big.orders.changePercent).toBe(40);
  });

  it("stays inside the model's size limit even for a shop that fills every list", async () => {
    const f = busyFacts({
      profile: Array.from({ length: 12 }, (_, i) => `Line ${i} about the work: ${"x".repeat(50)}`),
      interest: Array.from({ length: 3 }, (_, i) => ({ name: `Product number ${i} with a long name`, asks: 30, orders: 2, haggles: 5, haggleSharePct: 14 })),
      orders: { ...busyFacts().orders, byStatus: { NEW: 1, CONFIRMED: 2, SENT: 3, DELIVERED: 4, RETURNED: 5, CANCELLED: 6 }, top: Array.from({ length: 3 }, (_, i) => ({ name: `Top ${i}`, orders: 9 - i })), sales: { IQD: 1_250_000, USD: 20.5 } },
      buyers: { cities: ["erbil", "duhok", "sulaymaniyah", "baghdad", "basra"], hours: [19, 20, 21, 22], messages: 300, orders: 100 },
    });
    const text = wrapForModel(pictureForModel(f), { untrusted: false });
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect(text).not.toContain('"truncated"');
  });
});

describe("what it never returns: a buyer's words", () => {
  it("lists the columns of every query, and none is a free-text column", async () => {
    await run();
    const calls = [...db.store.findMany.mock.calls, ...db.order.findMany.mock.calls, ...db.product.findMany.mock.calls, ...db.conversationMessage.findMany.mock.calls];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      const select = call[0].select as Record<string, boolean>;
      expect(select).toBeTruthy();
      for (const column of FREE_TEXT_COLUMNS) expect(Object.keys(select), column).not.toContain(column);
    }
  });

  it("does not let a conversation's text, an order note, a buyer's name, a phone or an address through, even when the rows carry them", async () => {
    const r = await run();
    const model = JSON.stringify(r.data);
    const person = JSON.stringify(r.view);
    for (const secret of SECRETS) {
      expect(model, secret).not.toContain(secret);
      expect(person, secret).not.toContain(secret);
    }
    expect(model + person).not.toMatch(/07501234567|Gulan/);
  });

  it("scrubs a phone number out of a product name", () => {
    const d = pictureForModel(busyFacts({ interest: [{ name: "Bag call 0750 123 4567", asks: 1, orders: 0, haggles: 0, haggleSharePct: null }] }));
    expect(JSON.stringify(d)).not.toContain("0750 123 4567");
  });

  it("is scoped to the workspace in the session", async () => {
    await run(ctx({ tenantId: "t9" }));
    expect(db.order.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "t9" });
    expect(db.conversationMessage.findMany.mock.calls[0][0].where).toMatchObject({ store: { tenantId: "t9" } });
    expect(db.auditLog.count.mock.calls[0][0].where).toMatchObject({ tenantId: "t9" });
  });
});

describe("what the person sees", () => {
  it("is shown in each language, with no missing word", async () => {
    for (const lang of ["ckb", "ar", "en"] as const) {
      const r = await run(ctx({ lang }));
      const blocks = r.view ?? [];
      expect(blocks.length, lang).toBeGreaterThan(2);
      const text = JSON.stringify(blocks);
      expect(text, lang).not.toContain("undefined");
      expect(text, lang).not.toContain("NaN");
    }
  });

  it("calls the ordered value 'ordered value' and lists the best sellers and the questions", async () => {
    const blocks = (await run()).view ?? [];
    const text = JSON.stringify(blocks);
    expect(text).toContain("Ordered value");
    expect(text).toContain("90,000 IQD");
    expect(text).toContain("Red bag");
    expect(blocks[0]).toMatchObject({ kind: "stats", title: "Orders in the last 7 days" });
  });

  it("says so in a note when nothing was counted", async () => {
    db.order.findMany.mockResolvedValue([]);
    db.conversationMessage.findMany.mockResolvedValue([]);
    db.conversationMessage.count.mockResolvedValue(0);
    db.auditLog.count.mockResolvedValue(0);
    const r = await run();
    expect(r.view).toHaveLength(1);
    expect(r.view?.[0]).toMatchObject({ kind: "note" });
  });
});

describe("the facts it is built from", () => {
  it("are the same numbers the weekly note uses", async () => {
    const f = await collectFacts("t1", NOW);
    const d = (await run()).data as { orders: { thisWeek: number } };
    expect(d.orders.thisWeek).toBe(f.orders.week);
  });
});
